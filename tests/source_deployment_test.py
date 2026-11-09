"""Offline source admission/build failure tests; no production daemon/network."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

source = load("source", "ops/ekiden-source.py")
policy = load("source_policy", "ops/source-policy.py")
old_tests = load("old_tests", "tests/deployment_test.py")
SHA = old_tests.SHA
ID = "sha256:" + "e" * 64
CONFIG = {"node_image": "m.daocloud.io/docker.io/library/node:24-bookworm-slim@sha256:" + "1"*64,
          "buildkit_image": "m.daocloud.io/docker.io/moby/buildkit:v0.26.2@sha256:" + "2"*64}


class PolicyTests(unittest.TestCase):
    def responses(self, sha=SHA, conclusion="success"):
        run = {"id": 7, "event": "push", "head_sha": sha, "head_branch": "main",
               "path": ".github/workflows/ci.yml", "repository": {"full_name": policy.REPO},
               "status": "completed", "conclusion": conclusion}
        jobs = [{"name": name, "status": "completed", "conclusion": "success"} for name in policy.REQUIRED_JOBS]
        return [{"commit": {"sha": sha}}, {"workflow_runs": [run]}, {"total_count": len(jobs), "jobs": jobs}]

    def test_current_main_with_every_required_push_ci_job(self):
        policy.approve(SHA, get=mock.Mock(side_effect=self.responses()))

    def test_non_main_or_invalid_sha_rejected(self):
        for sha in ["latest", SHA+";id", SHA+" extra", "A"*40]:
            with self.assertRaises(policy.PolicyError):
                policy.approve(sha, get=mock.Mock())
        with self.assertRaisesRegex(policy.PolicyError, "MAIN_SHA_MISMATCH"):
            policy.approve("b"*40, get=mock.Mock(side_effect=self.responses()))

    def test_failed_pending_skipped_or_missing_ci_fails_closed(self):
        for case in ["failed", "pending", "skipped", "missing", "pr-only"]:
            data = self.responses()
            if case == "failed": data[1]["workflow_runs"][0]["conclusion"] = "failure"
            if case == "pending": data[1]["workflow_runs"][0]["status"] = "in_progress"
            if case == "skipped": data[2]["jobs"][0]["conclusion"] = "skipped"
            if case == "missing": data[2]["jobs"].pop()
            if case == "pr-only": data[1]["workflow_runs"][0]["event"] = "pull_request"
            with self.subTest(case=case), self.assertRaises(policy.PolicyError):
                policy.approve(SHA, get=mock.Mock(side_effect=data))


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.base = old_tests.ProtocolTests()
        self.base.setUp()
        self.addCleanup(self.base.doCleanups)
        self.api = old_tests.deploy
        self.state = self.base.root
        (self.state / "source-builds").mkdir()
        self.patches = self.base.patches
        self.patches.enter_context(mock.patch.object(source, "MIN_DISK", 0))
        self.patches.enter_context(mock.patch.object(source, "load_config", return_value=CONFIG))
        self.patches.enter_context(mock.patch.object(source, "read_token", return_value=None))
        self.approve = mock.Mock()
        self.patches.enter_context(mock.patch.object(source, "load_policy", return_value=mock.Mock(approve=self.approve, PolicyError=policy.PolicyError)))
        self.fetch = self.patches.enter_context(mock.patch.object(source, "fetch_main", return_value=self.state / "repo"))
        self.patches.enter_context(mock.patch.object(source, "checkout", return_value=self.state))
        self.verify = self.patches.enter_context(mock.patch.object(source, "verify_builder"))
        self.patches.enter_context(mock.patch.object(source, "resource_probe"))
        self.patches.enter_context(mock.patch.object(source, "image_config_digest", return_value=ID))
        self.build = self.patches.enter_context(mock.patch.object(source, "build_command", side_effect=self.successful_build))

    def successful_build(self, api, args, logfile, timeout):
        self.assertEqual(timeout, 1200)
        self.assertIn("BUILD_NODE_OPTIONS=--max-old-space-size=768", args)
        self.assertIn("BUILD_CPUS=1", args)
        self.assertIn("NPM_REGISTRY=https://registry.npmmirror.com", args)
        metadata = Path(args[args.index("--metadata-file")+1])
        metadata.write_text(json.dumps({"containerimage.config.digest": ID}))
        info = {"Id": ID, "Config": {"Labels": {"org.opencontainers.image.revision": SHA}}}
        self.base.images["ekiden-source:"+SHA] = info
        self.base.images[ID] = info

    def test_approved_main_build_and_activate_reuses_existing_state(self):
        previous = self.base.seed_current()
        source.run(self.api, SHA)
        self.assertEqual(self.base.running, ID)
        self.assertEqual(self.api.read_record("previous"), previous)
        self.assertEqual(self.fetch.call_count, 2)
        self.assertEqual(self.approve.call_count, 2)

    def test_build_only_does_not_update_current_or_containers(self):
        previous = self.base.seed_current()
        source.run(self.api, SHA, build_only=True)
        self.assertEqual(self.api.read_record("current"), previous)
        self.assertEqual(self.base.running, old_tests.OLD_ID)
        self.assertTrue((self.state / "ready" / (SHA+".json")).exists())
        self.assertFalse(any("up" in call for call in self.base.calls))

    def test_first_deploy_has_no_previous_image(self):
        source.run(self.api, SHA)
        self.assertEqual(self.base.running, ID)
        self.assertFalse((self.state / "previous.json").exists())

    def test_health_failure_restores_old_website(self):
        previous = self.base.seed_current()
        self.base.fail_health = True
        with self.assertRaisesRegex(source.SourceError, "SOURCE_HEALTH_FAILED"):
            source.run(self.api, SHA)
        self.assertEqual(self.base.running, old_tests.OLD_ID)
        self.assertEqual(self.api.read_record("current"), previous)

    def test_all_pre_activation_failures_preserve_current_and_bots(self):
        previous = self.base.seed_current()
        for code in ["NPM_CI_FAILED", "SOURCE_BUILD_OOM", "SOURCE_BUILD_TIMEOUT", "SOURCE_BUILD_FAILED"]:
            self.build.side_effect = source.SourceError(code)
            with self.subTest(code=code), self.assertRaisesRegex(source.SourceError, code):
                source.run(self.api, SHA)
            self.assertEqual(self.base.running, old_tests.OLD_ID)
            self.assertEqual(self.api.read_record("current"), previous)
        self.assertFalse(any("compose" in call for call in self.base.calls))
        self.assertFalse(any("AstrBot" in str(call) or "NapCat" in str(call) for call in self.base.calls))

    def test_source_fetch_timeout_or_non_main_does_not_build(self):
        for code in ["SOURCE_FETCH_TIMEOUT", "MAIN_SHA_MISMATCH"]:
            self.fetch.side_effect = source.SourceError(code)
            with self.assertRaisesRegex(source.SourceError, code):
                source.run(self.api, SHA)
        self.build.assert_not_called()

    def test_main_moving_during_build_prevents_activation(self):
        previous = self.base.seed_current()
        self.fetch.side_effect = [self.state / "repo", source.SourceError("MAIN_SHA_MISMATCH")]
        with self.assertRaisesRegex(source.SourceError, "MAIN_SHA_MISMATCH"):
            source.run(self.api, SHA)
        self.assertEqual(self.api.read_record("current"), previous)

    def test_low_disk_and_unavailable_base_image(self):
        with mock.patch.object(source, "MIN_DISK", 10**30), self.assertRaisesRegex(source.SourceError, "SOURCE_DISK_LOW"):
            source.run(self.api, SHA)
        self.verify.side_effect = source.SourceError("BUILD_IMAGE_UNAVAILABLE")
        with self.assertRaisesRegex(source.SourceError, "BUILD_IMAGE_UNAVAILABLE"):
            source.run(self.api, SHA)
        self.build.assert_not_called()

    def test_concurrent_operation_fails_before_build(self):
        with self.api.deployment_lock(), self.assertRaises(self.api.Rejected):
            with self.api.deployment_lock():
                source.run(self.api, SHA)
        self.build.assert_not_called()

    def test_wrapper_and_root_reject_injection_or_extra_parameters(self):
        wrapper = (ROOT / "ops/ekiden-ssh-command").read_text()
        sudo = self.state / "sudo"
        sudo.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
        sudo.chmod(0o700)
        path = self.state / "wrapper"
        path.write_text(wrapper.replace("/usr/bin/sudo", str(sudo)))
        for verb in ["deploy-source", "build-source"]:
            for sha in ["latest", SHA+";id", SHA+" extra", SHA+"\nid", "A"*40]:
                command = verb + " " + sha
                with self.subTest(command=command), self.assertRaises(self.api.Rejected):
                    self.api.parse_args([verb, sha])
                result = subprocess.run(["bash", str(path)], env={"SSH_ORIGINAL_COMMAND": command}, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.api.parse_args([verb, SHA]), (verb, SHA))
            result = subprocess.run(["bash", str(path)], env={"SSH_ORIGINAL_COMMAND": verb+" "+SHA}, capture_output=True)
            self.assertEqual(result.returncode, 0)


class LowLevelTests(unittest.TestCase):
    def test_git_fetch_timeout_is_typed_without_printing_credentials(self):
        with mock.patch.object(source.subprocess, "run", side_effect=subprocess.TimeoutExpired("git", 180)):
            with self.assertRaisesRegex(source.SourceError, "SOURCE_FETCH_TIMEOUT"):
                source.git(["fetch"], token="private-token-marker")

    def test_docker_build_error_classification_and_timeout_stop_only_builder(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "build.log"
            api = mock.Mock(DOCKER="/usr/bin/docker")
            for message, expected in [(b"EKIDEN_NPM_CI_FAILED", "NPM_CI_FAILED"),
                                      (b"JavaScript heap out of memory", "SOURCE_BUILD_OOM"),
                                      (b"exit code: 137", "SOURCE_BUILD_OOM"),
                                      (b"failed to resolve source metadata", "BUILD_IMAGE_UNAVAILABLE"),
                                      (b"compiler failed", "SOURCE_BUILD_FAILED")]:
                def result(_cmd, **kwargs):
                    kwargs["stdout"].write(message)
                    return subprocess.CompletedProcess([], 1)
                with mock.patch.object(source.subprocess, "run", side_effect=result), self.assertRaisesRegex(source.SourceError, expected):
                    source.build_command(api, [], log, 1200)
            with mock.patch.object(source.subprocess, "run", side_effect=subprocess.TimeoutExpired("buildx", 1200)):
                with self.assertRaisesRegex(source.SourceError, "SOURCE_BUILD_TIMEOUT"):
                    source.build_command(api, [], log, 1200)
            api.engine.assert_any_call("container", "stop", "--time", "10", source.CONTAINER)

    def test_worker_pid_must_be_inside_fixed_resource_budget(self):
        with mock.patch.object(source.Path, "read_text", return_value="0::/ekiden-build/buildkit/abc\n"):
            self.assertEqual(source.process_cgroup(123), "/ekiden-build/buildkit/abc")
        for path in ["/", ""]:
            with mock.patch.object(source.Path, "read_text", return_value="0::"+path+"\n"), self.assertRaises(source.SourceError):
                source.process_cgroup(123)

    def test_real_builder_cgroup_limits_not_just_requested_flags(self):
        builder = {"Id": "a"*64, "State": {"Running": True, "Pid": 123}, "Config": {"Image": CONFIG["buildkit_image"], "Cmd": ["--oci-worker-gc=false", "--allow-insecure-entitlement=network.host"]},
                   "HostConfig": {"Memory": source.MEMORY, "MemorySwap": source.MEMORY, "CpuPeriod": 100000,
                                  "CpuQuota": 125000, "NetworkMode": "default", "CgroupnsMode": "private"},
                   "Mounts": [{"Type": "volume", "Name": source.CONTAINER+"_state", "Destination": "/var/lib/buildkit"}]}
        info = {"Name": source.BUILDER, "Driver": "docker-container", "Nodes": [{"Endpoint": "unix:///var/run/docker.sock"}]}
        def api_with(limits):
            def engine(*args, **_kwargs):
                if args[:2] == ("buildx", "ls"): return (json.dumps(info)+"\n"+json.dumps(info)).encode()
                if args[:2] == ("container", "inspect"): return json.dumps([builder]).encode()
                if args[0] == "exec": return limits
                return b"[]"
            return mock.Mock(engine=engine)
        with mock.patch.object(source, "builder_group", return_value=Path("/sys/fs/cgroup/daemon")), \
             mock.patch.object(source, "process_cgroup", return_value="/daemon"), \
             mock.patch.object(source, "read_limits", return_value=["1610612736", "125000 100000", "0"]):
            source.verify_builder(api_with(b"268435456\n25000 100000\n0\n"), CONFIG)
        for limits in [["max", "max 100000", "max"], ["8589934592", "125000 100000", "0"]]:
            with mock.patch.object(source, "process_cgroup", return_value="/daemon"), \
                 mock.patch.object(source, "read_limits", return_value=limits), self.assertRaisesRegex(source.SourceError, "BUILD_LIMITS_INVALID"):
                source.verify_builder(api_with(b""), CONFIG)
        builder["Mounts"].append({"Type": "bind", "Source": "/var/run/docker.sock", "Destination": "/var/run/docker.sock"})
        with self.assertRaisesRegex(source.SourceError, "BUILD_LIMITS_INVALID"):
            source.verify_builder(api_with(b"268435456\n25000 100000\n0\n"), CONFIG)


class LocalIdentityTests(unittest.TestCase):
    def test_local_archive_identity_and_cleanup_on_rejection_or_timeout(self):
        import io
        import hashlib
        import tarfile
        tag = "ekiden-source:"+SHA
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = mock.Mock(DOCKER="/usr/bin/docker")
            for revision in [SHA, "b"*40]:
                config = json.dumps({"config": {"Labels": {"org.opencontainers.image.revision": revision}}}).encode()
                def save(_command, **kwargs):
                    with tarfile.open(fileobj=kwargs["stdout"], mode="w") as archive:
                        for name, data in [("manifest.json", json.dumps([{"RepoTags": [tag], "Config": "config.json"}]).encode()), ("config.json", config)]:
                            member = tarfile.TarInfo(name); member.size = len(data)
                            archive.addfile(member, io.BytesIO(data))
                with mock.patch.object(source.subprocess, "run", side_effect=save):
                    if revision == SHA:
                        self.assertEqual(source.image_config_digest(api, tag, SHA, root), "sha256:"+hashlib.sha256(config).hexdigest())
                    else:
                        with self.assertRaisesRegex(source.SourceError, "SOURCE_IMAGE_IDENTITY_FAILED"):
                            source.image_config_digest(api, tag, SHA, root)
                self.assertFalse((root/"identity.tar").exists())
            with mock.patch.object(source.subprocess, "run", side_effect=subprocess.TimeoutExpired("save", 180)), self.assertRaises(source.SourceError):
                source.image_config_digest(api, tag, SHA, root)
            self.assertFalse((root/"identity.tar").exists())


class AncestorTests(unittest.TestCase):
    def test_daemon_init_leaf_resolves_to_fixed_docker_ancestor(self):
        identity = "a"*64
        builder = {"Id": identity, "State": {"Pid": 123}}
        for prefix in ["/system.slice/docker-"+identity+".scope", "/docker/"+identity]:
            with mock.patch.object(source, "process_cgroup", return_value=prefix+"/init"):
                self.assertEqual(source.builder_group(builder), Path("/sys/fs/cgroup"+prefix))
        with mock.patch.object(source, "process_cgroup", return_value="/init"), self.assertRaises(source.SourceError):
            source.builder_group(builder)


if __name__ == "__main__":
    unittest.main()
