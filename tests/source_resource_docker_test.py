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
    engine("buildx", "create", "--name", source.BUILDER, "--driver", "docker-container",
           "--driver-opt", "image="+config["buildkit_image"],
           "--driver-opt", "memory=1536m,memory-swap=1536m,cpu-period=100000,cpu-quota=125000",
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
                raise
            print("PASS actual builder and worker memory/CPU/swap limits")
            oom = root / "oom"
            oom.mkdir()
            # Commit physical pages beyond the hard cgroup cap; heap flags cannot bypass it.
            (oom/"Dockerfile").write_text("ARG NODE_IMAGE\nFROM ${NODE_IMAGE}\nRUN node -e 'const a=[];for(let i=0;i<1800;i++)a.push(Buffer.alloc(1048576,1));console.log(\"UNBOUNDED\")'\n")
            try:
                source.build_command(api, ["--build-arg", "NODE_IMAGE="+config["node_image"], str(oom)], root/"oom.log", 120)
                raise AssertionError("OOM probe unexpectedly succeeded")
            except source.SourceError as error:
                if error.code != "SOURCE_BUILD_OOM":
                    print((root/"oom.log").read_text()[-8000:])
                    raise
            print("PASS actual cgroup OOM rejection")
            # Official registry/base in CI; the same 768 MiB heap and one worker as production.
            source.build_command(api, ["--load", "--build-arg", "NODE_IMAGE="+config["node_image"],
                                      "--build-arg", "BUILD_NODE_OPTIONS=--max-old-space-size=768",
                                      "--build-arg", "BUILD_CPUS=1", "--tag", "ekiden-source-ci:checked", str(ROOT)], root/"app.log", 1200)
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
