import { describe, expect, test } from "bun:test";
import { devIdentity, parseDevVersion } from "../scripts/dev-identity";

describe("development watcher identity", () => {
  const expected = devIdentity("/workspace/qualified", "/installed/threadlane/dist");
  const response = { buildId: "new-build_1", ...expected };

  test("defaults to this checkout's dist and resolves configured paths from the source root", () => {
    expect(devIdentity("/workspace/qualified/../qualified")).toEqual({
      sourceRoot: "/workspace/qualified", outputDir: "/workspace/qualified/dist",
    });
    expect(devIdentity("/workspace/qualified", "../installed/dist").outputDir).toBe("/workspace/installed/dist");
    expect(devIdentity("/workspace/qualified", "/installed/threadlane/dist")).toEqual(expected);
    expect(() => devIdentity("/workspace/qualified", "")).toThrow("must name an output directory");
  });

  test("accepts only a watcher for the selected source and installed output", () => {
    expect(parseDevVersion(response, expected)).toEqual(response);
    expect(parseDevVersion({ ...response, sourceRoot: "/workspace/qualified/.", outputDir: "/installed/threadlane/./dist" }, expected)).toEqual(response);
    expect(parseDevVersion({ ...response, buildId: "booting" }, expected).buildId).toBe("booting");
  });

  test("rejects an old checkout even when it writes to the correct installation", () => {
    expect(() => parseDevVersion({ ...response, sourceRoot: "/workspace/old" }, expected)).toThrow("refusing to rebuild another checkout");
  });

  test("rejects this checkout's watcher when it writes to a different installation", () => {
    expect(() => parseDevVersion({ ...response, outputDir: "/workspace/qualified/dist" }, expected)).toThrow("refusing to rebuild another installation");
  });

  test("rejects legacy watchers and missing or relative path identity", () => {
    for (const value of [
      { buildId: "legacy" },
      { buildId: "legacy", sourceRoot: expected.sourceRoot },
      { buildId: "legacy", outputDir: expected.outputDir },
      { ...response, sourceRoot: "qualified" },
      { ...response, outputDir: "dist" },
    ]) {
      expect(() => parseDevVersion(value, expected)).toThrow("refusing to rebuild an unverified watcher");
    }
  });

  test("rejects malformed responses instead of treating them as an absent watcher", () => {
    for (const value of [null, "new-build", {}, { ...response, buildId: "" }, { ...response, buildId: "unexpected value" }]) {
      expect(() => parseDevVersion(value, expected)).toThrow();
    }
  });
});
