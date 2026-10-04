import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { appDir, buildExtension, firefoxExtensionId, firefoxMinimumVersion, firefoxUpdateUrl } from "../scripts/build-lib";
import { createFirefoxUpdateFeed, emptyFirefoxFeed, validateFirefoxFeed, type FirefoxFeed, type MozillaBrowserReceipt } from "../scripts/firefox-feed";
import { releaseFiles } from "../scripts/package";
import { readProjectVersion } from "../scripts/version";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const mozillaDownloadUrl = "https://addons.mozilla.org/firefox/downloads/file/123456/threadlane.xpi";
const updateLink = "https://github.com/ahmed-ela/threadlane-updates/releases/download/firefox-v0.3.2/threadlane-firefox-0.3.2.xpi";

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "threadlane-feed-test-")); directories.push(path); return path;
}

// Signature bytes here are deliberately mock metadata. The mocked Mozilla
// HTTPS response represents provenance, not cryptographic signature validity.
async function fixture(options: { unsigned?: boolean; alter?: (root: string) => Promise<void> } = {}) {
  const root = await directory(), expectedDirectory = join(root, "expected"), signed = join(root, "signed");
  const version = await readProjectVersion(appDir);
  await buildExtension({ target: "firefox", outdir: expectedDirectory });
  for (const name of await releaseFiles(expectedDirectory)) {
    await mkdir(join(signed, name, ".."), { recursive: true });
    await copyFile(join(expectedDirectory, name), join(signed, name));
  }
  if (!options.unsigned) {
    await mkdir(join(signed, "META-INF"));
    for (const name of ["manifest.mf", "mozilla.sf", "mozilla.rsa"]) await writeFile(join(signed, "META-INF", name), "mock signature metadata");
  }
  await options.alter?.(signed);
  const signedXpi = join(root, "signed.xpi");
  const zipper = Bun.spawn(["zip", "-q", "-X", signedXpi, ...await releaseFiles(signed)], { cwd: signed });
  if (await zipper.exited !== 0) throw new Error("Could not create local XPI fixture");
  const bytes = await readFile(signedXpi);
  const calls: string[] = [];
  const download = async (url: string, settings: RequestInit) => {
    calls.push(url);
    expect(settings.redirect).toBe("manual"); expect(settings.credentials).toBe("omit");
    return new Response(bytes);
  };
  return { root, bytes, calls, options: { signedXpi, expectedDirectory, version, mozillaDownloadUrl, updateLink, download } };
}

// This models an operator receipt and pinned evidence file only. It is not an
// actual browser download, Firefox installation, or cryptographic signature test.
async function browserReceipt(f: Awaited<ReturnType<typeof fixture>>) {
  const evidencePath = join(f.root, "firefox-install-evidence.txt");
  const evidence = "test fixture: an operator's recorded normal signed-install observation";
  await writeFile(evidencePath, evidence);
  const hash = createHash("sha256").update(f.bytes).digest("hex");
  const receipt: MozillaBrowserReceipt = {
    schemaVersion: 1,
    kind: "mozilla-browser-native-download",
    mozillaDownloadUrl,
    download: { basename: basename(f.options.signedXpi), completedAt: "2026-10-04T18:00:00Z", sha256: hash, size: f.bytes.byteLength },
    firefoxVerification: { method: "normal-signed-install", addonId: firefoxExtensionId, version: f.options.version,
      xpiSha256: hash, signaturesRequired: true, completedAt: "2026-10-04T18:05:00.000Z", evidencePath,
      evidenceSha256: createHash("sha256").update(evidence).digest("hex") },
  };
  const path = join(f.root, "browser-receipt.json");
  await writeFile(path, JSON.stringify(receipt));
  return { path, receipt, evidencePath };
}

describe("Firefox signed update feed", () => {
  test("an empty feed never advertises an unsigned build", () => {
    expect(emptyFirefoxFeed()).toEqual({ addons: { [firefoxExtensionId]: { updates: [] } } });
    expect(validateFirefoxFeed(emptyFirefoxFeed()).addons[firefoxExtensionId]!.updates).toHaveLength(0);
  });

  test("requires Mozilla and public asset bytes and pins the exact matching XPI with its compatible Firefox minimum", async () => {
    const f = await fixture();
    const feed = await createFirefoxUpdateFeed(f.options);
    expect(f.calls).toEqual([mozillaDownloadUrl, updateLink]);
    expect(feed).toEqual({ addons: { [firefoxExtensionId]: { updates: [{ version: f.options.version,
      update_link: updateLink, update_hash: `sha256:${createHash("sha256").update(f.bytes).digest("hex")}`,
      applications: { gecko: { strict_min_version: firefoxMinimumVersion } } }] } } });
    expect(await createFirefoxUpdateFeed({ ...f.options, previous: feed })).toEqual(feed);
  });

  test("rejects an unsigned XPI before contacting Mozilla", async () => {
    const f = await fixture({ unsigned: true });
    await expect(createFirefoxUpdateFeed(f.options)).rejects.toThrow("unsigned");
    expect(f.calls).toEqual([]);
  });

  test.each(["final newline", "whitespace and object key order"])("accepts manifest serialization changes: %s", async change => {
    const f = await fixture({ alter: async root => {
      const path = join(root, "manifest.json"), text = await readFile(path, "utf8");
      await writeFile(path, change === "final newline" ? text.trimEnd() :
        JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text)).reverse())));
    } });
    const feed = await createFirefoxUpdateFeed(f.options);
    expect(feed.addons[firefoxExtensionId]!.updates[0]!.update_hash).toBe(`sha256:${createHash("sha256").update(f.bytes).digest("hex")}`);
  });

  test.each(["extra permission", "provider match", "background", "name", "unknown field"])("rejects a semantic manifest change outside identity fields: %s", async change => {
    const f = await fixture({ alter: async root => {
      const path = join(root, "manifest.json"), manifest = JSON.parse(await readFile(path, "utf8"));
      if (change === "extra permission") manifest.permissions = ["tabs"];
      else if (change === "provider match") manifest.content_scripts[0].matches.push("https://example.com/*");
      else if (change === "background") manifest.background.scripts.reverse().push("content.js");
      else if (change === "name") manifest.name = "Other";
      else manifest.unknown_field = true;
      await writeFile(path, JSON.stringify(manifest));
    } });
    await expect(createFirefoxUpdateFeed(f.options)).rejects.toThrow("payload differs");
    expect(f.calls).toEqual([]);
  });

  test("explicit browser receipt validates local evidence and still downloads the public asset exactly", async () => {
    const f = await fixture(), r = await browserReceipt(f);
    const feed = await createFirefoxUpdateFeed({ ...f.options, mozillaBrowserReceipt: r.path });
    expect(f.calls).toEqual([updateLink]);
    expect(feed.addons[firefoxExtensionId]!.updates[0]!.update_hash).toBe(`sha256:${r.receipt.download.sha256}`);
    await expect(createFirefoxUpdateFeed({ ...f.options, mozillaBrowserReceipt: r.path,
      download: async () => new Response("different public asset") })).rejects.toThrow("Public XPI does not match");
  });

  test("a receipt file is never used as an automatic fallback after a failed anonymous download", async () => {
    const f = await fixture(); await browserReceipt(f);
    const calls: string[] = [];
    await expect(createFirefoxUpdateFeed({ ...f.options, download: async url => {
      calls.push(url); return new Response("requires login", { status: 404 });
    } })).rejects.toThrow("HTTP 404");
    expect(calls).toEqual([mozillaDownloadUrl]);
  });

  test.each(["missing receipt", "kind", "extra field", "URL", "URL query", "basename", "size", "hash", "method", "signatures disabled", "add-on ID", "version", "installed XPI", "invalid time", "verification before download", "missing evidence", "empty evidence", "changed evidence", "evidence hash", "relative evidence", "XPI as evidence"])("rejects invalid operator evidence: %s", async change => {
    const f = await fixture(), r = await browserReceipt(f);
    const receipt = r.receipt as any;
    if (change === "kind") receipt.kind = "unverified-local-file";
    else if (change === "extra field") receipt.extra = true;
    else if (change === "URL") receipt.mozillaDownloadUrl = "https://addons.mozilla.org/firefox/downloads/file/999/other.xpi";
    else if (change === "URL query") receipt.mozillaDownloadUrl += "?access_token=secret";
    else if (change === "basename") receipt.download.basename = "other.xpi";
    else if (change === "size") receipt.download.size += 1;
    else if (change === "hash") receipt.download.sha256 = "0".repeat(64);
    else if (change === "method") receipt.firefoxVerification.method = "temporary-install";
    else if (change === "signatures disabled") receipt.firefoxVerification.signaturesRequired = false;
    else if (change === "add-on ID") receipt.firefoxVerification.addonId = "other@example.invalid";
    else if (change === "version") receipt.firefoxVerification.version = "99.0.0";
    else if (change === "installed XPI") receipt.firefoxVerification.xpiSha256 = "0".repeat(64);
    else if (change === "invalid time") receipt.download.completedAt = "2026-02-31T18:00:00Z";
    else if (change === "verification before download") receipt.firefoxVerification.completedAt = "2026-10-04T17:00:00Z";
    else if (change === "missing evidence") await rm(r.evidencePath);
    else if (change === "empty evidence") await writeFile(r.evidencePath, "");
    else if (change === "changed evidence") await writeFile(r.evidencePath, "other evidence");
    else if (change === "evidence hash") receipt.firefoxVerification.evidenceSha256 = "0".repeat(64);
    else if (change === "relative evidence") receipt.firefoxVerification.evidencePath = "evidence.txt";
    else if (change === "XPI as evidence") {
      receipt.firefoxVerification.evidencePath = f.options.signedXpi;
      receipt.firefoxVerification.evidenceSha256 = receipt.download.sha256;
    }
    await writeFile(r.path, JSON.stringify(receipt));
    if (change === "missing receipt") await rm(r.path);
    await expect(createFirefoxUpdateFeed({ ...f.options, mozillaBrowserReceipt: r.path })).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });

  test.each(["identity", "version", "feed", "payload", "extra", "empty signature", "partial COSE"])("rejects changed %s before network provenance", async change => {
    const f = await fixture({ alter: async root => {
      if (["identity", "version", "feed"].includes(change)) {
        const path = join(root, "manifest.json"), manifest = JSON.parse(await readFile(path, "utf8"));
        if (change === "identity") manifest.browser_specific_settings.gecko.id = "other@example.invalid";
        if (change === "version") manifest.version = "99.0.0";
        if (change === "feed") manifest.browser_specific_settings.gecko.update_url = "https://example.com/updates.json";
        await writeFile(path, JSON.stringify(manifest));
      } else if (change === "payload") await writeFile(join(root, "content.js"), "changed");
      else if (change === "extra") await writeFile(join(root, "unexpected.js"), "extra");
      else if (change === "empty signature") await writeFile(join(root, "META-INF/mozilla.rsa"), "");
      else await writeFile(join(root, "META-INF/cose.sig"), "partial");
    } });
    await expect(createFirefoxUpdateFeed(f.options)).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });

  test("signature filenames never substitute for trusted Mozilla byte verification", async () => {
    const f = await fixture();
    await expect(createFirefoxUpdateFeed({ ...f.options, download: async () => new Response("different Mozilla bytes") })).rejects.toThrow("does not match");
    await expect(createFirefoxUpdateFeed({ ...f.options, download: async () => new Response("Sign in", { status: 403 }) })).rejects.toThrow("HTTP 403");
  });

  test("allows Mozilla CDN redirects and refuses third-party redirects without fetching them", async () => {
    const f = await fixture(); let calls = 0;
    const cdn = "https://addons.cdn.mozilla.net/user-media/addons/123456/threadlane.xpi";
    const feed = await createFirefoxUpdateFeed({ ...f.options, download: async url => {
      calls++; return url === mozillaDownloadUrl ? new Response(null, { status: 302, headers: { location: cdn } }) : new Response(f.bytes);
    } });
    expect(calls).toBe(3); expect(feed.addons[firefoxExtensionId]!.updates).toHaveLength(1);
    calls = 0;
    await expect(createFirefoxUpdateFeed({ ...f.options, download: async () => {
      calls++; return new Response(null, { status: 302, headers: { location: "https://evil.example/threadlane.xpi" } });
    } })).rejects.toThrow("other hosts");
    expect(calls).toBe(1);
  });

  test("refuses a missing or mismatched public release asset after Mozilla provenance succeeds", async () => {
    const f = await fixture();
    for (const status of [403, 404, 500]) {
      await expect(createFirefoxUpdateFeed({ ...f.options, download: async url =>
        url === mozillaDownloadUrl ? new Response(f.bytes) : new Response("Unavailable", { status })
      })).rejects.toThrow(`Public XPI is unavailable (HTTP ${status})`);
    }
    await expect(createFirefoxUpdateFeed({ ...f.options, download: async url =>
      new Response(url === mozillaDownloadUrl ? f.bytes : "different hosted asset")
    })).rejects.toThrow("Public XPI does not match");
  });

  test.each(["release-assets.githubusercontent.com", "objects.githubusercontent.com"])("accepts matching signed bytes through GitHub release host %s", async host => {
    const f = await fixture(), calls: string[] = [];
    const asset = `https://${host}/github-production-release-asset/123/456?token=temporary`;
    const feed = await createFirefoxUpdateFeed({ ...f.options, download: async url => {
      calls.push(url);
      return url === updateLink ? new Response(null, { status: 302, headers: { location: asset } }) : new Response(f.bytes);
    } });
    expect(calls).toEqual([mozillaDownloadUrl, updateLink, asset]);
    expect(feed.addons[firefoxExtensionId]!.updates[0]!.update_link).toBe(updateLink);
  });

  test.each(["https://evil.example/a.xpi", "https://release-assets.githubusercontent.com.evil.example/github-production-release-asset/a", "http://release-assets.githubusercontent.com/github-production-release-asset/a", "https://github.com/ahmed-ela/chatgpt-advanced/releases/download/v/a.xpi"])("refuses public asset redirect %s without requesting it", async location => {
    const f = await fixture(), calls: string[] = [];
    await expect(createFirefoxUpdateFeed({ ...f.options, download: async url => {
      calls.push(url);
      return url === mozillaDownloadUrl ? new Response(f.bytes) : new Response(null, { status: 302, headers: { location } });
    } })).rejects.toThrow();
    expect(calls).toEqual([mozillaDownloadUrl, updateLink]);
  });

  test.each(["http://addons.mozilla.org/firefox/downloads/file/123/a.xpi", "https://addons.mozilla.org.evil.test/firefox/downloads/file/123/a.xpi", "https://user:password@addons.mozilla.org/firefox/downloads/file/123/a.xpi", "https://addons.mozilla.org/login"])("refuses untrusted Mozilla URL %s", async url => {
    const f = await fixture();
    await expect(createFirefoxUpdateFeed({ ...f.options, mozillaDownloadUrl: url })).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });

  test.each(["http://github.com/ahmed-ela/threadlane-updates/releases/download/v/a.xpi", "https://github.com/ahmed-ela/chatgpt-advanced/releases/download/v/a.xpi", "https://example.com/a.xpi", "https://github.com/ahmed-ela/threadlane-updates/releases/download/v/a.zip"])("refuses invalid public update link %s", async url => {
    const f = await fixture(); await expect(createFirefoxUpdateFeed({ ...f.options, updateLink: url })).rejects.toThrow(); expect(f.calls).toEqual([]);
  });

  test("refuses rollback, changed existing versions and malformed prior hashes", async () => {
    const f = await fixture(); const feed = await createFirefoxUpdateFeed(f.options);
    const changed = structuredClone(feed); changed.addons[firefoxExtensionId]!.updates[0]!.update_hash = `sha256:${"0".repeat(64)}`;
    await expect(createFirefoxUpdateFeed({ ...f.options, previous: changed })).rejects.toThrow("replace an existing version");
    const newer = structuredClone(feed); newer.addons[firefoxExtensionId]!.updates[0]!.version = "99.0.0";
    await expect(createFirefoxUpdateFeed({ ...f.options, previous: newer })).rejects.toThrow("older version");
    const invalid = structuredClone(feed); invalid.addons[firefoxExtensionId]!.updates[0]!.update_hash = "sha1:bad";
    expect(() => validateFirefoxFeed(invalid)).toThrow("SHA-256");
  });

  test("CLI empty feed works and unsuccessful promotion cannot overwrite it", async () => {
    const f = await fixture({ unsigned: true }), out = join(f.root, "updates.json");
    const cli = async (args: string[]) => {
      const child = Bun.spawn([process.execPath, join(appDir, "scripts/firefox-feed.ts"), ...args], { stdout: "pipe", stderr: "pipe" });
      return { code: await child.exited, output: await new Response(child.stdout).text(), error: await new Response(child.stderr).text() };
    };
    expect((await cli(["--empty", "--out", out])).code).toBe(0);
    const before = await readFile(out, "utf8"); expect(JSON.parse(before)).toEqual(emptyFirefoxFeed());
    const result = await cli(["--signed-xpi", f.options.signedXpi, "--mozilla-download-url", mozillaDownloadUrl,
      "--update-link", updateLink, "--expected-dir", f.options.expectedDirectory, "--out", out]);
    expect(result.code).toBe(1); expect(result.error).toContain("unsigned"); expect(await readFile(out, "utf8")).toBe(before);
    const existing: FirefoxFeed = { addons: { [firefoxExtensionId]: { updates: [{ version: f.options.version, update_link: updateLink,
      update_hash: `sha256:${"0".repeat(64)}`, applications: { gecko: { strict_min_version: firefoxMinimumVersion } } }] } } };
    await writeFile(out, JSON.stringify(existing));
    expect((await cli(["--empty", "--out", out])).code).toBe(1);
    expect(JSON.parse(await readFile(out, "utf8"))).toEqual(existing);
  });

  test("CLI receipt mode leaves the previous feed untouched when local evidence no longer matches", async () => {
    const f = await fixture(), r = await browserReceipt(f), out = join(f.root, "updates.json");
    const before = `${JSON.stringify(emptyFirefoxFeed())}\n`;
    await writeFile(out, before); await writeFile(r.evidencePath, "changed after recording");
    const child = Bun.spawn([process.execPath, join(appDir, "scripts/firefox-feed.ts"),
      "--signed-xpi", f.options.signedXpi, "--mozilla-download-url", mozillaDownloadUrl,
      "--mozilla-browser-receipt", r.path, "--update-link", updateLink,
      "--expected-dir", f.options.expectedDirectory, "--out", out], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("evidence does not match");
    expect(await readFile(out, "utf8")).toBe(before);
  });
});
