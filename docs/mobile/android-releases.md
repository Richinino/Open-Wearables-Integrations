# Android releases and updates

[English README](../../README.md) · [Slovenský README](../../README.sk.md)

Zdravie is distributed through public GitHub Releases. Google Play is not required. Health-data calculations run on the processing server; this update mechanism replaces the native Android application when its own code or resources change.

## For users

1. Install the APK attached to the [latest release](https://github.com/Richinino/Open-Wearables-Integrations/releases/latest).
2. Starting with the updater-enabled version, opening Zdravie checks for a newer version in the background. Automatic checks are limited to once every six hours.
3. Choose **Stiahnuť** to download or **Odložiť** to postpone that version for 24 hours. A newer version can still be offered. **Účet → Skontrolovať aktualizácie** checks immediately and bypasses postponement.
4. Download progress is shown and can be cancelled. After verification, choose **Inštalovať**. If Android asks to allow updates from Zdravie, enable that permission and return to the app.
5. Confirm Android's installation dialog. The APK updates the existing application; it does not uninstall it or clear its account session/settings. Android may close the application while replacing it; reopen it afterwards.

The original v0.1.0 APK has no updater. Install an updater-enabled APK over it **once**, without uninstalling. The official release preserves its existing package ID and signing certificate. Subsequent updates are offered inside the app.

Unavailable GitHub/network access never blocks sign-in or health-data loading. Updates are optional. If the process is killed during download or installation, check again after reopening; incomplete downloads are not offered for installation. Only public update preferences are persisted by the updater; it never reads account passwords, cookies or health data.

## Maintainer workflow

The repository has a separate [Android release workflow](../../.github/workflows/android-release.yml). A push changing Android application sources/build configuration on the configured production branch starts it. Documentation-only changes do not create an APK. `workflow_dispatch` can also start a release from that branch.

The workflow:

1. Calculates a version from [version.properties](../../android/version.properties) and the release workflow's `GITHUB_RUN_NUMBER`.
2. Runs release-tool regressions, Android unit tests and Android lint, and builds a signed **release** APK.
3. Checks its actual package/version with `aapt`, verifies its signature with `apksigner`, and compares the signer with [the configured certificate](../../android/release-certificate.sha256).
4. Creates a **draft** release, uploads all three assets, then publishes it as the latest stable release. An upload failure leaves a draft, so phones cannot discover a partially uploaded release.

The initial base is version code `2`, version name `0.1.1`. Run 1 produces `0.1.1` / code 2; run 2 produces `0.1.2` / code 3. Failed runs can leave gaps. A retry of the same run uses the same version. Published versions are never overwritten, and a stale workflow cannot replace a newer Android release. Normal app updates require no manual version edit. When planning a new minor/major series, keep both the version name and version code increasing; do not reset the workflow's numbering or lower the base code.

Stable Android tags are `android-v<version>`. Non-Android releases in this repository should not be marked latest: the updater's latest-release URL expects the Android assets. Release notes come from [RELEASE_NOTES.md](../../android/RELEASE_NOTES.md); keep them relevant to the next release.

This does **not** deploy the Python processing server. Formula changes require that service to be deployed and the relevant results recomputed. The Vercel web deployment is also separate.

## Release assets and trust checks

Each release includes:

| Asset | Purpose |
|---|---|
| `zdravie-<version>.apk` | Signed Android application |
| `android-update.json` | Version code/name, package ID, exact download URL, size, SHA-256 and release notes |
| `SHA256SUMS.txt` | APK checksum for manual verification |

The app reads `https://github.com/Richinino/Open-Wearables-Integrations/releases/latest/download/android-update.json` without a GitHub token. The repository and assets must be public. No account/session credentials are sent to GitHub.

Metadata is limited to 32 KiB and APKs to 100 MiB. The client accepts only HTTPS, the configured GitHub repository's canonical release paths, and GitHub's release-asset host for bounded redirects. It verifies the complete download's size/SHA-256, then reads the APK's actual package ID, increasing version and signing certificates. These must match the installed app and release metadata. Android independently checks the installation. Files are shared with the system installer through a private, narrowly scoped FileProvider; external storage access is unnecessary.

Keep the version-1 update manifest compatible with already installed clients. Changes to the app/API do not require a new update-manifest schema; older clients still need to discover and download their replacement.

## Signing and forks

Four **repository Actions secrets** configure signing:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded private PKCS12/JKS keystore.
- `ANDROID_KEYSTORE_PASSWORD`: its password.
- `ANDROID_KEY_ALIAS`: the signing alias.
- `ANDROID_KEY_PASSWORD`: the alias password.

The official signing identity is retained from the original installation so existing users can update in place. Its dedicated keystore is encrypted outside the repository, its local password is protected using Windows DPAPI, and CI receives secrets through GitHub Actions. No private key/password is part of Git, the APK, or the update metadata. Preserve the signing key when moving the maintainer machine; a replacement key cannot update installations signed by the old one.

Forks should use their own signing identity and release repository. Set their certificate digest in `android/release-certificate.sha256`, configure the four secrets, and adjust the workflow's production-branch filters if necessary. The workflow passes its own `GITHUB_REPOSITORY` to the Android build. A self-hosted fork must also set its own HTTPS web/API origin in the build and release workflow; the default is the maintainer's Zdravie instance.

For a local signed build, set the four Gradle signing environment variables (`ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), then run:

```bash
bash android/gradlew -p android :app:assembleRelease \
  -PapiBaseUrl=https://your-zdravie.example \
  -PupdateRepository=your-owner/your-repository
```

The initial local version uses `version.properties`; explicit `-PandroidVersionCode` and `-PandroidVersionName` overrides reproduce a CI version. The official package ID is `sk.zdravie.app`. A fork signed with a different key cannot replace the official installed application.

Primary references: [Android app signing](https://developer.android.com/studio/publish/app-signing), [PackageInstaller](https://developer.android.com/reference/android/content/pm/PackageInstaller), [GitHub Releases API](https://docs.github.com/en/rest/releases/releases).
