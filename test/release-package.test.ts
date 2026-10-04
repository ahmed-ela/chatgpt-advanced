import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appDir, buildExtension, chromeBetaDescription, chromeBetaDistDir, chromeBetaName, defaultOutputDirectory, distDir, firefoxDataPermissions, firefoxDistDir, firefoxExtensionId, firefoxMinimumVersion, firefoxUpdateUrl, fixtureMatches, iconSizes, parseBuildArguments, providerMatches } from "../scripts/build-lib";
import { packageExtension, releaseFiles, validateReleaseExtension } from "../scripts/package";
import { readProjectVersion } from "../scripts/version";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "plannotator-release-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function hashFiles(directory: string): Promise<Record<string, string>> {
  const files = await releaseFiles(directory).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  return Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(join(directory, file))).digest("hex")])));
}

describe("production release packaging", () => {
  test("Chrome beta has a separate identity label, disclosure and output without changing public artifacts", async () => {
    const releaseRoot = await temporaryDirectory();
    const publicBefore = await hashFiles(distDir);
    const release = await packageExtension({ target: "chrome-beta", releaseRoot });
    const manifest = JSON.parse(await readFile(join(release.extensionDir, "manifest.json"), "utf8"));
    expect(release.extensionDir).toBe(join(releaseRoot, "chrome-beta", release.version, "extension"));
    expect(release.zipPath).toBe(join(releaseRoot, "chrome-beta", release.version, `threadlane-chrome-beta-${release.version}.zip`));
    expect(manifest.name).toBe(chromeBetaName);
    expect(manifest.description).toBe(chromeBetaDescription);
    expect(manifest.description).toContain("THIS EXTENSION IS FOR BETA TESTING");
    expect(manifest.description.length).toBeLessThanOrEqual(132);
    expect(manifest.background).toEqual({ service_worker: "queue-worker.js", type: "module" });
    expect(manifest.key).toBeUndefined();
    expect(manifest.update_url).toBeUndefined();
    expect(manifest.browser_specific_settings).toBeUndefined();
    expect((await validateReleaseExtension(release.extensionDir, release.version, "chrome-beta")).length).toBe(10);
    await expect(validateReleaseExtension(release.extensionDir, release.version, "chrome")).rejects.toThrow("channel name");
    manifest.name = "Threadlane";
    await writeFile(join(release.extensionDir, "manifest.json"), JSON.stringify(manifest));
    await expect(validateReleaseExtension(release.extensionDir, release.version, "chrome-beta")).rejects.toThrow("channel name");
    expect(await hashFiles(distDir)).toEqual(publicBefore);
  });

  test("creates an isolated, licensed, versioned ZIP without development access or changing installed dist", async () => {
    const releaseRoot = await temporaryDirectory();
    const installedBefore = await hashFiles(distDir);
    const result = await packageExtension({ releaseRoot });
    expect(result.target).toBe("chrome");
    expect(result.version).toBe(await readProjectVersion(appDir));
    expect(result.extensionDir).toBe(join(releaseRoot, result.version, "extension"));
    expect(result.zipPath).toBe(join(releaseRoot, result.version, `threadlane-${result.version}.zip`));
    const manifest = JSON.parse(await readFile(join(result.extensionDir, "manifest.json"), "utf8"));
    expect(manifest.version).toBe(result.version);
    expect(manifest.version_name).toBeUndefined();
    expect(manifest.content_scripts[0].matches).toEqual(providerMatches);
    expect(manifest.permissions).toBeUndefined();
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.background).toEqual({ service_worker: "queue-worker.js", type: "module" });
    expect(manifest.browser_specific_settings).toBeUndefined();
    expect(manifest.options_page).toBe("privacy.html");
    const files = await validateReleaseExtension(result.extensionDir, result.version);
    expect(files).toEqual([
      "THIRD_PARTY_NOTICES.txt", "assets/icons/128.png", "assets/icons/16.png", "assets/icons/32.png", "assets/icons/48.png",
      "content.js", "manifest.json", "privacy.html", "queue-ui.js", "queue-worker.js",
    ]);
    const unzip = Bun.spawn(["unzip", "-Z1", result.zipPath], { stdout: "pipe", stderr: "pipe" });
    const zipEntries = (await new Response(unzip.stdout).text()).trim().split("\n").sort();
    expect(await unzip.exited).toBe(0);
    expect(zipEntries).toEqual(files);
    expect(await readFile(join(result.extensionDir, "THIRD_PARTY_NOTICES.txt"), "utf8")).toBe(await readFile(join(appDir, "node_modules/lucide/LICENSE"), "utf8"));
    expect(await readFile(join(result.extensionDir, "privacy.html"), "utf8")).toBe(await readFile(join(appDir, "store/privacy.html"), "utf8"));
    for (const size of iconSizes) {
      const png = await readFile(join(result.extensionDir, `assets/icons/${size}.png`));
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
    const checksum = createHash("sha256").update(await readFile(result.zipPath)).digest("hex");
    expect(result.sha256).toBe(checksum);
    expect(await readFile(`${result.zipPath}.sha256`, "utf8")).toBe(`${checksum}  threadlane-${result.version}.zip\n`);
    expect(await hashFiles(distDir)).toEqual(installedBefore);
    const packageBefore = await hashFiles(join(releaseRoot, result.version));
    await expect(packageExtension({ releaseRoot })).rejects.toThrow("already exists");
    expect(await hashFiles(join(releaseRoot, result.version))).toEqual(packageBefore);
  });

  test("Firefox packages coexist with immutable Chrome candidates and leave both installed build directories intact", async () => {
    const releaseRoot = await temporaryDirectory();
    const installedBefore = await Promise.all([hashFiles(distDir), hashFiles(firefoxDistDir)]);
    const chrome = await packageExtension({ releaseRoot });
    const chromeBefore = await hashFiles(join(releaseRoot, chrome.version));
    const result = await packageExtension({ target: "firefox", releaseRoot });
    expect(result.target).toBe("firefox");
    expect(result.extensionDir).toBe(join(releaseRoot, "firefox", result.version, "extension"));
    expect(result.zipPath).toBe(join(releaseRoot, "firefox", result.version, `threadlane-firefox-${result.version}.zip`));
    const manifest = JSON.parse(await readFile(join(result.extensionDir, "manifest.json"), "utf8"));
    expect(manifest.version).toBe(await readProjectVersion(appDir));
    expect(manifest.background).toEqual({ scripts: ["queue-worker.js"] });
    expect(manifest.browser_specific_settings).toEqual({ gecko: {
      id: firefoxExtensionId, strict_min_version: firefoxMinimumVersion, update_url: firefoxUpdateUrl,
      data_collection_permissions: { required: ["personalCommunications", "websiteContent"] },
    } });
    expect(manifest.incognito).toBe("not_allowed");
    expect(manifest.browser_specific_settings.gecko_android).toBeUndefined();
    expect(manifest.content_scripts[0].matches).toEqual(providerMatches);
    expect(manifest.permissions).toBeUndefined();
    expect(manifest.host_permissions).toBeUndefined();
    const files = await validateReleaseExtension(result.extensionDir, result.version, "firefox");
    const unzip = Bun.spawn(["unzip", "-Z1", result.zipPath], { stdout: "pipe", stderr: "pipe" });
    expect((await new Response(unzip.stdout).text()).trim().split("\n").sort()).toEqual(files);
    expect(await unzip.exited).toBe(0);
    const checksum = createHash("sha256").update(await readFile(result.zipPath)).digest("hex");
    expect(result.sha256).toBe(checksum);
    expect(await readFile(`${result.zipPath}.sha256`, "utf8")).toBe(`${checksum}  threadlane-firefox-${result.version}.zip\n`);
    expect(await readFile(join(result.extensionDir, "THIRD_PARTY_NOTICES.txt"), "utf8")).toBe(await readFile(join(appDir, "node_modules/lucide/LICENSE"), "utf8"));
    expect(await hashFiles(join(releaseRoot, chrome.version))).toEqual(chromeBefore);
    expect(await Promise.all([hashFiles(distDir), hashFiles(firefoxDistDir)])).toEqual(installedBefore);
    const packageBefore = await hashFiles(join(releaseRoot, "firefox", result.version));
    await expect(packageExtension({ target: "firefox", releaseRoot })).rejects.toThrow("already exists");
    expect(await hashFiles(join(releaseRoot, "firefox", result.version))).toEqual(packageBefore);
    await expect(validateReleaseExtension(result.extensionDir, result.version)).rejects.toThrow("chrome background");
    await expect(validateReleaseExtension(chrome.extensionDir, chrome.version, "firefox")).rejects.toThrow("firefox background");
  });

  test("Firefox release validation rejects changed identity, missing consent, unsupported background, and private storage access", async () => {
    const outdir = await temporaryDirectory();
    await buildExtension({ target: "firefox", outdir });
    const version = await readProjectVersion(appDir);
    const path = join(outdir, "manifest.json");
    const original = await readFile(path, "utf8");
    const mutations = [
      (manifest: any) => { manifest.background.service_worker = "queue-worker.js"; },
      (manifest: any) => { manifest.background.persistent = true; },
      (manifest: any) => { manifest.background.persistent = false; },
      (manifest: any) => { manifest.browser_specific_settings.gecko.id = "other@extensions.invalid"; },
      (manifest: any) => { manifest.browser_specific_settings.gecko.strict_min_version = "139.0"; },
      (manifest: any) => { delete manifest.browser_specific_settings.gecko.update_url; },
      (manifest: any) => { manifest.browser_specific_settings.gecko.update_url = "https://example.com/other.json"; },
      (manifest: any) => { manifest.browser_specific_settings.gecko.data_collection_permissions.required = ["none"]; },
      (manifest: any) => { manifest.browser_specific_settings.gecko_android = { strict_min_version: "142.0" }; },
      (manifest: any) => { delete manifest.browser_specific_settings.gecko.data_collection_permissions; },
      (manifest: any) => { manifest.incognito = "spanning"; },
    ];
    for (const mutate of mutations) {
      const manifest = JSON.parse(original);
      mutate(manifest);
      await writeFile(path, JSON.stringify(manifest));
      await expect(validateReleaseExtension(outdir, version, "firefox")).rejects.toThrow();
    }
    await writeFile(path, original);
    expect((await validateReleaseExtension(outdir, version, "firefox")).length).toBe(10);
  });

  test.each(["chrome", "chrome-beta", "firefox"] as const)("%s development output keeps local fixtures and reload hooks while release validation rejects it", async target => {
    const outdir = await temporaryDirectory();
    await buildExtension({ target, dev: true, outdir, buildId: "release-test-dev", devOrigin: "http://127.0.0.1:19777" });
    const version = await readProjectVersion(appDir);
    const manifest = JSON.parse(await readFile(join(outdir, "manifest.json"), "utf8"));
    expect(manifest.version_name).toBe(`${version} (development)`);
    expect(manifest.content_scripts[0].matches).toEqual([...providerMatches, ...fixtureMatches]);
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1:19777/*"]);
    expect(await readFile(join(outdir, "content.js"), "utf8")).toContain("plannotator:dev-version");
    await expect(validateReleaseExtension(outdir, version, target)).rejects.toThrow();
  });

  test("release validation rejects accidental extra source files and added site access", async () => {
    const outdir = await temporaryDirectory();
    await buildExtension({ outdir });
    const version = await readProjectVersion(appDir);
    const manifestPath = join(outdir, "manifest.json");
    const manifestText = await readFile(manifestPath, "utf8");
    await writeFile(join(outdir, "private-fixture.html"), "fixture should never be shipped");
    await expect(validateReleaseExtension(outdir, version)).rejects.toThrow("unexpected files");
    await rm(join(outdir, "private-fixture.html"));
    const manifest = JSON.parse(manifestText);
    manifest.content_scripts[0].matches.push("http://localhost/*");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(validateReleaseExtension(outdir, version)).rejects.toThrow("three supported HTTPS");
  });

  test("build CLI preserves Chrome defaults and accepts an explicit Firefox target with an isolated directory", async () => {
    expect(parseBuildArguments([])).toEqual({ target: "chrome" });
    expect(defaultOutputDirectory()).toBe(distDir);
    expect(defaultOutputDirectory("firefox")).toBe(firefoxDistDir);
    expect(defaultOutputDirectory("chrome-beta")).toBe(chromeBetaDistDir);
    expect(parseBuildArguments(["--target", "chrome-beta"])).toEqual({ target: "chrome-beta" });
    expect(firefoxDataPermissions).not.toContain("none");
    const outdir = await temporaryDirectory();
    const child = Bun.spawn([process.execPath, join(appDir, "scripts/build.ts"), "--outdir", outdir, "--target", "firefox"], { stdout: "pipe", stderr: "pipe" });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(await readFile(join(outdir, "manifest.json"), "utf8")).background).toEqual({ scripts: ["queue-worker.js"] });
    for (const args of [["--target"], ["--target", "safari"], ["--target", "firefox", "--target", "chrome"], ["--outdir", "--target", "firefox"], ["--unknown", "x"]]) {
      expect(() => parseBuildArguments(args)).toThrow();
    }
  });
});
