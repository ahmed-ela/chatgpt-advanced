import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { appDir, firefoxExtensionId, firefoxMinimumVersion, firefoxUpdateUrl } from "./build-lib";
import { validateReleaseExtension } from "./package";
import { parseVersion, readProjectVersion } from "./version";

const MAX_XPI_BYTES = 16 * 1024 * 1024;
const signatureFiles = ["META-INF/manifest.mf", "META-INF/mozilla.sf", "META-INF/mozilla.rsa"];
const optionalSignatureFiles = ["META-INF/cose.manifest", "META-INF/cose.sig"];
type Download = (url: string, options: RequestInit) => Promise<Response>;
export interface FirefoxUpdate {
  version: string;
  update_link: string;
  update_hash: string;
  applications: { gecko: { strict_min_version: string } };
}
export interface FirefoxFeed { addons: Record<string, { updates: FirefoxUpdate[] }> }

export function emptyFirefoxFeed(): FirefoxFeed {
  return { addons: { [firefoxExtensionId]: { updates: [] } } };
}

function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    throw new Error("Release URLs must be HTTPS without credentials, ports, or fragments.");
  }
  return url;
}

function mozillaUrl(value: string, initial: boolean): URL {
  const url = httpsUrl(value);
  const amoDownload = url.hostname === "addons.mozilla.org" &&
    /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(?:firefox\/downloads\/file|api\/v[45]\/(?:downloads\/)?file)\/\d+\//.test(url.pathname);
  const cdnDownload = !initial && url.hostname === "addons.cdn.mozilla.net" && url.pathname.startsWith("/user-media/addons/");
  if (!amoDownload && !cdnDownload) throw new Error("Use an official Mozilla add-on file download URL; other hosts and redirects are refused.");
  return url;
}

function updateLink(value: string): string {
  const url = httpsUrl(value);
  if (url.hostname !== "github.com" || url.search ||
      !/^\/ahmed-ela\/threadlane-updates\/releases\/download\/[^/]+\/[^/]+\.xpi$/.test(url.pathname)) {
    throw new Error("The update link must point to a signed XPI release asset in ahmed-ela/threadlane-updates.");
  }
  return url.href;
}

function githubAssetUrl(value: string): URL {
  const url = httpsUrl(value);
  if (url.hostname === "github.com") return new URL(updateLink(value));
  if (["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname) &&
      url.pathname.startsWith("/github-production-release-asset/")) return url;
  throw new Error("The public XPI redirected outside GitHub's release asset hosts.");
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left), b = parseVersion(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return 0;
}

export function validateFirefoxFeed(value: unknown): FirefoxFeed {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join() !== "addons") throw new Error("Invalid Firefox update feed.");
  const addons = (value as FirefoxFeed).addons;
  if (!addons || typeof addons !== "object" || Object.keys(addons).join() !== firefoxExtensionId) throw new Error("Unexpected add-on identity in update feed.");
  const entry = addons[firefoxExtensionId];
  if (!entry || Object.keys(entry).join() !== "updates" || !Array.isArray(entry.updates)) throw new Error("Invalid update list.");
  const versions = new Set<string>();
  for (const update of entry.updates) {
    if (!update || typeof update !== "object" || Object.keys(update).sort().join() !== "applications,update_hash,update_link,version") throw new Error("Invalid update entry.");
    parseVersion(update.version);
    if (versions.has(update.version)) throw new Error("Duplicate version in update feed.");
    versions.add(update.version);
    updateLink(update.update_link);
    if (!/^sha256:[0-9a-f]{64}$/.test(update.update_hash) ||
        JSON.stringify(update.applications) !== JSON.stringify({ gecko: { strict_min_version: firefoxMinimumVersion } })) {
      throw new Error("Every update requires a SHA-256 pin and the supported Firefox minimum.");
    }
  }
  return value as FirefoxFeed;
}

async function readBounded(response: Response, source = "Mozilla download"): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_XPI_BYTES) throw new Error(`${source} exceeds the release size limit.`);
  if (!response.body) throw new Error(`${source} returned no XPI content.`);
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_XPI_BYTES) throw new Error(`${source} exceeds the release size limit.`);
      chunks.push(chunk.value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

async function mozillaDownload(url: string, download: Download): Promise<Buffer> {
  let current = mozillaUrl(url, true);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await download(current.href, { redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(30_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Mozilla download redirected without a location.");
      current = mozillaUrl(new URL(location, current).href, false);
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`Mozilla download is unavailable (HTTP ${response.status}). Obtain an accessible signed download; the feed was not changed.`);
    }
    return readBounded(response);
  }
  throw new Error("Mozilla download exceeded the redirect limit.");
}

async function publicAssetDownload(url: string, download: Download): Promise<Buffer> {
  let current = new URL(updateLink(url));
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await download(current.href, { redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(30_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Public XPI download redirected without a location.");
      current = githubAssetUrl(new URL(location, current).href);
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`Public XPI is unavailable (HTTP ${response.status}). Upload the signed release asset before promoting the feed.`);
    }
    return readBounded(response, "Public XPI download");
  }
  throw new Error("Public XPI download exceeded the redirect limit.");
}

async function unzip(path: string, args: string[]): Promise<Buffer> {
  const child = Bun.spawn(["unzip", ...args, path], { stdout: "pipe", stderr: "pipe" });
  try {
    const [code, output, error] = await Promise.all([child.exited, readBounded(new Response(child.stdout), "XPI entry list"), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`Could not inspect XPI archive: ${error.trim() || "unzip failed"}`);
    return output;
  } catch (error) { child.kill(); throw error; }
}

async function xpiFile(path: string, name: string): Promise<Buffer> {
  const child = Bun.spawn(["unzip", "-p", path, name], { stdout: "pipe", stderr: "pipe" });
  try {
    const [code, output] = await Promise.all([child.exited, readBounded(new Response(child.stdout), "XPI entry"), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`Could not inspect XPI entry ${name}.`);
    return output;
  } catch (error) { child.kill(); throw error; }
}

/**
 * This checks Mozilla download provenance and exact bytes, not PKCS7/COSE
 * cryptography. Firefox still performs signature verification at installation.
 * Signature filenames alone are never accepted as provenance.
 */
export async function createFirefoxUpdateFeed(options: {
  signedXpi: string;
  mozillaDownloadUrl: string;
  updateLink: string;
  expectedDirectory: string;
  version: string;
  previous?: unknown;
  download?: Download;
}): Promise<FirefoxFeed> {
  parseVersion(options.version);
  const previous = validateFirefoxFeed(options.previous ?? emptyFirefoxFeed());
  const link = updateLink(options.updateLink);
  mozillaUrl(options.mozillaDownloadUrl, true);
  const path = resolve(options.signedXpi);
  if (!path.endsWith(".xpi") || (await stat(path)).size > MAX_XPI_BYTES) throw new Error("Provide the Mozilla-signed .xpi file, within the release size limit.");
  const bytes = await readFile(path);
  const expectedFiles = await validateReleaseExtension(options.expectedDirectory, options.version, "firefox");
  // Snapshot before invoking unzip to prevent a changed local file from being
  // validated against the hash of different bytes read earlier.
  const scratch = await mkdtemp(join(tmpdir(), "threadlane-signed-xpi-"));
  try {
    const snapshot = join(scratch, "signed.xpi"); await writeFile(snapshot, bytes);
    const allEntries = (await unzip(snapshot, ["-Z1"])).toString("utf8").trim().split("\n");
    if (new Set(allEntries).size !== allEntries.length || allEntries.some(name => !/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith("/") || name.split("/").includes(".."))) throw new Error("XPI contains duplicate or unsafe entries.");
    const files = allEntries.filter(name => !name.endsWith("/"));
    const allowed = new Set([...expectedFiles, ...signatureFiles, ...optionalSignatureFiles]);
    if (files.some(name => !allowed.has(name)) || expectedFiles.some(name => !files.includes(name)) || signatureFiles.some(name => !files.includes(name))) throw new Error("XPI is unsigned or contains unexpected release files.");
    if (optionalSignatureFiles.some(name => files.includes(name)) && !optionalSignatureFiles.every(name => files.includes(name))) throw new Error("Incomplete COSE signature metadata.");
    for (const name of [...signatureFiles, ...optionalSignatureFiles.filter(name => files.includes(name))]) {
      if (!(await xpiFile(snapshot, name)).byteLength) throw new Error("Empty Mozilla signature metadata.");
    }
    const manifest = JSON.parse((await xpiFile(snapshot, "manifest.json")).toString("utf8"));
    if (manifest.version !== options.version || manifest.browser_specific_settings?.gecko?.id !== firefoxExtensionId || manifest.browser_specific_settings?.gecko?.update_url !== firefoxUpdateUrl) throw new Error("Signed XPI identity, version, or update feed does not match this release.");
    for (const name of expectedFiles) {
      if (!(await xpiFile(snapshot, name)).equals(await readFile(join(options.expectedDirectory, name)))) throw new Error(`Signed XPI payload differs from the tested release: ${name}.`);
    }
    const fromMozilla = await mozillaDownload(options.mozillaDownloadUrl, options.download ?? fetch);
    if (!bytes.equals(fromMozilla)) throw new Error("Local XPI does not match the trusted Mozilla download. The feed was not changed.");
    const hostedBytes = await publicAssetDownload(link, options.download ?? fetch);
    if (!bytes.equals(hostedBytes)) throw new Error("Public XPI does not match the verified Mozilla-signed bytes. The feed was not changed.");
    const update: FirefoxUpdate = { version: options.version, update_link: link,
      update_hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      applications: { gecko: { strict_min_version: firefoxMinimumVersion } } };
    const priorUpdates = previous.addons[firefoxExtensionId]!.updates;
    const existing = priorUpdates.find(entry => entry.version === options.version);
    if (existing && JSON.stringify(existing) !== JSON.stringify(update)) throw new Error("Refusing to replace an existing version with different release metadata.");
    if (priorUpdates.some(entry => compareVersions(entry.version, options.version) > 0)) throw new Error("Refusing to roll the update feed back to an older version.");
    return { addons: { [firefoxExtensionId]: { updates: existing ? [...priorUpdates] : [...priorUpdates, update] } } };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

export async function writeFirefoxFeed(path: string, feed: FirefoxFeed): Promise<void> {
  validateFirefoxFeed(feed);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(feed, null, 2)}\n`, { flag: "wx" }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2), flags = new Map<string, string>(); let empty = false;
    for (let index = 0; index < args.length; index++) {
      const flag = args[index]!;
      if (flag === "--empty" && !empty) { empty = true; continue; }
      if (!["--out", "--signed-xpi", "--mozilla-download-url", "--update-link", "--expected-dir"].includes(flag) || flags.has(flag) || !args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error("Use --empty --out <updates.json>, or --signed-xpi <file.xpi> --mozilla-download-url <url> --update-link <url> --out <updates.json> [--expected-dir <candidate/extension>].");
      flags.set(flag, args[++index]!);
    }
    if (!flags.has("--out")) throw new Error("An explicit --out path is required; nothing is uploaded by this script.");
    const output = resolve(flags.get("--out")!);
    let previous: FirefoxFeed | undefined;
    try { previous = validateFirefoxFeed(JSON.parse(await readFile(output, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    let feed: FirefoxFeed;
    if (empty) {
      if (flags.size !== 1 || previous?.addons[firefoxExtensionId]!.updates.length) throw new Error("Empty feed creation cannot replace published releases or accept XPI arguments.");
      feed = emptyFirefoxFeed();
    } else {
      const version = await readProjectVersion(appDir);
      for (const key of ["--signed-xpi", "--mozilla-download-url", "--update-link"]) if (!flags.has(key)) throw new Error(`Missing ${key}; unsigned builds cannot become updates.`);
      feed = await createFirefoxUpdateFeed({ signedXpi: flags.get("--signed-xpi")!, mozillaDownloadUrl: flags.get("--mozilla-download-url")!, updateLink: flags.get("--update-link")!,
        expectedDirectory: resolve(flags.get("--expected-dir") ?? join(appDir, ".local/release/firefox", version, "extension")), version, previous });
    }
    await writeFirefoxFeed(output, feed);
    console.log(`Wrote ${feed.addons[firefoxExtensionId]!.updates.length} Firefox update entries to ${output}. Nothing was uploaded or published.`);
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
