import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

describe("v1 checkout session API key scopes", () => {
  it("registers v1 checkout and payment scopes in validation and defaults", () => {
    const root = process.cwd()
    const databaseSource = fs.readFileSync(
      path.join(root, "database/merchantApiKeys.ts"),
      "utf8"
    )
    const engineSource = fs.readFileSync(
      path.join(root, "engine/merchantApiKeys.ts"),
      "utf8"
    )
    const routeSource = fs.readFileSync(
      path.join(root, "app/api/merchant/api-keys/route.ts"),
      "utf8"
    )

    expect(databaseSource).toContain('"checkout.sessions:read"')
    expect(engineSource).toContain('"checkout.sessions:read"')
    expect(routeSource).toContain('"checkout.sessions:read"')
    expect(databaseSource).toContain('"checkout.sessions:write"')
    expect(databaseSource).toContain('"payments:read"')
    expect(engineSource).toContain('"checkout.sessions:write"')
    expect(engineSource).toContain('"payments:read"')
  })
})
