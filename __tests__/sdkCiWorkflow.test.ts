import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("SDK CI workflow", () => {
  it("keeps SDK validation on Node 18, 20, and 22", () => {
    const workflow = read(".github/workflows/sdk-ci.yml")
    const packageJson = JSON.parse(read("package.json")) as {
      devDependencies: Record<string, string>
    }
    const sdkPackage = JSON.parse(read("packages/pinetree-node/package.json")) as {
      engines: { node: string }
    }

    expect(workflow).toContain('node: ["18", "20", "22"]')
    expect(workflow).toContain("npm run typecheck --workspace packages/pinetree-node")
    expect(workflow).toContain("npm run build --workspace packages/pinetree-node")
    expect(workflow).toContain("npm test --workspace packages/pinetree-node")
    expect(sdkPackage.engines.node).toBe(">=18")
    expect(packageJson.devDependencies.vite).toMatch(/^\^6\./)
    expect(packageJson.devDependencies.vitest).toMatch(/^\^3\./)
  })

  it("runs root Next.js checks only on a supported Node version", () => {
    const workflow = read(".github/workflows/sdk-ci.yml")

    expect(workflow).toContain("- name: Root typecheck\n        if: matrix.node == '20'")
    expect(workflow).toContain("- name: Root tests\n        if: matrix.node == '20'")
    expect(workflow).toContain("actions/checkout@v6")
    expect(workflow).toContain("actions/setup-node@v6")
    expect(workflow).toContain('"package-lock.json"')
    // Lockfile is committed and aligned; SDK validation runs explicit scripts below.
    expect(workflow.match(/run: npm ci --ignore-scripts/g)).toHaveLength(2)
    expect(workflow).not.toContain("run: npm ci\n")
    expect(workflow).not.toContain("run: npm install")
  })
})
