import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appDir, buildExtension, distDir, fixtureMatches, iconSizes, providerMatches } from "../scripts/build-lib";
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
  const files = await releaseFiles(directory);
  return Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(join(directory, file))).digest("hex")])));
}

describe("production release packaging", () => {
  test("creates an isolated, licensed, versioned ZIP without development access or changing installed dist", async () => {
    const releaseRoot = await temporaryDirectory();
    const installedBefore = await hashFiles(distDir);
    const result = await packageExtension({ releaseRoot });
    expect(result.version).toBe(await readProjectVersion(appDir));
    expect(result.extensionDir).toBe(join(releaseRoot, result.version, "extension"));
    expect(result.zipPath).toBe(join(releaseRoot, result.version, `threadlane-${result.version}.zip`));
    const manifest = JSON.parse(await readFile(join(result.extensionDir, "manifest.json"), "utf8"));
    expect(manifest.version).toBe(result.version);
    expect(manifest.version_name).toBeUndefined();
    expect(manifest.content_scripts[0].matches).toEqual(providerMatches);
    expect(manifest.permissions).toBeUndefined();
    expect(manifest.host_permissions).toBeUndefined();
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

  test("development output keeps local fixtures and reload hooks while release validation rejects it", async () => {
    const outdir = await temporaryDirectory();
    await buildExtension({ dev: true, outdir, buildId: "release-test-dev", devOrigin: "http://127.0.0.1:19777" });
    const version = await readProjectVersion(appDir);
    const manifest = JSON.parse(await readFile(join(outdir, "manifest.json"), "utf8"));
    expect(manifest.version_name).toBe(`${version} (development)`);
    expect(manifest.content_scripts[0].matches).toEqual([...providerMatches, ...fixtureMatches]);
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1:19777/*"]);
    expect(await readFile(join(outdir, "content.js"), "utf8")).toContain("plannotator:dev-version");
    await expect(validateReleaseExtension(outdir, version)).rejects.toThrow();
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
});
