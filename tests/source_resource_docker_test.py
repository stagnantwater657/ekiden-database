"""Only disposable CI Unix daemon: test actual BuildKit cgroups, OOM, and image build."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("source_resource", ROOT / "ops/ekiden-source.py")
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


def main():
    if os.environ.get("EKIDEN_DOCKER_TEST") != "1":
        sys.exit("An isolated CI/development daemon is required")
    socket = os.environ["DOCKER_TEST_SOCKET"]
    if socket.startswith("unix://"): socket = socket[7:]
    assert socket.startswith("/") and ":" not in socket
    source.DOCKER_SOCKET = "unix://" + socket
    source.DOCKER_CONFIG = os.environ.get("DOCKER_CONFIG", str(Path.home() / ".docker"))
    executable = shutil.which("docker")
    command = [executable, "--host", source.DOCKER_SOCKET, "--config", source.DOCKER_CONFIG]
    env = {key: value for key, value in os.environ.items() if key not in {"DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"}}
    def engine(*args, **_kwargs):
        return subprocess.check_output([*command, *args], env=env, timeout=1200)
    api = types.SimpleNamespace(DOCKER=executable, engine=engine)
    engine("pull", "node:24-bookworm-slim")
    engine("pull", "moby/buildkit:v0.26.2")
    def pinned(tag):
        digest = json.loads(engine("image", "inspect", tag))[0]["RepoDigests"][0].split("@", 1)[1]
        return tag + "@" + digest
    config = {"node_image": pinned("node:24-bookworm-slim"), "buildkit_image": pinned("moby/buildkit:v0.26.2")}
    subprocess.run(["sudo", "python3", str(ROOT/"ops/ekiden-build-limits")], check=True)
    engine("container", "create", "--name", source.CONTAINER, "--privileged", "--cgroupns", "host",
           "--memory", "256m", "--memory-swap", "256m", "--cpu-period", "100000", "--cpu-quota", "25000",
           "--mount", "type=volume,source="+source.CONTAINER+"_state,target=/var/lib/buildkit",
           config["buildkit_image"], "--config=/etc/buildkit/buildkitd.toml", "--oci-worker-gc=false")
    engine("container", "cp", str(ROOT/"ops/source-buildkitd.toml"), source.CONTAINER+":/etc/buildkit/buildkitd.toml")
    engine("container", "start", source.CONTAINER)
    engine("buildx", "create", "--name", source.BUILDER, "--driver", "docker-container",
           "--driver-opt", "image="+config["buildkit_image"],
           "--driver-opt", "memory=256m,memory-swap=256m,cpu-period=100000,cpu-quota=25000",
           "--buildkitd-flags", "--oci-worker-gc=false", "--buildkitd-config", str(ROOT/"ops/source-buildkitd.toml"),
           "--bootstrap", source.DOCKER_SOCKET)
    try:
        records = [json.loads(line) for line in engine("buildx", "ls", "--format", "{{json .}}").decode().splitlines()]
        print("CI builder identities:", [(item.get("Name"), item.get("Driver"),
                                          [node.get("Endpoint") for node in item.get("Nodes", [])]) for item in records], flush=True)
        source.verify_builder(api, config)
        with tempfile.TemporaryDirectory(dir=os.environ.get("RUNNER_TEMP")) as directory:
            root = Path(directory)
            try:
                source.resource_probe(api, config, root)
            except Exception:
                print((root/"resource-probe.log").read_text()[-12000:])
                if (root/"resource-ancestry.json").exists(): print((root/"resource-ancestry.json").read_text())
                raise
            print("PASS actual builder and worker memory/CPU/swap limits")
            oom = root / "oom"
            oom.mkdir()
            # Commit physical pages beyond the hard cgroup cap; heap flags cannot bypass it.
            (oom/"Dockerfile").write_text("ARG NODE_IMAGE\nFROM ${NODE_IMAGE}\nRUN node -e 'const a=[];for(let i=0;i<1800;i++)a.push(Buffer.alloc(1048576,1));console.log(\"UNBOUNDED\")'\n")
            before_oom = int(dict(line.split() for line in (source.WORKER_GROUP/"memory.events").read_text().splitlines())["oom_kill"])
            try:
                source.build_command(api, ["--build-arg", "NODE_IMAGE="+config["node_image"], str(oom)], root/"oom.log", 120)
                raise AssertionError("OOM probe unexpectedly succeeded")
            except source.SourceError as error:
                if error.code != "SOURCE_BUILD_OOM":
                    print((root/"oom.log").read_text()[-8000:])
                    raise
            after_oom = int(dict(line.split() for line in (source.WORKER_GROUP/"memory.events").read_text().splitlines())["oom_kill"])
            assert after_oom > before_oom, "No kernel cgroup OOM event observed"
            print("PASS actual cgroup OOM rejection and kernel oom_kill counter")
            # Official registry/base in CI; the same 768 MiB heap and one worker as production.
            try:
                source.build_command(api, ["--load", "--metadata-file", str(root/"app-metadata.json"),
                                          "--label", "org.opencontainers.image.revision="+os.environ["GITHUB_SHA"], "--build-arg", "NODE_IMAGE="+config["node_image"],
                                          "--build-arg", "BUILD_NODE_OPTIONS=--max-old-space-size=768",
                                          "--build-arg", "BUILD_CPUS=1", "--tag", "ekiden-source-ci:checked", str(ROOT)], root/"app.log", 1200)
            except Exception:
                print((root/"app.log").read_text()[-12000:])
                raise
            metadata = json.loads((root/"app-metadata.json").read_text())
            import re
            assert re.fullmatch(r"sha256:[0-9a-f]{64}", metadata["containerimage.config.digest"])
            image = json.loads(engine("image", "inspect", "ekiden-source-ci:checked"))[0]
            assert image["Config"]["Labels"]["org.opencontainers.image.revision"] == os.environ["GITHUB_SHA"]
            print("PASS application Docker build under 1536 MiB / 1.25 CPU limits")
    except Exception:
        # CI has no production credentials; logs are confined to these disposable builds.
        if 'root' in locals():
            for log in root.glob('*.log'):
                print(log.read_text()[-12000:])
        raise
    finally:
        engine("buildx", "rm", source.BUILDER)


if __name__ == "__main__":
    main()
