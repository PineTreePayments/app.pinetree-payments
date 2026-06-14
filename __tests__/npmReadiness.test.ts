import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")) as Record<string, unknown>
}

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("npm package readiness", () => {
  it("@pinetreepayments/node is not marked private and has publishConfig", () => {
    const pkg = readJson("packages/pinetree-node/package.json")
    expect(pkg.private).not.toBe(true)
    expect((pkg.publishConfig as Record<string, string>)?.access).toBe("public")
  })

  it("@pinetreepayments/js is not marked private and has publishConfig", () => {
    const pkg = readJson("packages/pinetree-js/package.json")
    expect(pkg.private).not.toBe(true)
    expect((pkg.publishConfig as Record<string, string>)?.access).toBe("public")
  })

  it("@pinetreepayments/react is not marked private and has publishConfig", () => {
    const pkg = readJson("packages/pinetree-react/package.json")
    expect(pkg.private).not.toBe(true)
    expect((pkg.publishConfig as Record<string, string>)?.access).toBe("public")
  })

  it("@pinetreepayments/react depends on @pinetreepayments/js with semver, not file:", () => {
    const pkg = readJson("packages/pinetree-react/package.json")
    const deps = pkg.dependencies as Record<string, string>
    expect(deps["@pinetreepayments/js"]).toBeDefined()
    expect(deps["@pinetreepayments/js"]).not.toContain("file:")
    expect(deps["@pinetreepayments/js"]).toMatch(/^\^?\d/)
  })

  it("all packages have correct scoped names and license", () => {
    const node = readJson("packages/pinetree-node/package.json")
    const js = readJson("packages/pinetree-js/package.json")
    const react = readJson("packages/pinetree-react/package.json")
    expect(node.name).toBe("@pinetreepayments/node")
    expect(js.name).toBe("@pinetreepayments/js")
    expect(react.name).toBe("@pinetreepayments/react")
    expect(node.license).toBe("MIT")
    expect(js.license).toBe("MIT")
    expect(react.license).toBe("MIT")
  })

  it("all packages declare only dist, README, and CHANGELOG in files", () => {
    for (const pkg of ["pinetree-node", "pinetree-js", "pinetree-react"]) {
      const manifest = readJson(`packages/${pkg}/package.json`)
      const files = manifest.files as string[]
      expect(files).toContain("dist")
      expect(files).toContain("README.md")
      expect(files).toContain("CHANGELOG.md")
      expect(files).not.toContain("src")
      expect(files).not.toContain("test")
      expect(files).not.toContain("scripts")
    }
  })

  it("packaging script produces artifacts/woocommerce output and excludes tests", () => {
    const script = read("scripts/package-woocommerce-plugin.mjs")
    expect(script).toContain("artifacts/woocommerce")
    expect(script).toContain("pinetree-woocommerce.zip")
    expect(script).toContain("tests")
    expect(script).toContain("woocommerce-pinetree.php")
    expect(script).not.toContain("github.com")
  })

  it("root package.json has package:woocommerce script", () => {
    const pkg = readJson("package.json")
    const scripts = pkg.scripts as Record<string, string>
    expect(scripts["package:woocommerce"]).toBeDefined()
    expect(scripts["package:woocommerce"]).toContain("package-woocommerce-plugin.mjs")
  })
})
