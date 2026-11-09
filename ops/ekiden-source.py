#!/usr/bin/python3 -I
"""Fixed repository source deployment, executed only by the root-owned dispatcher."""
import base64
import contextlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import resource
import shutil
import subprocess
import tarfile
import tempfile

REPOSITORY = "https://github.com/stagnantwater657/ekiden-database.git"
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
DOCKER_CONFIG = "/etc/ekiden/docker"
PROBE_JS = """const fs=require('fs');
const mem=fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim();
const cpu=fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim().split(/\\s+/).map(Number);
const swap=fs.readFileSync('/sys/fs/cgroup/memory.swap.max','utf8').trim();
if(mem!=='1610612736'||cpu[0]!==125000||cpu[1]!==100000||swap!=='0'||!process.version.startsWith('v24.'))process.exit(71);
console.log('EKIDEN_LIMITS_OK');"""


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


def git(args, token=None, timeout=180, output=None):
    env = {"PATH": "/usr/bin:/bin", "HOME": "/var/empty", "GIT_CONFIG_NOSYSTEM": "1",
           "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0", "GIT_ALLOW_PROTOCOL": "https"}
    if token:
        # Passed only to Git, never to Docker, build arguments or command line.
        env.update(GIT_CONFIG_COUNT="1", GIT_CONFIG_KEY_0="http.https://github.com/.extraHeader",
                   GIT_CONFIG_VALUE_0="Authorization: Basic " + base64.b64encode(("x-access-token:" + token).encode()).decode())
    command = ["/usr/bin/git", "-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", *args]
    try:
        return subprocess.run(command, stdin=subprocess.DEVNULL, stdout=output or subprocess.PIPE,
                              stderr=subprocess.DEVNULL, env=env, timeout=timeout, check=True).stdout
    except subprocess.TimeoutExpired:
        raise SourceError("SOURCE_FETCH_TIMEOUT") from None
    except (OSError, subprocess.SubprocessError):
        raise SourceError("SOURCE_FETCH_FAILED") from None


def fetch_main(state, sha, token):
    repo = state / "source.git"
    if not repo.exists():
        git(["init", "--bare", str(repo)], timeout=30)
    git(["--git-dir", str(repo), "fetch", "--no-tags", "--no-recurse-submodules", "--depth=1",
         REPOSITORY, "+refs/heads/main:refs/heads/approved-main"], token)
    head = git(["--git-dir", str(repo), "rev-parse", "refs/heads/approved-main"], timeout=30).decode().strip()
    fail(head == sha, "MAIN_SHA_MISMATCH")
    return repo


def checkout(repo, sha, directory):
    archive_path = directory / "source.tar"
    with archive_path.open("wb") as output:
        git(["--git-dir", str(repo), "archive", "--format=tar", sha], timeout=30, output=output)
    context = directory / "context"
    context.mkdir(mode=0o700)
    total = 0
    with tarfile.open(archive_path) as archive:
        for count, member in enumerate(archive, 1):
            relative = PurePosixPath(member.name)
            fail(not relative.is_absolute() and ".." not in relative.parts and
                 (member.isfile() or member.isdir()) and not member.issparse(), "SOURCE_ARCHIVE_INVALID")
            total += member.size
            fail(count <= 10000 and total <= 64 * 1024 * 1024, "SOURCE_ARCHIVE_INVALID")
            target = context / member.name
            if member.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with archive.extractfile(member) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)
    archive_path.unlink()
    fail((context / "Dockerfile").read_bytes() == TRUSTED_DOCKERFILE.read_bytes(), "DOCKERFILE_APPROVAL_REQUIRED")
    lock = json.loads((context / "package-lock.json").read_text())
    fail(lock.get("lockfileVersion") == 3, "LOCKFILE_SOURCE_INVALID")
    for item in lock["packages"].values():
        fail(not item.get("link"), "LOCKFILE_SOURCE_INVALID")
        if "resolved" in item:
            fail(re.fullmatch(r"https://registry\.npmjs\.org/[^?#\s]+", item["resolved"])
                 and item.get("integrity"), "LOCKFILE_SOURCE_INVALID")
    return context


def verify_builder(api, config):
    try:
        builders = [json.loads(line) for line in api.engine("buildx", "ls", "--format", "{{json .}}").decode().splitlines()]
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
             and host["NetworkMode"] not in {"host", "none"}, "BUILD_LIMITS_INVALID")
        mounts = builder["Mounts"]
        fail(len(mounts) == 1 and mounts[0]["Type"] == "volume"
             and mounts[0]["Name"] == CONTAINER + "_state"
             and mounts[0]["Destination"] == "/var/lib/buildkit", "BUILD_LIMITS_INVALID")
        fail(not any("allow-insecure-entitlement" in value or "no-process-sandbox" in value
                     for value in builder["Config"]["Cmd"]), "BUILD_LIMITS_INVALID")
        limits = api.engine("exec", CONTAINER, "cat", "/sys/fs/cgroup/memory.max",
                            "/sys/fs/cgroup/cpu.max", "/sys/fs/cgroup/memory.swap.max").decode().splitlines()
        fail(limits == [str(MEMORY), "125000 100000", "0"], "BUILD_LIMITS_INVALID")
        # These must already exist locally. No automatic image provisioning here.
        api.engine("image", "inspect", config["node_image"])
        api.engine("image", "inspect", config["buildkit_image"])
    except SourceError:
        raise
    except Exception:
        raise SourceError("BUILD_IMAGE_UNAVAILABLE") from None


def build_command(api, args, logfile, timeout):
    env = {"PATH": "/usr/bin:/bin", "HOME": "/root"}
    command = [api.DOCKER, "--host", DOCKER_SOCKET, "--config", DOCKER_CONFIG,
               "buildx", "build", "--builder", BUILDER, "--progress=plain", *args]
    try:
        with logfile.open("wb") as output:
            result = subprocess.run(command, env=env, stdin=subprocess.DEVNULL, stdout=output,
                                    stderr=subprocess.STDOUT, timeout=timeout,
                                    preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (64*1024*1024, 64*1024*1024)))
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


def resource_probe(api, config, directory):
    probe = directory / "probe"
    probe.mkdir()
    (probe / "Dockerfile").write_text("ARG NODE_IMAGE\nFROM ${NODE_IMAGE}\nRUN node -e " + json.dumps(PROBE_JS.replace("\n", " ")) + "\n")
    build_command(api, ["--build-arg", "NODE_IMAGE=" + config["node_image"], str(probe)],
                  directory / "resource-probe.log", 120)
    fail(b"EKIDEN_LIMITS_OK" in (directory / "resource-probe.log").read_bytes(), "BUILD_LIMITS_INVALID")


def run(api, sha, build_only=False):
    fail(re.fullmatch(r"[0-9a-f]{40}", sha), "INVALID_SOURCE_SHA")
    fail(not (api.STATE / "current").exists() or (api.STATE / "current.json").exists(), "SOURCE_MIGRATION_REQUIRED")
    fail(shutil.disk_usage(api.STATE).free >= MIN_DISK, "SOURCE_DISK_LOW")
    config = load_config()
    policy = load_policy()
    token = read_token()
    def admit():
        repo = fetch_main(api.STATE, sha, token)
        try:
            policy.approve(sha, token)
        except policy.PolicyError as error:
            raise SourceError(str(error)) from None
        return repo
    api.stage("source_fetch")
    repo = admit()
    verify_builder(api, config)
    with tempfile.TemporaryDirectory(prefix="source-", dir=api.STATE / "source-builds") as temporary:
        directory = Path(temporary)
        context = checkout(repo, sha, directory)
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
        digest = json.loads(metadata.read_text())["containerimage.config.digest"]
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
