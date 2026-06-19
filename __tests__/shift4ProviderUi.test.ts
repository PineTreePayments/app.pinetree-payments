import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("Shift4 provider setup UI", () => {
  it("uses the application CTA and removes manual setup fields", () => {
    const source = read("app/dashboard/providers/page.tsx")

    expect(source).toContain("Start Shift4 Application")
    expect(source).toContain("Shift4 Merchant Application")
    expect(source).toContain("Complete the application to begin onboarding for card and crypto payment acceptance through Shift4.")
    expect(source).toContain("Begin Application")
    expect(source).toContain("Application link not configured yet.")
    expect(source).toContain("NEXT_PUBLIC_SHIFT4_APPLICATION_URL")
    expect(source).toContain("SHIFT4_APPLICATION_URL")

    expect(source).not.toContain("Shift4 account reference")
    expect(source).not.toContain("Setup notes")
    expect(source).not.toContain("Optional internal note")
    expect(source).not.toContain("Shift4 Account Reference is required")
    expect(source).not.toContain("Shift4 provider setup saved")
  })

  it("keeps Shift4 status rows read-only and managed by PineTree / Shift4", () => {
    const source = read("app/dashboard/providers/page.tsx")

    expect(source).toContain("Merchant approval")
    expect(source).toContain("API access")
    expect(source).toContain("Webhook return")
    expect(source).toContain("Managed by PineTree / Shift4")
  })
})
