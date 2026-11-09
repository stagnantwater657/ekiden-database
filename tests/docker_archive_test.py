"""Real save -> gzip -> validate/normalize -> load test on an isolated local daemon.

Only run against a development/CI Unix socket, never a production Docker context.
"""
import gzip
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader("archive_protocol", str(ROOT / "ops/ekiden-deploy"))
spec = importlib.util.spec_from_loader(loader.name, loader)
protocol = importlib.util.module_from_spec(spec)
loader.exec_module(protocol)


def main():
    if os.environ.get("EKIDEN_DOCKER_TEST") != "1" or len(sys.argv) != 2:
        sys.exit("Set EKIDEN_DOCKER_TEST=1 on an isolated daemon and pass a fixture commit SHA")
    sha = sys.argv[1]
    assert re.fullmatch(protocol.SHA, sha)
    socket = os.environ.get("DOCKER_TEST_SOCKET", "/var/run/docker.sock")
    if socket.startswith("unix://"):
        socket = socket[7:]
    assert socket.startswith("/") and ":" not in socket, "Only a local Unix socket is allowed"
    docker = ["docker", "--host", "unix://" + socket]
    env = {key: value for key, value in os.environ.items()
           if key not in {"DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"}}

    def call(*args):
        return subprocess.check_output([*docker, *args], env=env, timeout=600)

    image = protocol.REPOSITORY + ":" + sha
    before = json.loads(call("image", "inspect", image))[0]
    assert before["Config"]["Labels"]["org.opencontainers.image.revision"] == sha
    with tempfile.TemporaryDirectory(dir=os.environ.get("RUNNER_TEMP") or os.environ.get("TEST_TMPDIR")) as tmp:
        directory = Path(tmp)
        compressed = directory / "image.tar.gz"
        with compressed.open("wb") as output, subprocess.Popen([*docker, "image", "save", image],
                                                               stdout=subprocess.PIPE, env=env) as export:
            with gzip.GzipFile(fileobj=output, mode="wb", compresslevel=1, mtime=0) as zipper:
                shutil.copyfileobj(export.stdout, zipper)
            assert export.wait(timeout=600) == 0
        metadata_loader = importlib.machinery.SourceFileLoader("metadata", str(ROOT / "ops/image-metadata.py"))
        metadata_spec = importlib.util.spec_from_loader(metadata_loader.name, metadata_loader)
        metadata = importlib.util.module_from_spec(metadata_spec)
        metadata_loader.exec_module(metadata)
        digest = metadata.metadata(compressed, sha)
        canonical = directory / "canonical.tar"
        protocol.canonical_archive(compressed, canonical, sha, digest)
        call("image", "load", "--input", str(canonical))
        after = json.loads(call("image", "inspect", image))[0]
        assert after["Config"]["Labels"]["org.opencontainers.image.revision"] == sha
        record = protocol.image_record(sha, after["Id"], digest)
        call("image", "tag", after["Id"], record["ref"])
        assert json.loads(call("image", "inspect", record["ref"]))[0]["Id"] == after["Id"]
        name = "ekiden-archive-compat-" + sha[:12]
        try:
            call("run", "-d", "--name", name, "--network", "none", "--read-only",
                 "--tmpfs", "/tmp:size=32m,mode=1777", "--cap-drop", "ALL",
                 "--security-opt", "no-new-privileges:true", record["ref"])
            for attempt in range(45):
                container = json.loads(call("container", "inspect", name))[0]
                assert container["Image"] in {after["Id"], digest}
                if container["State"]["Health"]["Status"] == "healthy":
                    break
                if attempt == 44:
                    raise AssertionError("Loaded image did not become healthy")
                time.sleep(1)
        finally:
            call("container", "rm", "-f", name)
            call("image", "rm", record["ref"])
    print("PASS: Docker save/gzip/canonical load, local ID reference and application health")
    print("Native ID equals config digest:", after["Id"] == digest)


if __name__ == "__main__":
    main()
