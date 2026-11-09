#!/usr/bin/python3 -I
"""Fixed repository source deployment, executed only by the root-owned dispatcher."""
import gzip
import hashlib
import contextlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import resource
import shutil
import secrets
import time
import subprocess
import tarfile
import tempfile

DOWNLOAD_SECONDS = 180
MAX_DOWNLOAD = 32 * 1024 * 1024
MAX_TAR = 128 * 1024 * 1024
MAX_SOURCE = 64 * 1024 * 1024
MAX_FILES = 10000
CONFIG = Path("/etc/ekiden/source-builder.json")
TRUSTED_DOCKERFILE = Path("/etc/ekiden/source-Dockerfile")
TOKEN = Path("/etc/ekiden/github-read-token")
POLICY = Path("/usr/local/libexec/ekiden-source-policy.py")
BUILDER = "ekiden-source"
CONTAINER = "buildx_buildkit_ekiden-source0"
MEMORY = 1536 * 1024 * 1024
MIN_DISK = 12 * 1024 * 1024 * 1024
BUILD_SECONDS = 1200
DOCKER_SOCKET = "unix:///var/run/docker.sock"
DOCKER_CONFIG = "/etc/ekiden/source-docker"
PROBE_JS = """const fs=require('fs');
if(!process.version.startsWith('v24.'))process.exit(71);
console.log('EKIDEN_LIMITS_OK');
setTimeout(()=>{},5000);"""


class SourceError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def fail(condition, code):
    if not condition:
        raise SourceError(code)


def protected(path):
    info = path.stat()
    fail(info.st_uid == 0 and not info.st_mode & 0o022 and not path.is_symlink(), "SOURCE_CONFIG_INVALID")


def load_config():
    protected(CONFIG)
    protected(TRUSTED_DOCKERFILE)
    config = json.loads(CONFIG.read_text())
    fail(set(config) == {"node_image", "buildkit_image"}, "SOURCE_CONFIG_INVALID")
    fail(re.fullmatch(r"m\.daocloud\.io/docker\.io/library/node:24-bookworm-slim@sha256:[0-9a-f]{64}", config["node_image"]), "SOURCE_CONFIG_INVALID")
    fail(re.fullmatch(r"m\.daocloud\.io/docker\.io/moby/buildkit:v0\.[0-9]+\.[0-9]+@sha256:[0-9a-f]{64}", config["buildkit_image"]), "SOURCE_CONFIG_INVALID")
    return config


def load_policy():
    protected(POLICY)
    spec = importlib.util.spec_from_file_location("ekiden_source_policy", POLICY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_token():
    if not TOKEN.exists():
        return None  # Public repositories only; private API calls must fail closed.
    protected(TOKEN)
    fail(TOKEN.stat().st_mode & 0o077 == 0, "SOURCE_CONFIG_INVALID")
    value = TOKEN.read_text().strip()
    fail(value and "\n" not in value and "\r" not in value, "SOURCE_CONFIG_INVALID")
    return value


def fetch_main(sha, token, policy):
    """Admission uses only the fixed GitHub API, never the Git transport."""
    fail(re.fullmatch(r"[0-9a-f]{40}", sha), "INVALID_SOURCE_SHA")
    try:
        policy.approve(sha, token)
    except policy.PolicyError as error:
        raise SourceError(str(error)) from None


def download_source(sha, directory, token=None):
    fail(re.fullmatch(r"[0-9a-f]{40}", sha), "INVALID_SOURCE_SHA")
    part = directory / "source.tar.gz.part"
    archive = directory / "source.tar.gz"
    header = directory / "codeload-header"
    deadline = time.monotonic() + DOWNLOAD_SECONDS
    try:
        if token:
            fail(not any(char in token for char in "\r\n\0"), "SOURCE_CONFIG_INVALID")
            with open(header, "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as output:
                output.write("Authorization: Bearer " + token + "\n")
        for attempt in range(2):
            part.unlink(missing_ok=True)
            remaining = deadline - time.monotonic()
            fail(remaining > 0, "SOURCE_FETCH_TIMEOUT")
            # No redirects, curlrc, netrc or ambient credentials. Header only goes
            # to this fixed HTTPS origin. Low-speed timer bounds stalled reads.
            command = ["/usr/bin/curl", "--disable", "--silent", "--fail", "--proto", "=https",
                       "--connect-timeout", "10", "--speed-limit", "1", "--speed-time", "30",
                       "--max-time", str(remaining), "--retry", "0", "--max-filesize", str(MAX_DOWNLOAD),
                       "--output", str(part), "--write-out", "%{http_code} %{time_connect}"]
            if token:
                command += ["--header", "@"+str(header)]
            command += ["https://codeload.github.com/stagnantwater657/ekiden-database/tar.gz/" + sha]
            try:
                result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, env={"PATH": "/usr/bin:/bin", "HOME": "/var/empty"},
                                        timeout=remaining+1,
                                        preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_DOWNLOAD, MAX_DOWNLOAD)))
            except subprocess.TimeoutExpired:
                raise SourceError("SOURCE_FETCH_TIMEOUT") from None
            except OSError:
                raise SourceError("SOURCE_FETCH_FAILED") from None
            status, connected = (result.stdout.decode("ascii").split() + ["0", "0"])[:2]
            fail(status != "403", "SOURCE_HTTP_FORBIDDEN")
            fail(status != "404", "SOURCE_HTTP_NOT_FOUND")
            size = part.stat().st_size if part.exists() else 0
            fail(size < MAX_DOWNLOAD and result.returncode not in {63, -25}, "SOURCE_DOWNLOAD_TOO_LARGE")
            if result.returncode == 0 and status == "200":
                fail(size > 0, "SOURCE_FETCH_FAILED")
                part.replace(archive)
                return archive
            code = ("SOURCE_CONNECT_TIMEOUT" if connected == "0.000000" else "SOURCE_FETCH_TIMEOUT") if result.returncode == 28 else "SOURCE_FETCH_FAILED"
            retryable = result.returncode in {5, 6, 7, 18, 28, 35, 52, 55, 56} or status in {"429", "500", "502", "503", "504"}
            if not retryable or attempt == 1:
                raise SourceError(code)
        raise SourceError("SOURCE_FETCH_FAILED")
    finally:
        part.unlink(missing_ok=True)
        header.unlink(missing_ok=True)


def checkout(archive_path, sha, directory):
    """Validate gzip to EOF, bound tar bytes, then extract regular files only."""
    fail(re.fullmatch(r"[0-9a-f]{40}", sha), "INVALID_SOURCE_SHA")
    raw = directory / "source.tar"
    context = directory / "context"
    prefix = "ekiden-database-" + sha
    try:
        # Tar readers can stop at end-of-archive before checking the gzip CRC.
        # Fully consume gzip with a bound that includes headers, padding and PAX.
        with gzip.open(archive_path, "rb") as compressed, raw.open("xb") as output:
            total = 0
            while chunk := compressed.read(64*1024):
                total += len(chunk)
                fail(total <= MAX_TAR, "SOURCE_ARCHIVE_INVALID")
                output.write(chunk)
        context.mkdir(mode=0o700)
        seen = set()
        total = 0
        with tarfile.open(raw, "r:") as archive:
            for count, member in enumerate(archive, 1):
                relative = PurePosixPath(member.name)
                parts = relative.parts
                fail(count <= MAX_FILES and not relative.is_absolute() and ".." not in parts
                     and parts and parts[0] == prefix and "\\" not in member.name
                     and (member.isfile() or member.isdir()) and not member.issparse(), "SOURCE_ARCHIVE_INVALID")
                key = str(PurePosixPath(*parts[1:]))
                fail(key not in seen, "SOURCE_ARCHIVE_INVALID")
                seen.add(key)
                if len(parts) == 1:
                    fail(member.isdir(), "SOURCE_ARCHIVE_INVALID")
                    continue
                total += member.size
                fail(total <= MAX_SOURCE and member.size >= 0, "SOURCE_ARCHIVE_INVALID")
                target = context.joinpath(*parts[1:])
                if member.isdir():
                    target.mkdir(mode=0o700, parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    with archive.extractfile(member) as source, target.open("xb") as output:
                        shutil.copyfileobj(source, output, 64*1024)
    except SourceError:
        shutil.rmtree(context, ignore_errors=True)
        raise
    except (OSError, EOFError, tarfile.TarError, ValueError):
        shutil.rmtree(context, ignore_errors=True)
        raise SourceError("SOURCE_ARCHIVE_INVALID") from None
    except BaseException:
        shutil.rmtree(context, ignore_errors=True)
        raise
    finally:
        raw.unlink(missing_ok=True)
        archive_path.unlink(missing_ok=True)
    try:
        fail((context / "Dockerfile").read_bytes() == TRUSTED_DOCKERFILE.read_bytes(), "DOCKERFILE_APPROVAL_REQUIRED")
        lock = json.loads((context / "package-lock.json").read_text())
        fail(lock.get("lockfileVersion") == 3, "LOCKFILE_SOURCE_INVALID")
        for item in lock["packages"].values():
            fail(not item.get("link"), "LOCKFILE_SOURCE_INVALID")
            if "resolved" in item:
                fail(re.fullmatch(r"https://registry\.npmjs\.org/[^?#\s]+", item["resolved"])
                     and item.get("integrity"), "LOCKFILE_SOURCE_INVALID")
        return context
    except BaseException:
        shutil.rmtree(context, ignore_errors=True)
        raise


def verify_builder(api, config):
    try:
        builders = [json.loads(line) for line in api.engine("buildx", "ls", "--format", "{{json .}}", docker_config=DOCKER_CONFIG).decode().splitlines()]
        matches = [item for item in builders if item.get("Name") == BUILDER]
        # Buildx can list the same stored builder twice (current context + --host).
        # Accept duplicate identities only when every record names the fixed local driver/endpoint.
        fail(matches and all(item["Driver"] == "docker-container" and len(item["Nodes"]) == 1
                            and item["Nodes"][0]["Endpoint"] == DOCKER_SOCKET for item in matches),
             "BUILD_LIMITS_INVALID")
        builder = json.loads(api.engine("container", "inspect", CONTAINER))[0]
        host = builder["HostConfig"]
        fail(builder["State"]["Running"] and builder["Config"]["Image"] == config["buildkit_image"], "BUILD_IMAGE_UNAVAILABLE")
        fail(host["Memory"] == MEMORY and host["MemorySwap"] == MEMORY
             and host["CpuPeriod"] == 100000 and host["CpuQuota"] == 125000
             and host["NetworkMode"] in {"default", "bridge"} and host["CgroupnsMode"] == "private", "BUILD_LIMITS_INVALID")
        mounts = builder["Mounts"]
        fail(len(mounts) == 1 and mounts[0]["Type"] == "volume"
             and mounts[0]["Name"] == CONTAINER + "_state"
             and mounts[0]["Destination"] == "/var/lib/buildkit", "BUILD_LIMITS_INVALID")
        flags = builder["Config"]["Cmd"]
        for index, value in enumerate(flags):
            fail("no-process-sandbox" not in value, "BUILD_LIMITS_INVALID")
            if value.startswith("--allow-insecure-entitlement"):
                entitlement = value.split("=", 1)[1] if "=" in value else flags[index+1]
                # Buildx adds network.host for the *bridge-isolated builder* by default.
                # Client builds receive no --allow flag, so Dockerfile RUN cannot use it.
                fail(entitlement == "network.host", "BUILD_LIMITS_INVALID")
        group = builder_group(builder)
        fail(read_limits(group) == [str(MEMORY), "125000 100000", "0"], "BUILD_LIMITS_INVALID")
        # These must already exist locally. No automatic image provisioning here.
        api.engine("image", "inspect", config["node_image"])
        api.engine("image", "inspect", config["buildkit_image"])
    except SourceError:
        raise
    except Exception:
        raise SourceError("BUILD_IMAGE_UNAVAILABLE") from None


def build_command(api, args, logfile, timeout, observer=None):
    env = {"PATH": "/usr/bin:/bin", "HOME": "/root"}
    command = [api.DOCKER, "--host", DOCKER_SOCKET, "--config", DOCKER_CONFIG,
               "buildx", "build", "--builder", BUILDER, "--progress=plain", *args]
    try:
        with logfile.open("wb") as output:
            limit_log = lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (64*1024*1024, 64*1024*1024))
            if observer is None:
                result = subprocess.run(command, env=env, stdin=subprocess.DEVNULL, stdout=output,
                                        stderr=subprocess.STDOUT, timeout=timeout, preexec_fn=limit_log)
            else:
                with subprocess.Popen(command, env=env, stdin=subprocess.DEVNULL, stdout=output,
                                      stderr=subprocess.STDOUT, preexec_fn=limit_log) as process:
                    deadline = time.monotonic() + timeout
                    try:
                        while process.poll() is None:
                            if time.monotonic() >= deadline:
                                raise subprocess.TimeoutExpired(command, timeout)
                            observer()
                            time.sleep(.25)
                        result = subprocess.CompletedProcess(command, process.returncode)
                    except BaseException:
                        process.kill()
                        process.wait()
                        raise
    except subprocess.TimeoutExpired:
        # Cancel only this dedicated builder, not Docker Engine or applications.
        with contextlib.suppress(Exception):
            api.engine("container", "stop", "--time", "10", CONTAINER)
        raise SourceError("SOURCE_BUILD_TIMEOUT") from None
    except OSError:
        raise SourceError("SOURCE_BUILD_FAILED") from None
    except BaseException:
        with contextlib.suppress(Exception):
            api.engine("container", "stop", "--time", "10", CONTAINER)
        raise
    if result.returncode:
        with logfile.open("rb") as output:
            output.seek(max(0, logfile.stat().st_size - 2 * 1024 * 1024))
            log = output.read(2 * 1024 * 1024)
        oom = False
        with contextlib.suppress(Exception):
            oom = json.loads(api.engine("container", "inspect", CONTAINER))[0]["State"].get("OOMKilled", False)
        if oom:
            raise SourceError("SOURCE_BUILD_OOM")
        if any(marker in log for marker in (b"exit code: 137", b"OOM", b"out of memory", b"Killed")):
            raise SourceError("SOURCE_BUILD_OOM")
        if b"EKIDEN_NPM_CI_FAILED" in log:
            raise SourceError("NPM_CI_FAILED")
        if b"failed to resolve source metadata" in log or b"failed to fetch" in log:
            raise SourceError("BUILD_IMAGE_UNAVAILABLE")
        raise SourceError("SOURCE_BUILD_FAILED")


def read_limits(group):
    return [(group/name).read_text().strip() for name in ("memory.max", "cpu.max", "memory.swap.max")]


def builder_group(builder):
    # BuildKit relocates its daemon to an init leaf. Check the Docker-owned
    # ancestor, whose limits cover both daemon and OCI worker siblings.
    path = process_cgroup(builder["State"]["Pid"])
    parts = Path(path).parts
    identity = builder["Id"]
    fail(re.fullmatch(r"[0-9a-f]{64}", identity), "BUILD_LIMITS_INVALID")
    candidates = [index for index, part in enumerate(parts)
                  if part == "docker-"+identity+".scope" or
                  (part == identity and index > 0 and parts[index-1] == "docker")]
    fail(len(candidates) == 1, "BUILD_LIMITS_INVALID")
    return Path("/sys/fs/cgroup") / str(Path(*parts[:candidates[0]+1])).lstrip("/")


def process_cgroup(pid):
    fail(re.fullmatch(r"[1-9][0-9]*", str(pid)), "BUILD_LIMITS_INVALID")
    lines = Path(f"/proc/{pid}/cgroup").read_text().splitlines()
    paths = [line[3:] for line in lines if line.startswith("0::")]
    fail(len(paths) == 1 and paths[0].startswith("/") and paths[0] != "/", "BUILD_LIMITS_INVALID")
    return paths[0].rstrip("/")


def resource_probe(api, config, directory):
    # A leaf may show 'max' while an ancestor enforces the real limit. Prove
    # the actual worker PID is inside the already verified builder cgroup.
    builder = json.loads(api.engine("container", "inspect", CONTAINER))[0]
    group = builder_group(builder)
    fail(read_limits(group) == [str(MEMORY), "125000 100000", "0"], "BUILD_LIMITS_INVALID")
    parent = "/" + str(group.relative_to("/sys/fs/cgroup"))
    marker = "EKIDEN_PROBE_" + secrets.token_hex(8)
    observed = [False]
    def observe():
        listing = api.engine("top", CONTAINER, "-eo", "pid,args").decode()
        for line in listing.splitlines():
            match = re.match(r"\s*([0-9]+)\s+", line)
            if match and marker in line:
                try:
                    child = process_cgroup(match[1])
                    (directory / "resource-ancestry.json").write_text(json.dumps({"worker_pid": match[1], "worker_cgroup": child, "expected_parent": parent}))
                    fail(child == parent or child.startswith(parent + "/"), "BUILD_LIMITS_INVALID")
                    observed[0] = True
                except OSError:
                    continue  # Process exited between ps and proc read; require another observation.
    probe = directory / "probe"
    probe.mkdir()
    js = "process.title=" + json.dumps(marker) + ";" + PROBE_JS.replace("\n", " ")
    (probe / "Dockerfile").write_text("ARG NODE_IMAGE=node:24-bookworm-slim\nFROM ${NODE_IMAGE}\nRUN " + json.dumps(["node", "-e", js]) + "\n")
    build_command(api, ["--build-arg", "NODE_IMAGE=" + config["node_image"], str(probe)],
                  directory / "resource-probe.log", 120, observer=observe)
    fail(observed[0] and b"EKIDEN_LIMITS_OK" in (directory / "resource-probe.log").read_bytes(), "BUILD_LIMITS_INVALID")


def image_config_digest(api, tag, sha, directory):
    # Docker's load exporter may omit config.digest; Docker 29 native Id may
    # instead identify a manifest. Read the actual config from a local save.
    archive = directory / "identity.tar"
    command = [api.DOCKER, "--host", DOCKER_SOCKET, "--config", DOCKER_CONFIG, "image", "save", tag]
    try:
        with archive.open("wb") as output:
            subprocess.run(command, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.DEVNULL,
                           env={"PATH": "/usr/bin:/bin", "HOME": "/root"}, check=True, timeout=180,
                           preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (2*1024**3, 2*1024**3)))
        with tarfile.open(archive) as saved:
            def small(name):
                member = saved.getmember(name)
                fail(member.isfile() and member.size <= 1024*1024, "SOURCE_IMAGE_IDENTITY_FAILED")
                return saved.extractfile(member).read()
            manifests = json.loads(small("manifest.json"))
            fail(len(manifests) == 1 and manifests[0]["RepoTags"] == [tag], "SOURCE_IMAGE_IDENTITY_FAILED")
            config = small(manifests[0]["Config"])
            fail(json.loads(config)["config"]["Labels"]["org.opencontainers.image.revision"] == sha,
                 "SOURCE_IMAGE_IDENTITY_FAILED")
            return "sha256:" + hashlib.sha256(config).hexdigest()
    except SourceError:
        raise
    except Exception:
        raise SourceError("SOURCE_IMAGE_IDENTITY_FAILED") from None
    finally:
        archive.unlink(missing_ok=True)


def run(api, sha, build_only=False):
    fail(re.fullmatch(r"[0-9a-f]{40}", sha), "INVALID_SOURCE_SHA")
    fail(not (api.STATE / "current").exists() or (api.STATE / "current.json").exists(), "SOURCE_MIGRATION_REQUIRED")
    fail(shutil.disk_usage(api.STATE).free >= MIN_DISK, "SOURCE_DISK_LOW")
    config = load_config()
    policy = load_policy()
    token = read_token()
    def admit():
        fetch_main(sha, token, policy)
    api.stage("source_fetch")
    admit()
    verify_builder(api, config)
    with tempfile.TemporaryDirectory(prefix="source-", dir=api.STATE / "source-builds") as temporary:
        directory = Path(temporary)
        archive = download_source(sha, directory, token)
        context = checkout(archive, sha, directory)
        api.stage("source_resource_probe")
        try:
            resource_probe(api, config, directory)
        except SourceError as error:
            if error.code == "SOURCE_BUILD_FAILED":
                raise SourceError("BUILD_LIMITS_INVALID") from None
            raise
        api.stage("source_image_build")
        tag = "ekiden-source:" + sha
        metadata = directory / "metadata.json"
        build_command(api, ["--load", "--platform", "linux/amd64", "--pull=false",
                           "--build-arg", "NODE_IMAGE=" + config["node_image"],
                           "--build-arg", "NPM_REGISTRY=https://registry.npmmirror.com",
                           "--build-arg", "BUILD_NODE_OPTIONS=--max-old-space-size=768",
                           "--build-arg", "BUILD_CPUS=1", "--label", "org.opencontainers.image.revision=" + sha,
                           "--metadata-file", str(metadata), "--tag", tag, "--file", str(context / "Dockerfile"), str(context)],
                      directory / "build.log", BUILD_SECONDS)
        info = api.inspect_image(tag)
        fail(info["Config"].get("Labels", {}).get("org.opencontainers.image.revision") == sha,
             "SOURCE_IMAGE_IDENTITY_FAILED")
        digest = image_config_digest(api, tag, sha, directory)
        record = api.image_record(sha, info["Id"], digest)
        api.engine("image", "tag", info["Id"], record["ref"])
        api.write_record(api.STATE / "ready" / (sha + ".json"), record)
        api.stage("source_build_complete")
        # Never activate a SHA that ceased to be main HEAD while compiling.
        admit()
        if not build_only:
            api.stage("source_health_check")
            try:
                api.activate(record)
            except Exception:
                raise SourceError("SOURCE_HEALTH_FAILED") from None
            api.stage("source_complete")
