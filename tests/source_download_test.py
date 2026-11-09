"""Codeload protocol/archive tests with synthetic HTTP and tar data only."""
import gzip
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("source_download", ROOT/"ops/ekiden-source.py")
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
SHA = "a"*40
PREFIX = "ekiden-database-"+SHA


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def response(self, code=0, status=b"200 0.123456", payload=b"archive"):
        def run(command, **kwargs):
            self.assertEqual(command[-1], "https://codeload.github.com/stagnantwater657/ekiden-database/tar.gz/"+SHA)
            self.assertNotIn("--location", command)
            self.assertNotIn("--insecure", command)
            self.assertEqual(command[1], "--disable")
            self.assertIn("--connect-timeout", command)
            self.assertIn("--speed-time", command)
            self.assertLessEqual(kwargs["timeout"], source.DOWNLOAD_SECONDS+1)
            if payload is not None:
                Path(command[command.index("--output")+1]).write_bytes(payload)
            return subprocess.CompletedProcess(command, code, stdout=status)
        return run

    def test_success_credentials_scoped_header_removed_and_not_in_command(self):
        def run(command, **kwargs):
            self.assertNotIn("private-token", str(command))
            header = Path(command[command.index("--header")+1][1:])
            self.assertEqual(header.read_text(), "Authorization: Bearer private-token\n")
            self.assertEqual(header.stat().st_mode & 0o777, 0o600)
            return self.response()(command, **kwargs)
        with mock.patch.object(source.subprocess, "run", side_effect=run):
            archive = source.download_source(SHA, self.root, "private-token")
        self.assertEqual(archive.read_bytes(), b"archive")
        self.assertEqual(list(self.root.iterdir()), [archive])

    def test_http_errors_redirects_and_tls_fail_without_leaking_or_retrying(self):
        for code, status, expected in [(22,b"403 0.1","SOURCE_HTTP_FORBIDDEN"),
                                       (22,b"404 0.1","SOURCE_HTTP_NOT_FOUND"),
                                       (0,b"302 0.1","SOURCE_FETCH_FAILED"),
                                       (60,b"000 0.1","SOURCE_FETCH_FAILED")]:
            with self.subTest(status=status), mock.patch.object(source.subprocess, "run", side_effect=self.response(code,status)) as run:
                with self.assertRaisesRegex(source.SourceError, expected):
                    source.download_source(SHA, self.root, "private-token")
                self.assertEqual(run.call_count, 1)
                self.assertEqual(list(self.root.iterdir()), [])

    def test_interrupted_download_retries_from_zero_once(self):
        calls = [0]
        def run(command, **kwargs):
            calls[0] += 1
            part = Path(command[command.index("--output")+1])
            self.assertFalse(part.exists())
            return self.response(18, b"200 0.1", b"partial")(command, **kwargs)
        with mock.patch.object(source.subprocess, "run", side_effect=run), self.assertRaises(source.SourceError):
            source.download_source(SHA, self.root)
        self.assertEqual(calls[0], 2)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_connection_and_read_timeout_classification(self):
        for connected, expected in [(b"0.000000", "SOURCE_CONNECT_TIMEOUT"), (b"0.100000", "SOURCE_FETCH_TIMEOUT")]:
            with mock.patch.object(source.subprocess, "run", side_effect=self.response(28,b"000 "+connected)) as run:
                with self.assertRaisesRegex(source.SourceError, expected):
                    source.download_source(SHA, self.root)
                self.assertEqual(run.call_count, 2)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_total_timeout_bounds_retries_and_cleans_partial(self):
        with mock.patch.object(source.subprocess, "run", side_effect=subprocess.TimeoutExpired("curl",180)), self.assertRaisesRegex(source.SourceError,"SOURCE_FETCH_TIMEOUT"):
            source.download_source(SHA, self.root, "private-token")
        with mock.patch.object(source.time, "monotonic", side_effect=[0,181]), mock.patch.object(source.subprocess,"run") as run, self.assertRaises(source.SourceError):
            source.download_source(SHA,self.root)
        run.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_size_limit_and_invalid_sha(self):
        with mock.patch.object(source,"MAX_DOWNLOAD",4), mock.patch.object(source.subprocess,"run",side_effect=self.response(payload=b"12345")), self.assertRaisesRegex(source.SourceError,"SOURCE_DOWNLOAD_TOO_LARGE"):
            source.download_source(SHA,self.root)
        for sha in ["main", "A"*40, SHA+";id", SHA+" extra"]:
            with self.assertRaises(source.SourceError): source.download_source(sha,self.root)
        self.assertEqual(list(self.root.iterdir()), [])


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root/"source.tar.gz"
        self.template = self.root/"trusted-Dockerfile"
        self.template.write_bytes(b"FROM node:24-bookworm-slim\n")
        self.patch = mock.patch.object(source,"TRUSTED_DOCKERFILE",self.template)
        self.patch.start(); self.addCleanup(self.patch.stop)

    def make(self, extra=()):
        with tarfile.open(self.archive,"w:gz",format=tarfile.PAX_FORMAT) as tar:
            for name, data, kind in [(PREFIX,b"",tarfile.DIRTYPE),
                                     (PREFIX+"/Dockerfile",self.template.read_bytes(),tarfile.REGTYPE),
                                     (PREFIX+"/package-lock.json",json.dumps({"lockfileVersion":3,"packages":{}}).encode(),tarfile.REGTYPE), *extra]:
                item = tarfile.TarInfo(name); item.type=kind
                item.size=len(data) if kind==tarfile.REGTYPE else 0
                item.linkname="/etc/passwd" if kind in {tarfile.SYMTYPE,tarfile.LNKTYPE} else ""
                tar.addfile(item, io.BytesIO(data) if item.isfile() else None)

    def reject(self):
        with self.assertRaises(source.SourceError): source.checkout(self.archive,SHA,self.root)
        self.assertFalse((self.root/"context").exists())
        self.assertFalse(self.archive.exists())
        self.assertFalse((self.root/"source.tar").exists())

    def test_valid_fixed_prefix_stripped_and_root_only(self):
        self.make([(PREFIX+"/nested/file",b"hello",tarfile.REGTYPE)])
        context=source.checkout(self.archive,SHA,self.root)
        self.assertEqual((context/"nested/file").read_bytes(),b"hello")
        self.assertEqual(context.stat().st_mode & 0o777,0o700)
        self.assertFalse(self.archive.exists())
        self.assertFalse((self.root/"source.tar").exists())

    def test_mock_codeload_download_then_safe_checkout(self):
        self.make(); payload=self.archive.read_bytes(); self.archive.unlink()
        def response(command, **kwargs):
            Path(command[command.index("--output")+1]).write_bytes(payload)
            return subprocess.CompletedProcess(command,0,stdout=b"200 0.100000")
        with mock.patch.object(source.subprocess,"run",side_effect=response):
            archive=source.download_source(SHA,self.root)
        context=source.checkout(archive,SHA,self.root)
        self.assertEqual((context/"Dockerfile").read_bytes(),self.template.read_bytes())

    def test_documented_bootstrap_extractor_uses_same_safe_structure(self):
        import os
        import re
        doc=(ROOT/"docs/SOURCE_DEPLOYMENT.md").read_text()
        blocks=re.findall(r"python3(?: -I)? - <<'PY'\n(.*?)\nPY",doc,re.S)
        for block in blocks: compile(block,"SOURCE_DEPLOYMENT.md","exec")
        block=next(block for block in blocks if "import gzip, os, shutil, tarfile" in block)
        self.make()
        with mock.patch.dict(os.environ,UPGRADE_DIR=str(self.root),REVIEWED_SHA=SHA,
                             EXPECTED_ARCHIVE_SHA256=__import__("hashlib").sha256(self.archive.read_bytes()).hexdigest()):
            exec(compile(block,"bootstrap-extract","exec"), {})
        self.assertTrue((self.root/"context/Dockerfile").exists())

    def test_truncated_or_corrupt_gzip_even_after_tar_end(self):
        for mode in ["truncated", "crc", "trailing"]:
            self.make(); data=self.archive.read_bytes()
            if mode=="truncated": data=data[:-8]
            if mode=="crc": data=data[:-8]+bytes([data[-8]^1])+data[-7:]
            if mode=="trailing": data+=b"not-gzip"
            self.archive.write_bytes(data); self.reject()

    def test_unsafe_paths_links_devices_duplicates_and_prefix(self):
        for name,kind in [("/etc/passwd",tarfile.REGTYPE),(PREFIX+"/../escape",tarfile.REGTYPE),
                           (PREFIX+"/x",tarfile.SYMTYPE),(PREFIX+"/x",tarfile.LNKTYPE),
                           (PREFIX+"/x",tarfile.CHRTYPE),(PREFIX+"/x",tarfile.FIFOTYPE),
                           (PREFIX+"/Dockerfile",tarfile.REGTYPE),("ekiden-database-main/x",tarfile.REGTYPE),
                           (PREFIX+"/x/../../escape",tarfile.REGTYPE),
                           (PREFIX+"/nested/../Dockerfile",tarfile.REGTYPE)]:
            with self.subTest(name=name,kind=kind):
                self.make([(name,b"bad",kind)]);self.reject()
        self.assertFalse((self.root/"escape").exists())

    def test_count_expanded_files_and_raw_tar_limits(self):
        for setting,limit in [("MAX_FILES",2),("MAX_SOURCE",4),("MAX_TAR",100)]:
            self.make()
            with mock.patch.object(source,setting,limit):self.reject()

    def test_dockerfile_and_lockfile_validation_preserved(self):
        self.make();self.template.write_bytes(b"unapproved")
        with self.assertRaisesRegex(source.SourceError,"DOCKERFILE_APPROVAL_REQUIRED"):
            source.checkout(self.archive,SHA,self.root)
        self.assertFalse((self.root/"context").exists())
        self.make()
        # Build a distinct archive with foreign lockfile URLs.
        self.template.write_bytes(b"FROM node:24-bookworm-slim\n")
        with tarfile.open(self.archive,"w:gz") as tar:
            for name,data in [("Dockerfile",self.template.read_bytes()),("package-lock.json",json.dumps({"lockfileVersion":3,"packages":{"bad":{"resolved":"https://evil.test/a","integrity":"x"}}}).encode())]:
                item=tarfile.TarInfo(PREFIX+"/"+name);item.size=len(data);tar.addfile(item,io.BytesIO(data))
        with self.assertRaisesRegex(source.SourceError,"LOCKFILE_SOURCE_INVALID"):
            source.checkout(self.archive,SHA,self.root)
        self.assertFalse((self.root/"context").exists())


if __name__ == "__main__": unittest.main()
