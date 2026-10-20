import { describe, expect, it } from "vitest";
import { buildsDiffer, parseBuildIdentity, toolbarStatus, type BuildIdentity } from "./version";

const release: BuildIdentity = { version: "1.4.0", revision: "a".repeat(40), dev: false };

describe("extension/server build comparison", () => {
  it("warns about older and newer servers, including development builds", () => {
    for (const version of ["1.3.0", "1.5.0"])
      expect(buildsDiffer(release, { version, revision: "dev", dev: true })).toBe(true);
  });

  it("compares verified revisions but never invents a development mismatch", () => {
    expect(buildsDiffer(release, release)).toBe(false);
    expect(buildsDiffer(release, { ...release, revision: "b".repeat(40) })).toBe(true);
    const development = { ...release, revision: "dev", dev: true };
    expect(buildsDiffer(release, development)).toBe(false);
    expect(buildsDiffer(development, release)).toBe(false);
    expect(buildsDiffer(development, development)).toBe(false);
    expect(buildsDiffer(release, null)).toBe(false);
  });

  it("ignores reproducible-build timestamps when reading identity", () => {
    expect(parseBuildIdentity({ ...release, build_time: "1980-01-01T00:00:00Z" })).toEqual(release);
  });

  it.each([
    null,
    {},
    { ...release, version: "bad" },
    { ...release, revision: "dev" },
    { ...release, dev: "false" },
  ])("rejects invalid identity %j", (value) =>
    expect(() => parseBuildIdentity(value)).toThrow("Invalid server build"),
  );

  it("gives connection failures priority and restores the mismatch after reconnecting", () => {
    expect(toolbarStatus(false, true)).toMatchObject({ text: "!", color: "#e53e3e" });
    expect(toolbarStatus(true, true)).toMatchObject({ text: "↑", color: "#b45309" });
    expect(toolbarStatus(true, false)).toMatchObject({ text: "", title: "Job Tracker" });
  });
});
