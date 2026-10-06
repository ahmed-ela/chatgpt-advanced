import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { appDir, browserTarget, buildExtension, chromeBetaDescription, chromeBetaName, firefoxDataPermissions, firefoxExtensionId, firefoxMinimumVersion, firefoxUpdateUrl, iconSizes, parseBuildArguments, providerMatches, type BrowserTarget } from "./build-lib";
import { readProjectVersion } from "./version";

export interface ReleasePackage {
  target: BrowserTarget;
  version: string;
  extensionDir: string;
  zipPath: string;
  sha256: string;
}

export async function releaseFiles(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Release contains a symbolic link: ${path}`);
    if (entry.isDirectory()) files.push(...await releaseFiles(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported release entry: ${path}`);
  }
  return files.sort();
}

export async function validateReleaseExtension(directory: string, version: string, target: BrowserTarget = "chrome"): Promise<string[]> {
  browserTarget(target);
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  if (manifest.version !== version || manifest.version_name !== undefined || manifest.manifest_version !== 3) {
    throw new Error("Release manifest version does not match the project release.");
  }
  if (["host_permissions", "optional_host_permissions", "permissions", "optional_permissions", "externally_connectable", "web_accessible_resources"].some(key => key in manifest)) {
    throw new Error("Release manifest has unexpected permissions or external access.");
  }
  if (manifest.content_scripts?.length !== 1 || JSON.stringify(manifest.content_scripts[0].matches) !== JSON.stringify(providerMatches) ||
      JSON.stringify(manifest.content_scripts[0].js) !== JSON.stringify(["content.js", "queue-ui.js"]) || manifest.options_page !== "privacy.html") {
    throw new Error("Release manifest must target only the three supported HTTPS providers.");
  }
  if (manifest.name !== (target === "chrome-beta" ? chromeBetaName : "Threadlane") ||
      (target === "chrome-beta" && manifest.description !== chromeBetaDescription)) {
    throw new Error("Release manifest has the wrong channel name or beta disclosure.");
  }
  const expectedBackground = target === "firefox"
    ? { scripts: ["queue-worker.js"] }
    : { service_worker: "queue-worker.js", type: "module" };
  if (JSON.stringify(manifest.background) !== JSON.stringify(expectedBackground)) {
    throw new Error(`Release manifest has an invalid ${target} background configuration.`);
  }
  if (target === "firefox") {
    const expectedSettings = { gecko: { id: firefoxExtensionId, strict_min_version: firefoxMinimumVersion, update_url: firefoxUpdateUrl,
      data_collection_permissions: { required: firefoxDataPermissions } } };
    if (JSON.stringify(manifest.browser_specific_settings) !== JSON.stringify(expectedSettings) || manifest.incognito !== "not_allowed") {
      throw new Error("Firefox release requires its stable ID, minimum version, update feed, transmission consent, and private-browsing restriction.");
    }
  } else if (manifest.browser_specific_settings !== undefined) {
    throw new Error("Chrome release must not contain Firefox-specific settings.");
  }
  const expectedFiles = ["manifest.json", "content.js", "queue-ui.js", "queue-worker.js", "privacy.html", "THIRD_PARTY_NOTICES.txt", ...iconSizes.map(size => `assets/icons/${size}.png`)].sort();
  const files = await releaseFiles(directory);
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) throw new Error("Release has missing or unexpected files (source maps and development files are excluded).");
  for (const size of iconSizes) {
    if (manifest.icons?.[String(size)] !== `assets/icons/${size}.png`) throw new Error(`Missing ${size}px extension icon.`);
  }
  for (const file of ["content.js", "queue-ui.js", "queue-worker.js"]) {
    const source = await readFile(join(directory, file), "utf8");
    if (/plannotator:dev-|__plannotator\/(?:version|rebuild)|sourceMappingURL|runtime\.reload\(/.test(source)) {
      throw new Error(`Development hooks remain in release ${file}.`);
    }
  }
  return files;
}

/** Build an immutable local upload candidate without touching the installed dist/. */
export async function packageExtension(options: { target?: BrowserTarget; releaseRoot?: string } = {}): Promise<ReleasePackage> {
  const target = browserTarget(options.target);
  const version = await readProjectVersion(appDir);
  const outputRoot = resolve(options.releaseRoot ?? join(appDir, ".local/release"));
  const releaseRoot = target === "chrome" ? outputRoot : join(outputRoot, target);
  const destination = join(releaseRoot, version);
  try {
    await stat(destination);
    throw new Error(`Release candidate already exists at ${destination}; choose a new output root or remove that candidate explicitly.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(releaseRoot, { recursive: true });
  const staging = await mkdtemp(join(releaseRoot, `.${version}-`));
  try {
    const extensionDir = join(staging, "extension");
    await buildExtension({ target, outdir: extensionDir });
    const files = await validateReleaseExtension(extensionDir, version, target);
    if (await readProjectVersion(appDir) !== version) throw new Error("Project version changed during packaging; retry with consistent metadata.");
    const zipName = `threadlane-${target === "chrome" ? "" : `${target}-`}${version}.zip`;
    const zipPath = join(staging, zipName);
    const zipper = Bun.spawn(["zip", "-q", "-X", zipPath, ...files], { cwd: extensionDir, stdout: "pipe", stderr: "pipe" });
    const [status, stderr] = await Promise.all([zipper.exited, new Response(zipper.stderr).text()]);
    if (status !== 0) throw new Error(`Could not create release ZIP: ${stderr.trim() || `zip exited ${status}`}`);
    const sha256 = createHash("sha256").update(await readFile(zipPath)).digest("hex");
    await writeFile(join(staging, `${zipName}.sha256`), `${sha256}  ${zipName}\n`);
    await rename(staging, destination);
    return { target, version, extensionDir: join(destination, "extension"), zipPath: join(destination, zipName), sha256 };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const args = parseBuildArguments(process.argv.slice(2));
    const result = await packageExtension({ target: args.target, releaseRoot: args.outdir });
    console.log(`${result.target} release ${result.version}: ${result.zipPath}\nSHA-256: ${result.sha256}\nInstalled build directories were not changed. Nothing was uploaded or published.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
