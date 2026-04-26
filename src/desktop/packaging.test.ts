import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe("desktop packaging runtime dependencies", () => {
  it("keeps pi runtime packages in production dependencies for electron-builder", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as PackageManifest;

    expect(manifest.dependencies?.["@mariozechner/pi-coding-agent"]).toBeDefined();
    expect(manifest.devDependencies?.["@mariozechner/pi-coding-agent"]).toBeUndefined();
  });
});
