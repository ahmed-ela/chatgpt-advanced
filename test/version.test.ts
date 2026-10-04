import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextVersion, parseVersion, readProjectVersion, updateVersion } from "../scripts/version";

const temporaryRoots: string[] = [];
const releaseNotes = "### Fixed\n\n- Preserve queued messages when switching tabs.\n- Keep **edited drafts** intact until saved.";
const previousRelease = "## [0.1.0] - 2026-10-03\n\n- Initial persistent queue release.\n";

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(options: { version?: unknown; notes?: string; changelog?: string } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "plannotator-version-"));
  temporaryRoots.push(root);
  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify({
      name: "plannotator-version-fixture", version: options.version ?? "0.1.0", private: true,
      scripts: { test: "bun test" },
    }, null, 2) + "\n"),
    writeFile(join(root, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Fixture", permissions: ["storage"] }, null, 2) + "\n"),
    writeFile(join(root, "CHANGELOG.md"), options.changelog ?? `# Changelog\n\n## [Unreleased]\n\n${options.notes ?? releaseNotes}\n\n${previousRelease}`),
  ]);
  return root;
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const names = (await readdir(root)).sort();
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(join(root, name), "utf8")])));
}

describe("extension versions", () => {
  test.each([
    ["0.0.1", [0, 0, 1]],
    ["0.1.0", [0, 1, 0]],
    ["1.0.0", [1, 0, 0]],
    ["65535.65535.65535", [65535, 65535, 65535]],
  ])("accepts three Chrome-compatible integer components: %s", (value, expected) => {
    expect(parseVersion(value)).toEqual(expected);
  });

  test.each([
    undefined, null, 1, {}, "", "0.0.0", "1", "1.2", "1.2.3.4", "01.2.3", "1.02.3", "1.2.03",
    "-1.2.3", "+1.2.3", "1.2.3-beta.1", "1.2.3+build.1", " 1.2.3", "1.2.3\n", "1e1.2.3",
    "65536.0.0", "0.65536.0", "0.0.65536",
  ])("rejects invalid version %#", value => {
    expect(() => parseVersion(value)).toThrow();
  });

  test("increments the selected component and resets lower components", () => {
    expect(nextVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(nextVersion("0.1.9", "minor")).toBe("0.2.0");
    expect(nextVersion("0.9.9", "major")).toBe("1.0.0");
    expect(nextVersion("65535.65535.65534", "patch")).toBe("65535.65535.65535");
    expect(nextVersion("65535.65534.65535", "minor")).toBe("65535.65535.0");
    expect(nextVersion("65534.65535.65535", "major")).toBe("65535.0.0");
  });

  test("rejects component overflow instead of silently rolling it over", () => {
    expect(() => nextVersion("1.2.65535", "patch")).toThrow();
    expect(() => nextVersion("1.65535.0", "minor")).toThrow();
    expect(() => nextVersion("65535.0.0", "major")).toThrow();
    expect(() => nextVersion("01.2.3", "patch")).toThrow();
  });

  test("reads package version against the first dated release and accepts a versionless manifest template", async () => {
    const root = await fixture({ changelog: `# Changelog\n\n## [Unreleased]\n\n${releaseNotes}\n\n${previousRelease}\n## [0.0.9] - 2026-09-01\n\n- Older release.\n` });
    const before = await snapshot(root);
    expect(await readProjectVersion(root)).toBe("0.1.0");
    expect(await snapshot(root)).toEqual(before);
  });

  test("dry-run reports the proposed version without changing any file", async () => {
    const root = await fixture();
    const before = await snapshot(root);
    expect(await updateVersion(root, "minor", { dryRun: true, date: "2026-10-04" })).toEqual({ previous: "0.1.0", version: "0.2.0" });
    expect(await snapshot(root)).toEqual(before);
    expect(await readProjectVersion(root)).toBe("0.1.0");
  });

  test("archives Unreleased notes under the new version and preserves earlier releases and package fields", async () => {
    const root = await fixture();
    const before = await snapshot(root);
    expect(await updateVersion(root, "patch", { date: "2026-10-04" })).toEqual({ previous: "0.1.0", version: "0.1.1" });
    const after = await snapshot(root);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(JSON.parse(after["package.json"]!)).toEqual({ ...JSON.parse(before["package.json"]!), version: "0.1.1" });
    expect(after["manifest.json"]).toBe(before["manifest.json"]!);
    const changelog = after["CHANGELOG.md"]!;
    expect(changelog).toMatch(/^# Changelog\s+## \[Unreleased\]\s+## \[0\.1\.1\] - 2026-10-04\s/);
    expect(changelog).toContain(releaseNotes);
    expect(changelog).toContain(previousRelease);
    expect(changelog.indexOf("## [0.1.1]")).toBeLessThan(changelog.indexOf(releaseNotes));
    expect(changelog.indexOf(releaseNotes)).toBeLessThan(changelog.indexOf("## [0.1.0]"));
    expect(changelog.split(releaseNotes)).toHaveLength(2);
    expect(await readProjectVersion(root)).toBe("0.1.1");
    await expect(updateVersion(root, "patch", { date: "2026-10-04" })).rejects.toThrow();
    expect(await snapshot(root)).toEqual(after);
  });

  test("invalid current version leaves all files unchanged", async () => {
    const root = await fixture({ version: "0.01.0" });
    const before = await snapshot(root);
    await expect(readProjectVersion(root)).rejects.toThrow();
    await expect(updateVersion(root, "patch", { date: "2026-10-04" })).rejects.toThrow();
    expect(await snapshot(root)).toEqual(before);
  });

  test("a package and first-release mismatch cannot bump or change files", async () => {
    const root = await fixture({ version: "0.1.1" });
    const before = await snapshot(root);
    await expect(readProjectVersion(root)).rejects.toThrow();
    await expect(updateVersion(root, "patch", { date: "2026-10-04" })).rejects.toThrow();
    expect(await snapshot(root)).toEqual(before);
  });

  test("missing dated release is rejected even when an Unreleased section exists", async () => {
    const root = await fixture({ changelog: `# Changelog\n\n## [Unreleased]\n\n${releaseNotes}\n` });
    const before = await snapshot(root);
    await expect(readProjectVersion(root)).rejects.toThrow();
    await expect(updateVersion(root, "patch", { date: "2026-10-04" })).rejects.toThrow();
    expect(await snapshot(root)).toEqual(before);
  });

  test("Unreleased below the latest release is rejected before changing files", async () => {
    const root = await fixture({ changelog: `# Changelog\n\n${previousRelease}\n## [Unreleased]\n\n${releaseNotes}\n\n## [0.0.9] - 2026-09-01\n\n- Older release.\n` });
    const before = await snapshot(root);
    await expect(readProjectVersion(root)).rejects.toThrow();
    await expect(updateVersion(root, "patch", { date: "2026-10-04" })).rejects.toThrow();
    expect(await snapshot(root)).toEqual(before);
  });

  test("duplicate Unreleased headings are rejected without changing files", async () => {
    const root = await fixture({ changelog: `# Changelog\n\n## [Unreleased]\n\n${releaseNotes}\n\n## [Unreleased]\n\n- More pending notes.\n\n${previousRelease}` });
    const before = await snapshot(root);
    await expect(readProjectVersion(root)).rejects.toThrow();
    await expect(updateVersion(root, "patch", { date: "2026-10-04" })).rejects.toThrow();
    expect(await snapshot(root)).toEqual(before);
  });

  test.each(["", " \n\t\n"])("empty Unreleased notes prevent real and dry-run bumps without changes (%#)", async notes => {
    const root = await fixture({ notes });
    const before = await snapshot(root);
    expect(await readProjectVersion(root)).toBe("0.1.0");
    await expect(updateVersion(root, "patch", { date: "2026-10-04" })).rejects.toThrow();
    await expect(updateVersion(root, "patch", { dryRun: true, date: "2026-10-04" })).rejects.toThrow();
    expect(await snapshot(root)).toEqual(before);
  });

  test("overflow during a bump leaves package, changelog, and template unchanged", async () => {
    const root = await fixture({ version: "0.1.65535", changelog: `# Changelog\n\n## [Unreleased]\n\n${releaseNotes}\n\n## [0.1.65535] - 2026-10-03\n\n- Previous release.\n` });
    const before = await snapshot(root);
    await expect(updateVersion(root, "patch", { date: "2026-10-04" })).rejects.toThrow();
    expect(await snapshot(root)).toEqual(before);
  });
});
