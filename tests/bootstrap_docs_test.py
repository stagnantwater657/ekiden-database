"""Execute documented standalone bootstrap gates and recovery in mock/temp roots."""
import contextlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
DOC = (ROOT/'docs/SOURCE_DEPLOYMENT.md').read_text()
BLOCKS = re.findall(r"python3(?: -I)? - <<'PY'\n(.*?)\nPY", DOC, re.S)
SHA = 'a'*40
JOBS = ['check', 'Docker 29.1.3 containerd archive compatibility',
        'COS benchmark offline SDK tests', 'Source deployment policy and resource limits']


class BootstrapTests(unittest.TestCase):
    def test_all_documented_python_and_bash_snippets_compile(self):
        for block in BLOCKS: compile(block, 'SOURCE_DEPLOYMENT.md', 'exec')
        for block in re.findall(r'```bash\n(.*?)\n```', DOC, re.S):
            result = subprocess.run(['bash', '-n'], input=block, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_embedded_policy_matches_runtime_policy_without_installed_imports(self):
        block = next(b for b in BLOCKS if 'class PolicyError' in b)
        policy = (ROOT/'ops/source-policy.py').read_text().split('if __name__ == "__main__":')[0].strip()
        self.assertTrue(block.startswith(policy))
        self.assertNotIn('/usr/local/libexec', block)
        self.assertNotIn('importlib', block)

    def test_standalone_api_gate_main_ci_jobs_signature_and_credential_scope(self):
        block = next(b for b in BLOCKS if 'class PolicyError' in b)
        for case in ['ok', 'non-main', 'failed', 'missing-job', 'skipped-job', 'unsigned', 'invalid-signature', 'api-failure']:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root/'github-read-token').write_text('private-token-marker')
                urls = []
                def open_response(request, timeout):
                    self.assertEqual(timeout, 15)
                    self.assertTrue(request.full_url.startswith('https://api.github.com/repos/stagnantwater657/ekiden-database/'))
                    self.assertEqual(request.get_header('Authorization'), 'Bearer private-token-marker')
                    urls.append(request.full_url)
                    if case == 'api-failure': raise TimeoutError('synthetic timeout')
                    if '/branches/main' in request.full_url:
                        data = {'commit': {'sha': 'b'*40 if case == 'non-main' else SHA}}
                    elif '/workflows/ci.yml/runs?' in request.full_url:
                        data = {'workflow_runs': [{'id': 1, 'event': 'push', 'head_sha': SHA, 'head_branch': 'main',
                                                  'path': '.github/workflows/ci.yml', 'repository': {'full_name': 'stagnantwater657/ekiden-database'},
                                                  'status': 'completed', 'conclusion': 'failure' if case == 'failed' else 'success'}]}
                    elif '/jobs?' in request.full_url:
                        jobs = [{'name': name, 'status': 'completed', 'conclusion': 'success'} for name in JOBS]
                        if case == 'missing-job': jobs.pop()
                        if case == 'skipped-job': jobs[0]['conclusion'] = 'skipped'
                        data = {'total_count': len(jobs), 'jobs': jobs}
                    elif '/commits/' in request.full_url:
                        data = {'sha': SHA, 'commit': {'verification': {'verified': case not in {'unsigned', 'invalid-signature'},
                                                                      'reason': 'unsigned' if case == 'unsigned' else 'bad_signature' if case == 'invalid-signature' else 'valid'}}}
                    else: self.fail('Unexpected API path')
                    return contextlib.closing(io.BytesIO(json.dumps(data).encode()))
                opener = mock.Mock(open=open_response)
                output = io.StringIO()
                with mock.patch.dict(os.environ, UPGRADE_DIR=directory, REVIEWED_SHA=SHA), \
                     mock.patch('urllib.request.build_opener', return_value=opener), contextlib.redirect_stdout(output):
                    if case == 'ok': exec(compile(block, 'bootstrap-api', 'exec'), {})
                    else:
                        with self.assertRaises((Exception, SystemExit)): exec(compile(block, 'bootstrap-api', 'exec'), {})
                self.assertNotIn('private-token-marker', output.getvalue())
                if case == 'ok':
                    self.assertEqual((root/'header').stat().st_mode & 0o777, 0o600)
                    self.assertEqual(len(urls), 4)
                else: self.assertFalse((root/'header').exists())

    def test_digest_mismatch_stops_before_extraction(self):
        block = next(b for b in BLOCKS if 'import gzip, os, shutil, tarfile' in b)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'source.tar.gz').write_bytes(b'untrusted not even gzip')
            with mock.patch.dict(os.environ, UPGRADE_DIR=directory, REVIEWED_SHA=SHA, EXPECTED_ARCHIVE_SHA256='0'*64):
                with self.assertRaisesRegex(SystemExit, 'SHA-256 mismatch'): exec(compile(block, 'bootstrap-extract', 'exec'), {})
            self.assertFalse((root/'context').exists())
            self.assertFalse((root/'source.tar').exists())

    def test_backup_and_recovery_work_when_helpers_never_existed(self):
        bash = re.findall(r'```bash\n(.*?)\n```', DOC, re.S)
        backup = next(b for b in bash if 'cp -a --parents' in b)
        restore = next(b for b in bash if '"$SOURCE_BACKUP$file"' in b)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prefixes = ['/var/backups/ekiden', '/usr/local', '/etc/sudoers.d', '/etc/ekiden', '/var/lib/ekiden', '/run/lock']
            def mapped(path): return root/path.lstrip('/')
            def remap(text):
                for prefix in prefixes: text=text.replace(prefix, str(mapped(prefix)))
                text=text.replace('-o root -g root ', '')
                text=text.replace('/usr/bin/docker', str(root/'docker'))
                text=text.replace('/usr/sbin/sshd', '/bin/true').replace('visudo -cf', 'true').replace('visudo -c', 'true')
                return text
            for path in ['/usr/local/sbin/ekiden-deploy','/usr/local/libexec/ekiden-ssh-command', '/etc/sudoers.d/ekiden-deploy', '/etc/ekiden/compose.yaml','/etc/ekiden/runtime.env']:
                target=mapped(path); target.parent.mkdir(parents=True, exist_ok=True); target.write_text('old:'+path)
            mapped('/run/lock').mkdir(parents=True)
            mapped('/var/lib/ekiden').mkdir(parents=True)
            mapped('/var/lib/ekiden/current.json').write_text('old-state')
            docker=root/'docker'; docker.write_text('#!/bin/sh\necho "AstrBot bot-id healthy unchanged-port"\necho "NapCat nap-id healthy unchanged-port"\n'); docker.chmod(0o700)
            result=subprocess.run(['bash','-euc',remap(backup)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            saved=next(mapped('/var/backups/ekiden').glob('source-upgrade.*'))
            # Simulate a partly completed first install, not a running deployment.
            mapped('/usr/local/sbin/ekiden-deploy').write_text('new-program')
            for path in ['/usr/local/libexec/ekiden-source.py','/usr/local/libexec/ekiden-source-policy.py','/etc/ekiden/source-builder.json']:
                mapped(path).write_text('new-file')
            mapped('/var/lib/ekiden/current.json').write_text('new-state-must-not-be-overwritten')
            result=subprocess.run(['bash','-euc',remap(restore)],input=str(saved)+'\n',text=True,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(mapped('/usr/local/sbin/ekiden-deploy').read_text(),'old:/usr/local/sbin/ekiden-deploy')
            self.assertFalse(mapped('/usr/local/libexec/ekiden-source.py').exists())
            self.assertFalse(mapped('/usr/local/libexec/ekiden-source-policy.py').exists())
            self.assertFalse(mapped('/etc/ekiden/source-builder.json').exists())
            self.assertEqual(mapped('/var/lib/ekiden/current.json').read_text(),'new-state-must-not-be-overwritten')
            self.assertIn('AstrBot bot-id',result.stdout)
            self.assertIn('NapCat nap-id',result.stdout)


if __name__ == '__main__': unittest.main()
