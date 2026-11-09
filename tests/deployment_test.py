"""Run deployment orchestration against a fake local Docker engine, never a server."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD = 'a' * 40 + '@sha256:' + 'b' * 64
NEW = 'c' * 40 + '@sha256:' + 'd' * 64


class DeploymentTests(unittest.TestCase):
    def exercise(self, scenario, existing=True, version=NEW):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            state = root / 'state'
            state.mkdir()
            if existing:
                (state / 'current').write_text(OLD + '\n')
            active = root / 'active'
            active.write_text(OLD if existing else '')
            log = root / 'calls'
            docker = root / 'docker'
            docker.write_text(f'''#!/usr/bin/python3
import json, pathlib, sys
root = pathlib.Path({directory!r})
a = sys.argv[1:]
with (root/'calls').open('a') as f: f.write(json.dumps(a)+'\\n')
if 'pull' in a:
    sys.exit(1 if {scenario!r} == 'pull-fail' else 0)
if 'inspect' in a:
    print('unhealthy' if {scenario!r} == 'unhealthy' and (root/'active').read_text() == {NEW!r} else 'healthy')
if 'compose' in a:
    assert '--project-name' in a and a[a.index('--project-name')+1] == 'ekiden'
    assert a[a.index('-f')+1] == '/etc/ekiden/compose.yaml'
    assert a[-1] == 'web'
    if 'up' in a:
        import os
        version = os.environ['EKIDEN_IMAGE'].split('ekiden-database:')[1]
        (root/'active').write_text(version)
        if {scenario!r} == 'up-fail' and version == {NEW!r}: sys.exit(1)
    if 'ps' in a: print('fake-ekiden-id')
''')
            docker.chmod(0o700)
            curl = root / 'curl'
            curl.write_text('#!/bin/sh\nprintf \'%s\\n\' \'{"status":"ok","service":"ekiden-database"}\'\n')
            curl.chmod(0o700)
            script = (ROOT / 'ops/ekiden-deploy').read_text()
            # Substitute only host integrations in this isolated test copy.
            script = script.replace('$EUID -eq 0 && ', '')
            script = script.replace('/var/lib/ekiden', str(state)).replace('/run/lock/ekiden-deploy.lock', str(root / 'lock'))
            script = script.replace('/usr/bin/docker', str(docker)).replace('/usr/bin/curl', str(curl))
            result = subprocess.run(['bash', '-c', script, 'test-deploy', version], capture_output=True, text=True)
            calls = log.read_text() if log.exists() else ''
            current = (state / 'current').read_text().strip() if (state / 'current').exists() else None
            previous = (state / 'previous').read_text().strip() if (state / 'previous').exists() else None
            return result, current, previous, active.read_text(), calls

    def test_success_retains_previous(self):
        result, current, previous, active, _ = self.exercise('ok')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((current, previous, active), (NEW, OLD, NEW))

    def test_pull_failure_does_not_replace_container(self):
        result, current, _, active, calls = self.exercise('pull-fail')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((current, active), (OLD, OLD))
        self.assertNotIn('"up"', calls)

    def test_health_failure_rolls_back(self):
        result, current, _, active, _ = self.exercise('unhealthy')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((current, active), (OLD, OLD))
        self.assertIn('previous healthy image restored', result.stderr)

    def test_compose_failure_rolls_back(self):
        result, current, _, active, _ = self.exercise('up-fail')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((current, active), (OLD, OLD))

    def test_first_failure_stops_only_web(self):
        result, current, _, _, calls = self.exercise('unhealthy', existing=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(current)
        self.assertIn('"stop", "web"', calls)
        self.assertNotIn('"down"', calls)

    def test_rejects_untrusted_versions_before_docker(self):
        for value in ['latest', 'a' * 40, NEW + '; id', '../other', NEW + ' extra']:
            with self.subTest(value=value):
                result, _, _, _, calls = self.exercise('ok', version=value)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, '')

    def test_ssh_rejects_arbitrary_commands(self):
        for command in ['whoami', 'deploy latest', 'deploy ' + NEW + '; id', '', 'deploy ' + NEW + '\nid']:
            with self.subTest(command=command):
                result = subprocess.run(['bash', str(ROOT / 'ops/ekiden-ssh-command')], env={'SSH_ORIGINAL_COMMAND': command}, capture_output=True)
                self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
