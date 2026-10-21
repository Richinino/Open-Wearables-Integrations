"""Version, verify and publish the Android release using only the Python standard library."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = "sk.zdravie.app"
MAX_APK = 100 * 1024 * 1024


def version(run_number: int, properties: Path = ROOT / "android/version.properties") -> dict:
    values = dict(
        line.strip().split("=", 1) for line in properties.read_text().splitlines() if "=" in line
    )
    match = re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", values["versionName"])
    if not match or run_number < 1:
        raise ValueError("Invalid release version or workflow run number")
    code = int(values["versionCode"]) + run_number - 1
    if not 1 <= code <= 2_100_000_000:
        raise ValueError("Android version code outside supported range")
    major, minor, patch = map(int, match.groups())
    name = f"{major}.{minor}.{patch + run_number - 1}"
    return {"versionCode": code, "versionName": name, "tag": f"android-v{name}"}


def repository(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", value):
        raise ValueError("Expected GitHub owner/repository")
    return value


def package(
    apk: Path, output: Path, repo: str, code: int, name: str, aapt: str, apksigner: str
) -> dict:
    repository(repo)
    if not re.fullmatch(r"\d+\.\d+\.\d+", name) or not 1 <= code <= 2_100_000_000:
        raise ValueError("Invalid APK version")
    if not 0 < apk.stat().st_size <= MAX_APK:
        raise ValueError("APK size outside supported range")
    badging = subprocess.check_output([aapt, "dump", "badging", str(apk)], text=True)
    if "application-debuggable" in badging:
        raise ValueError("Development APKs cannot be published as a release")
    expected = f"package: name='{PACKAGE}' versionCode='{code}' versionName='{name}'"
    if not any(
        line.startswith(expected + " ") or line == expected for line in badging.splitlines()
    ):
        raise ValueError("APK identity differs from requested release")
    signing = subprocess.check_output([apksigner, "verify", "--print-certs", str(apk)], text=True)
    certificates = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})", signing)
    expected_cert = (ROOT / "android/release-certificate.sha256").read_text().strip().lower()
    if len(certificates) != 1 or certificates[0].lower() != expected_cert:
        raise ValueError("APK signing identity differs from the configured release certificate")
    notes = (ROOT / "android/RELEASE_NOTES.md").read_text(encoding="utf-8").strip()
    if len(notes) > 4000:
        raise ValueError("Release notes exceed the mobile limit")
    output.mkdir(parents=True, exist_ok=True)
    filename = f"zdravie-{name}.apk"
    target = output / filename
    shutil.copyfile(apk, target)
    with target.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    manifest = {
        "schemaVersion": 1,
        "packageName": PACKAGE,
        "versionCode": code,
        "versionName": name,
        "apkUrl": f"https://github.com/{repo}/releases/download/android-v{name}/{filename}",
        "sha256": digest,
        "sizeBytes": target.stat().st_size,
        "releaseNotes": notes,
    }
    (output / "android-update.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    (output / "SHA256SUMS.txt").write_text(f"{digest}  {filename}\n", encoding="ascii")
    return manifest


class Github:
    def __init__(self, repo: str, token: str):
        self.repo = repository(repo)
        if not token:
            raise ValueError("GH_TOKEN is required to publish")
        self.token = token

    def request(
        self, method: str, path: str, body=None, *, upload=False, missing=False, content_type=None
    ):
        host = "uploads.github.com" if upload else "api.github.com"
        url = f"https://{host}/repos/{self.repo}/{path}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "Zdravie-release",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            content_type = "application/json"
        if content_type:
            headers["Content-Type"] = content_type
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:

            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, req, fp, code, msg, response_headers, newurl):
                    return None

            with urllib.request.build_opener(NoRedirect).open(request, timeout=120) as response:
                data = response.read()
                return json.loads(data) if data else None
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            raise RuntimeError(f"GitHub release request failed (HTTP {error.code})") from None

    def publish(self, output: Path, commit: str):
        manifest = json.loads((output / "android-update.json").read_text())
        tag = f"android-v{manifest['versionName']}"
        if not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise ValueError("A complete Git commit is required")
        release = self.request("GET", f"releases/tags/{tag}", missing=True)
        if release and not release["draft"]:
            print(f"Already published; immutable release retained: {release['html_url']}")
            return
        # A rerun of an older workflow must never replace a more recent stable release.
        published = self.request("GET", "releases?per_page=100")
        versions = [
            r["tag_name"].removeprefix("android-v")
            for r in published
            if not r["draft"]
            and not r["prerelease"]
            and re.fullmatch(r"android-v\d+\.\d+\.\d+", r["tag_name"])
        ]
        current_version = tuple(map(int, manifest["versionName"].split(".")))
        if any(tuple(map(int, value.split("."))) >= current_version for value in versions):
            print("Newer Android release already published; skipped stale workflow")
            return
        if release and release["target_commitish"] != commit:
            raise ValueError("Existing draft belongs to another commit")
        if not release:
            release = self.request(
                "POST",
                "releases",
                {
                    "tag_name": tag,
                    "target_commitish": commit,
                    "name": f"Zdravie Android {manifest['versionName']}",
                    "body": manifest["releaseNotes"],
                    "draft": True,
                    "prerelease": False,
                },
            )
        release_id = int(release["id"])
        files = [
            output / f"zdravie-{manifest['versionName']}.apk",
            output / "android-update.json",
            output / "SHA256SUMS.txt",
        ]
        for file in files:
            for old in release.get("assets", []):
                if old["name"] == file.name:
                    self.request("DELETE", f"releases/assets/{int(old['id'])}")
            name = urllib.parse.quote(file.name, safe="")
            self.request(
                "POST",
                f"releases/{release_id}/assets?name={name}",
                file.read_bytes(),
                upload=True,
                content_type="application/vnd.android.package-archive"
                if file.suffix == ".apk"
                else "application/octet-stream",
            )
        done = self.request(
            "PATCH", f"releases/{release_id}", {"draft": False, "make_latest": "true"}
        )
        print(f"Published {done['html_url']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    numbers = sub.add_parser("version")
    numbers.add_argument("--run-number", type=int, default=1)
    build = sub.add_parser("package")
    build.add_argument("--apk", type=Path, required=True)
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--repository", required=True)
    build.add_argument("--version-code", type=int, required=True)
    build.add_argument("--version-name", required=True)
    build.add_argument("--aapt", required=True)
    build.add_argument("--apksigner", required=True)
    publish = sub.add_parser("publish")
    publish.add_argument("--output", type=Path, required=True)
    publish.add_argument("--repository", required=True)
    publish.add_argument("--commit", required=True)
    args = parser.parse_args()
    if args.command == "version":
        for key, value in version(args.run_number).items():
            print(f"{key}={value}")
    elif args.command == "package":
        result = package(
            args.apk,
            args.output,
            args.repository,
            args.version_code,
            args.version_name,
            args.aapt,
            args.apksigner,
        )
        print(
            f"Verified package {result['versionName']} code={result['versionCode']} "
            f"sha256={result['sha256']}"
        )
    else:
        Github(args.repository, os.environ.get("GH_TOKEN", "")).publish(args.output, args.commit)


if __name__ == "__main__":
    main()
