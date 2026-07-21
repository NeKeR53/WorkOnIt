import { describe, expect, it } from "vitest";

import { validateReleaseVersion } from "./check-release-version.mjs";

const matchingVersions = {
  "package.json": "0.1.0",
  "src-tauri/tauri.conf.json": "0.1.0",
  "src-tauri/Cargo.toml": "0.1.0",
};

describe("validateReleaseVersion", () => {
  it("accepts a v-prefixed tag matching every project version", () => {
    expect(validateReleaseVersion("v0.1.0", matchingVersions)).toBe(
      "Release tag v0.1.0 matches all project versions.",
    );
  });

  it("rejects a mismatched project version", () => {
    expect(() =>
      validateReleaseVersion("v0.1.0", {
        ...matchingVersions,
        "src-tauri/Cargo.toml": "0.2.0",
      }),
    ).toThrow("src-tauri/Cargo.toml=0.2.0");
  });

  it("rejects a missing Cargo version", () => {
    expect(() =>
      validateReleaseVersion("v0.1.0", {
        ...matchingVersions,
        "src-tauri/Cargo.toml": undefined,
      }),
    ).toThrow("src-tauri/Cargo.toml=missing");
  });

  it.each([undefined, "0.1.0"])("rejects the invalid tag %s", (tag) => {
    expect(() => validateReleaseVersion(tag, matchingVersions)).toThrow();
  });
});
