import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("release-candidate script", () => {
  it("validates package metadata and exposes an offline dry run", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/release-candidate.mjs"), "--dry-run"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("@pinetree/node build")
    expect(result.stdout).toContain("@pinetree/js build")
    expect(result.stdout).toContain("@pinetree/react build")
    expect(result.stdout).toContain("npm pack --dry-run")
    expect(result.stdout).toContain("Release-candidate dry run passed")
  })
})
