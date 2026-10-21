"""Regressions for immutable releases, staged uploads, identity and increasing CI versions."""

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/android-release.py"
spec = importlib.util.spec_from_file_location("android_release", SCRIPT)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class AndroidReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_versions_increase_without_editing_source_and_retries_are_stable(self):
        props = self.root / "version.properties"
        props.write_text("versionCode=2\nversionName=0.1.1\n")
        self.assertEqual(
            release.version(1, props),
            {"versionCode": 2, "versionName": "0.1.1", "tag": "android-v0.1.1"},
        )
        self.assertEqual(release.version(12, props)["versionCode"], 13)
        self.assertEqual(release.version(12, props)["versionName"], "0.1.12")
        self.assertEqual(release.version(12, props), release.version(12, props))
        for invalid in (0, -1, 2_100_000_000):
            with self.assertRaises(ValueError):
                release.version(invalid, props)

    def test_version_and_repository_cannot_inject_release_paths(self):
        props = self.root / "version.properties"
        props.write_text("versionCode=2\nversionName=../../anything\n")
        with self.assertRaises(ValueError):
            release.version(1, props)
        for repo in (
            "https://github.com/owner/repo",
            "owner/repo/extra",
            "owner/repo?query",
            "owner repo/x",
        ):
            with self.assertRaises(ValueError):
                release.repository(repo)

    def test_package_binds_actual_apk_identity_certificate_bytes_and_download_url(self):
        apk = self.root / "input.apk"
        apk.write_bytes(b"synthetic-apk-bytes")
        certificate = (release.ROOT / "android/release-certificate.sha256").read_text().strip()
        badging = (
            "package: name='sk.zdravie.app' versionCode='2' versionName='0.1.1' "
            "platformBuildVersionCode='37'\n"
        )
        signing = f"Signer #1 certificate SHA-256 digest: {certificate}\n"
        output = self.root / "dist"
        with patch.object(release.subprocess, "check_output", side_effect=[badging, signing]):
            metadata = release.package(apk, output, "owner/repo", 2, "0.1.1", "aapt", "apksigner")
        self.assertEqual(metadata["sha256"], hashlib.sha256(apk.read_bytes()).hexdigest())
        self.assertEqual(metadata["sizeBytes"], apk.stat().st_size)
        self.assertEqual(
            metadata["apkUrl"],
            "https://github.com/owner/repo/releases/download/android-v0.1.1/zdravie-0.1.1.apk",
        )
        self.assertEqual(json.loads((output / "android-update.json").read_text()), metadata)
        for wrong in (
            badging.replace("versionCode='2'", "versionCode='1'"),
            badging + "application-debuggable\n",
        ):
            with patch.object(release.subprocess, "check_output", return_value=wrong):
                with self.assertRaises(ValueError):
                    release.package(apk, output, "owner/repo", 2, "0.1.1", "aapt", "apksigner")
        with patch.object(
            release.subprocess,
            "check_output",
            side_effect=[badging, signing.replace(certificate, "0" * 64)],
        ):
            with self.assertRaises(ValueError):
                release.package(apk, output, "owner/repo", 2, "0.1.1", "aapt", "apksigner")

    def fixture(self, name="0.1.1"):
        (self.root / "android-update.json").write_text(
            json.dumps({"versionName": name, "versionCode": 2, "releaseNotes": "Test"})
        )
        (self.root / f"zdravie-{name}.apk").write_bytes(b"synthetic")
        (self.root / "SHA256SUMS.txt").write_text("test")
        return "a" * 40

    def test_published_release_is_never_overwritten(self):
        commit = self.fixture()
        github = release.Github("owner/repo", "synthetic")
        with patch.object(
            github,
            "request",
            return_value={
                "draft": False,
                "html_url": "https://github.com/owner/repo/releases/tag/android-v0.1.1",
            },
        ) as request:
            github.publish(self.root, commit)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0], "GET")

    def test_stale_workflow_cannot_become_latest(self):
        commit = self.fixture()
        github = release.Github("owner/repo", "synthetic")
        with patch.object(
            github,
            "request",
            side_effect=[
                None,
                [{"draft": False, "prerelease": False, "tag_name": "android-v0.1.2"}],
            ],
        ) as request:
            github.publish(self.root, commit)
        self.assertTrue(all(call.args[0] == "GET" for call in request.call_args_list))

    def test_failed_asset_upload_leaves_release_draft(self):
        commit = self.fixture()
        github = release.Github("owner/repo", "synthetic")
        responses = [None, [], {"id": 42, "assets": []}, {}, RuntimeError("upload failed")]
        with patch.object(github, "request", side_effect=responses) as request:
            with self.assertRaises(RuntimeError):
                github.publish(self.root, commit)
        self.assertNotIn("PATCH", [call.args[0] for call in request.call_args_list])
        self.assertTrue(request.call_args_list[2].args[2]["draft"])

    def test_all_assets_exist_before_publishing(self):
        commit = self.fixture()
        github = release.Github("owner/repo", "synthetic")
        with patch.object(
            github,
            "request",
            side_effect=[
                None,
                [],
                {"id": 42, "assets": []},
                {},
                {},
                {},
                {"html_url": "https://github.com/owner/repo/releases/tag/android-v0.1.1"},
            ],
        ) as request:
            github.publish(self.root, commit)
        methods = [call.args[0] for call in request.call_args_list]
        self.assertEqual(methods, ["GET", "GET", "POST", "POST", "POST", "POST", "PATCH"])
        self.assertEqual(request.call_args.args[2], {"draft": False, "make_latest": "true"})


if __name__ == "__main__":
    unittest.main()
