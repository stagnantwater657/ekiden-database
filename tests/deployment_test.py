"""Protocol and rollback tests. No real Docker socket or server is contacted."""
import contextlib
import fcntl
import gzip
import hashlib
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader("ekiden_deploy", str(ROOT / "ops/ekiden-deploy"))
spec = importlib.util.spec_from_loader(loader.name, loader)
deploy = importlib.util.module_from_spec(spec)
loader.exec_module(deploy)
SHA = "a" * 40
OLD_SHA = "b" * 40
OLD_ID = "sha256:" + "c" * 64


def archive_fixture(sha=SHA, tags=None, revision=None, compressed_layer=False, bad_layer=False):
    layer_bytes = b"layer content for protocol tests"
    diff = "sha256:" + hashlib.sha256(layer_bytes).hexdigest()
    config = json.dumps({"os": "linux", "architecture": "amd64", "config": {
        "Labels": {"org.opencontainers.image.revision": revision or sha}},
        "rootfs": {"type": "layers", "diff_ids": [diff]}}).encode()
    image_id = "sha256:" + hashlib.sha256(config).hexdigest()
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as tar:
        entries = {"manifest.json": json.dumps([{
            "Config": "blobs/sha256/config", "RepoTags": tags or [deploy.REPOSITORY + ":" + sha],
            "Layers": ["blobs/sha256/layer"]}]).encode(),
            "blobs/sha256/config": config,
            "blobs/sha256/layer": gzip.compress(layer_bytes) if compressed_layer else layer_bytes,
            # Docker 29 exports OCI metadata alongside the Docker manifest.
            # This untrusted index MUST NOT be passed to docker load.
            "index.json": b'{"manifests":[{"annotations":{"io.containerd.image.name":"other:project"}}]}',
            "oci-layout": b'{"imageLayoutVersion":"1.0.0"}'}
        if bad_layer:
            entries["blobs/sha256/layer"] = b"tampered"
        for name, content in entries.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            tar.addfile(member, io.BytesIO(content))
    compressed = gzip.compress(output.getvalue())
    return compressed, image_id


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for child in ["uploads", "ready"]:
            (self.root / child).mkdir()
        self.patches = contextlib.ExitStack()
        self.addCleanup(self.patches.close)
        self.patches.enter_context(mock.patch.object(deploy, "STATE", self.root))
        self.patches.enter_context(mock.patch.object(deploy, "LOCK", self.root / "lock"))
        self.patches.enter_context(mock.patch.object(deploy, "MIN_FREE", 0))
        self.images = {}
        self.calls = []
        self.running = None
        self.fail_import = False
        self.fail_health = False
        self.native_id = None
        self.patches.enter_context(mock.patch.object(deploy.signal, "signal"))
        self.patches.enter_context(mock.patch.object(deploy, "engine", self.engine))
        self.patches.enter_context(mock.patch.object(deploy, "healthy", self.healthy))

    def engine(self, *args, **kwargs):
        self.calls.append(args)
        self.assertNotIn("pull", args)
        self.assertNotIn("prune", args)
        if args[:2] == ("image", "inspect"):
            if args[2] not in self.images:
                raise deploy.Rejected("No local image.")
            return json.dumps([self.images[args[2]]]).encode()
        if args[:2] == ("image", "load"):
            if self.fail_import:
                raise deploy.Rejected("Import failed.")
            with tarfile.open(args[3]) as tar:
                self.assertNotIn("index.json", tar.getnames())
                self.assertNotIn("oci-layout", tar.getnames())
                manifest = json.load(tar.extractfile("manifest.json"))[0]
                self.assertEqual(len(manifest["RepoTags"]), 1)
                config = tar.extractfile(manifest["Config"]).read()
                image_id = self.native_id or "sha256:" + hashlib.sha256(config).hexdigest()
                info = {"Id": image_id, "Config": json.loads(config)["config"]}
                self.images[manifest["RepoTags"][0]] = info
                self.images[image_id] = info
            return b"Loaded"
        if args[:2] == ("image", "tag"):
            self.images[args[3]] = self.images[args[2]]
        if args[:2] == ("container", "ls"):
            return b"123abc" if self.running else b""
        if args[0] == "compose":
            self.assertEqual(args[args.index("--project-name") + 1], "ekiden")
            self.assertEqual(args[args.index("-f") + 1], "/etc/ekiden/compose.yaml")
            self.assertEqual(args[-1], "web")
            if "up" in args:
                self.assertIn("never", args)
                self.running = self.images[kwargs["env_extra"]["EKIDEN_IMAGE"]]["Id"]
            if "stop" in args:
                self.running = None
        return b""

    def healthy(self, record):
        return self.running == record["image_id"] and not (self.fail_health and record["sha"] == SHA)

    def upload(self, payload=None, checksum=None, size=None):
        payload, image_id = archive_fixture() if payload is None else payload
        stream = self.root / "input"
        stream.write_bytes(payload)
        checksum = checksum or hashlib.sha256(payload).hexdigest()
        with stream.open("rb") as source, deploy.deployment_lock():
            deploy.upload(SHA, checksum, image_id, len(payload) if size is None else size, source.fileno())
        return deploy.image_record(SHA, self.images[deploy.REPOSITORY + ":" + SHA]["Id"], image_id)

    def seed_current(self, legacy=False):
        old = deploy.image_record(OLD_SHA, OLD_ID)
        info = {"Id": OLD_ID, "Config": {"Labels": {}}}
        self.images[OLD_ID] = info
        self.images[old["ref"]] = info
        self.running = OLD_ID
        if legacy:
            value = OLD_SHA + "@sha256:" + "d" * 64
            (self.root / "current").write_text(value)
            self.images[deploy.REPOSITORY + ":" + value] = info
        else:
            deploy.write_record(self.root / "current.json", old)
        return old

    def assert_clean(self):
        self.assertEqual(list((self.root / "uploads").iterdir()), [])

    def test_valid_upload_and_activation(self):
        record = self.upload()
        self.assertFalse((self.root / "current.json").exists())
        deploy.activate(record)
        self.assertEqual(json.loads((self.root / "current.json").read_text()), record)
        self.assert_clean()

    def test_wrong_checksum(self):
        with self.assertRaisesRegex(deploy.Rejected, "SHA-256"):
            self.upload(checksum="0" * 64)
        self.assertFalse(any(call[:2] == ("image", "load") for call in self.calls))
        self.assert_clean()

    def test_illegal_parameters(self):
        for args in [["deploy", "latest"], ["deploy", SHA + ";id"], ["deploy", SHA, "extra"],
                     ["upload", SHA, "0" * 64, OLD_ID, "0"],
                     ["upload", SHA, "0" * 64, OLD_ID, str(deploy.MAX_UPLOAD + 1)]]:
            with self.subTest(args=args), self.assertRaises(deploy.Rejected):
                deploy.parse_args(args)

    def test_interrupted_upload(self):
        with self.assertRaisesRegex(deploy.Rejected, "interrupted"):
            self.upload(size=1000000)
        self.assert_clean()

    def test_excess_bytes(self):
        with self.assertRaisesRegex(deploy.Rejected, "declared size"):
            self.upload(size=1)
        self.assert_clean()

    def test_expansion_size_limit(self):
        with mock.patch.object(deploy, "MAX_TAR", 100), self.assertRaises(deploy.Rejected):
            self.upload()
        self.assert_clean()

    def test_concurrent_operation_rejected(self):
        with deploy.deployment_lock():
            with self.assertRaisesRegex(deploy.Rejected, "Another"):
                with deploy.deployment_lock():
                    self.fail("lock was bypassed")
        self.assertEqual(self.calls, [])

    def test_import_failure_preserves_site_and_state(self):
        old = self.seed_current()
        self.fail_import = True
        with self.assertRaises(deploy.Rejected):
            self.upload()
        self.assertEqual(deploy.read_record("current"), old)
        self.assertEqual(self.running, OLD_ID)
        self.assertEqual(list((self.root / "ready").iterdir()), [])
        self.assert_clean()

    def test_failed_health_restores_previous_running_image(self):
        old = self.seed_current()
        record = self.upload()
        self.fail_health = True
        with self.assertRaises(deploy.Rejected):
            deploy.activate(record)
        self.assertEqual(self.running, OLD_ID)
        self.assertEqual(deploy.read_record("current"), old)

    def test_explicit_application_rollback(self):
        old = self.seed_current()
        record = self.upload()
        deploy.activate(record)
        self.assertEqual(deploy.read_record("previous"), old)
        deploy.activate(deploy.read_record("previous"), require_healthy_current=False)
        self.assertEqual(self.running, OLD_ID)
        self.assertEqual(deploy.read_record("previous"), record)

    def test_legacy_state_upgrade_without_registry_pull(self):
        old = self.seed_current(legacy=True)
        deploy.migrate()
        deploy.activate(self.upload())
        self.assertEqual(deploy.read_record("previous"), old)
        self.assertTrue((self.root / "current").exists())

    def test_upload_requires_explicit_legacy_migration(self):
        self.seed_current(legacy=True)
        with self.assertRaisesRegex(deploy.Rejected, "migrate"):
            self.upload()
        self.assert_clean()

    def test_unrecorded_live_website_is_not_replaced(self):
        record = self.upload()
        self.running = OLD_ID
        with self.assertRaisesRegex(deploy.Rejected, "Unrecorded"):
            deploy.activate(record)
        self.assertEqual(self.running, OLD_ID)

    def test_first_failure_stops_only_web_and_records_no_current(self):
        record = self.upload()
        self.fail_health = True
        with self.assertRaises(deploy.Rejected):
            deploy.activate(record)
        self.assertIsNone(self.running)
        self.assertFalse((self.root / "current.json").exists())

    def test_rejects_other_project_tags(self):
        with self.assertRaisesRegex(deploy.Rejected, "tag"):
            self.upload(archive_fixture(tags=["astrbot:latest"]))
        self.assertFalse(any(call[:2] == ("image", "load") for call in self.calls))
        self.assert_clean()

    def test_wrong_revision_and_corrupt_layer(self):
        for fixture in [archive_fixture(revision="f" * 40), archive_fixture(bad_layer=True)]:
            with self.subTest(fixture=fixture[1]), self.assertRaises(deploy.Rejected):
                self.upload(fixture)
            self.assert_clean()

    def test_rejects_unsafe_outer_archive_members(self):
        original, image_id = archive_fixture()
        for name, kind in [("../../etc/unsafe", tarfile.REGTYPE),
                           ("/tmp/unsafe", tarfile.REGTYPE), ("link", tarfile.SYMTYPE)]:
            with self.subTest(name=name):
                raw = io.BytesIO(gzip.decompress(original))
                with tarfile.open(fileobj=raw, mode="a") as archive:
                    entry = tarfile.TarInfo(name)
                    entry.type = kind
                    entry.linkname = "/etc/unsafe" if kind == tarfile.SYMTYPE else ""
                    archive.addfile(entry)
                with self.assertRaises(deploy.Rejected):
                    self.upload((gzip.compress(raw.getvalue()), image_id))
                self.assert_clean()

    def test_compressed_oci_layer_is_canonicalized(self):
        self.upload(archive_fixture(compressed_layer=True))
        self.assert_clean()

    def test_upload_does_not_retarget_running_local_reference(self):
        old = self.seed_current()
        self.images[deploy.REPOSITORY + ":" + SHA] = {"Id": OLD_ID}
        self.upload()
        self.assertEqual(self.running, OLD_ID)
        self.assertEqual(self.images[old["ref"]]["Id"], OLD_ID)
        self.assert_clean()

    def test_containerd_native_id_can_differ_from_config_digest(self):
        self.native_id = "sha256:" + "9" * 64
        record = self.upload()
        self.assertNotEqual(record["image_id"], record["config_digest"])
        self.assertIn(self.native_id.removeprefix("sha256:"), record["ref"])
        deploy.activate(record)
        self.assertEqual(self.running, self.native_id)

    def test_signal_interruption_cleans_temporary_upload(self):
        with mock.patch.object(deploy, "receive", side_effect=deploy.Rejected("Operation interrupted.")):
            with self.assertRaises(deploy.Rejected):
                self.upload()
        self.assert_clean()

    def test_receive_idle_timeout(self):
        read_fd, write_fd = os.pipe()
        try:
            with mock.patch.object(deploy, "UPLOAD_SECONDS", 0.01), self.assertRaisesRegex(deploy.Rejected, "timed out"):
                deploy.receive(read_fd, self.root / "timeout", 10, "0" * 64)
        finally:
            os.close(read_fd)
            os.close(write_fd)

    def test_runner_pipeline_modes_failures_and_secret_redaction(self):
        payload, config_digest = archive_fixture()
        archive = self.root / "runner.tar.gz"
        archive.write_bytes(payload)
        ssh = self.root / "ssh"
        ssh.write_text("""#!/usr/bin/python3
import sys, os, json, hashlib
args = sys.argv[1:]
command = args[-1].split(' ')
assert 'StrictHostKeyChecking=yes' in args and 'BatchMode=yes' in args
if command[0] == 'upload':
    assert '-n' not in args
    payload = sys.stdin.buffer.read()
    assert len(payload) == int(command[4])
    assert hashlib.sha256(payload).hexdigest() == command[2]
else:
    assert '-n' in args and command[0] == 'deploy'
with open(os.environ['TEST_CALLS'], 'a') as log: log.write(command[0]+'\\n')
if os.environ.get('FAIL_STAGE') == command[0]:
    print('private-key-marker secret-error-marker', file=sys.stderr)
    sys.exit(1)
""")
        ssh.chmod(0o700)
        log = self.root / "ssh-calls"
        env = dict(os.environ, PATH=str(self.root)+":"+os.environ["PATH"], RUNNER_TEMP=str(self.root),
                   TEST_CALLS=str(log), DEPLOY_SSH_KEY="private-key-marker", DEPLOY_HOST="host-marker",
                   DEPLOY_USER="ekiden-deploy", DEPLOY_PORT="22", DEPLOY_KNOWN_HOSTS="known-host-marker",
                   IMAGE_SHA=SHA, CONFIG_DIGEST=config_digest)
        for mode, fail, expected in [([], "", ["upload", "deploy"]),
                                     (["--upload-only"], "", ["upload"]),
                                     ([], "upload", ["upload"]), ([], "deploy", ["upload", "deploy"])]:
            with self.subTest(mode=mode, fail=fail):
                log.unlink(missing_ok=True)
                result = subprocess.run(["bash", str(ROOT / "ops/runner-transfer.sh"), str(archive), *mode],
                                        env=env | {"FAIL_STAGE": fail}, capture_output=True, text=True)
                self.assertEqual(result.returncode, 1 if fail else 0, result.stderr)
                self.assertEqual(log.read_text().splitlines(), expected)
                for secret in ["private-key-marker", "host-marker", "known-host-marker", "secret-error-marker"]:
                    self.assertNotIn(secret, result.stdout + result.stderr)
                self.assertEqual(list(self.root.glob("ekiden-transfer.*")), [])

    def test_forcecommand_exact_grammar_and_no_arbitrary_shell(self):
        sudo = self.root / "sudo"
        sudo.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
        sudo.chmod(0o700)
        wrapper = self.root / "wrapper"
        wrapper.write_text((ROOT / "ops/ekiden-ssh-command").read_text().replace("/usr/bin/sudo", str(sudo)))
        for command in ["whoami", "deploy latest", "deploy " + SHA + "; id", "deploy " + SHA + "\nid", "$(id)",
                        "upload " + SHA + " 0 " + OLD_ID + " 10", "deploy " + SHA + " extra"]:
            result = subprocess.run(["bash", str(wrapper)], env={"SSH_ORIGINAL_COMMAND": command}, capture_output=True)
            self.assertNotEqual(result.returncode, 0, command)
        for command in ["deploy " + SHA + " " + OLD_ID, "upload " + SHA + " " + "0" * 64 + " " + OLD_ID + " 10"]:
            result = subprocess.run(["bash", str(wrapper)], env={"SSH_ORIGINAL_COMMAND": command}, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(b"/usr/local/sbin/ekiden-deploy", result.stdout)


if __name__ == "__main__":
    unittest.main()
