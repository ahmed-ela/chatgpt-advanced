# Firefox feed promotion tooling

The feed tool validates the candidate payload and the publicly hosted XPI before writing any update entry. It compares every parsed manifest field and value, permitting JSON serialization changes such as Mozilla removing a final newline. Every other production file must match the candidate byte for byte. Missing, unexpected, duplicate, or empty signature metadata is rejected. These checks do not themselves verify PKCS7 or COSE cryptography.

## Default: anonymous Mozilla provenance

Use the signed XPI downloaded from Mozilla, its observed official file URL, and the immutable public release asset URL:

```sh
bun run feed:firefox \
  --signed-xpi /absolute/path/to/mozilla-download.xpi \
  --mozilla-download-url https://addons.mozilla.org/firefox/downloads/file/FILE_ID/mozilla-download.xpi \
  --update-link https://github.com/ahmed-ela/threadlane-updates/releases/download/firefox-vVERSION/threadlane-firefox-VERSION.xpi \
  --expected-dir .local/release/firefox/VERSION/extension \
  --out /absolute/path/to/threadlane-updates/firefox/updates.json
```

Replace placeholders with the actual observed values. The project version must match the candidate. The tool independently downloads the Mozilla file and the public release asset and requires both to match the local signed XPI exactly. Authentication failures stop promotion; they never select another provenance mode automatically.

## Explicit alternative: recorded authenticated browser download

Mozilla's self-distributed download may require the publisher's signed-in browser and return 404 anonymously. After downloading through Mozilla's actual browser interface, install **that same XPI normally in Firefox with signature enforcement enabled**. Temporary installation is insufficient. Capture a screenshot or report of the successful normal installation, including the add-on identity/version and how signature enforcement was checked. Preserve the original downloaded filename and record its time, size, and hash.

Only after observing these steps, create a local JSON receipt with this exact schema. Values below are placeholders, not an attestation that an installation happened:

```json
{
  "schemaVersion": 1,
  "kind": "mozilla-browser-native-download",
  "mozillaDownloadUrl": "https://addons.mozilla.org/firefox/downloads/file/FILE_ID/mozilla-download.xpi",
  "download": {
    "basename": "mozilla-download.xpi",
    "completedAt": "YYYY-MM-DDTHH:MM:SSZ",
    "sha256": "SIGNED_XPI_SHA256",
    "size": 12345
  },
  "firefoxVerification": {
    "method": "normal-signed-install",
    "addonId": "threadlane@extensions.invalid",
    "version": "VERSION",
    "xpiSha256": "SIGNED_XPI_SHA256",
    "signaturesRequired": true,
    "completedAt": "YYYY-MM-DDTHH:MM:SSZ",
    "evidencePath": "/absolute/path/to/firefox-install-evidence.png",
    "evidenceSha256": "EVIDENCE_FILE_SHA256"
  }
}
```

Keep receipts and installation evidence locally. They must not contain cookies, credentials, recovery codes, or authenticated query tokens. The receipt records the same official Mozilla URL supplied on the command line. Use UTC ISO timestamps; verification must follow the download. The signed-XPI path must retain the recorded original basename; the public GitHub asset may have a different release filename.

Add `--mozilla-browser-receipt /absolute/path/to/receipt.json` to the default command to explicitly select this mode. It verifies the receipt schema, add-on identity/version, download size/hash/basename, and the existence/hash of nonempty Firefox installation evidence, then still downloads and byte-checks the public GitHub release asset. A missing or mismatched receipt/evidence file fails before feed publication. The existing feed remains unchanged on failure.

**This receipt is trusted local operator evidence.** The tool cannot authenticate the operator's observations, interpret a screenshot, or prove that Firefox verified the signature. Hashes bind the supplied records to particular files; they do not turn a fabricated receipt into proof. Do not create a receipt from filename inspection, mock signatures, a temporary installation, or an unobserved claim. Normal Firefox installation performs the signature verification. The explicit receipt mode avoids extracting browser authentication state or pretending an anonymous Mozilla request succeeded.

Successful CLI output only means a local feed file was written. Publish that file, read back the public feed and asset, and verify a real higher-version update retaining notes and queue state before describing the automatic update path as tested. See [the distribution release gates](BETA_DISTRIBUTION.md#build-and-release-workflow).
