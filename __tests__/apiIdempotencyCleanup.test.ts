import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"

const { deleteExpiredCompletedApiIdempotencyClaims } = vi.hoisted(() => ({
  deleteExpiredCompletedApiIdempotencyClaims: vi.fn(),
}))

vi.mock("@/database/apiIdempotencyClaims", () => ({
  deleteExpiredCompletedApiIdempotencyClaims,
}))

import { cleanupExpiredApiIdempotencyClaims } from "@/engine/apiIdempotencyCleanup"

describe("API idempotency cleanup", () => {
  it("delegates cleanup with the requested cutoff", async () => {
    deleteExpiredCompletedApiIdempotencyClaims.mockResolvedValue(3)
    const now = new Date("2026-06-12T12:00:00.000Z")
    await expect(cleanupExpiredApiIdempotencyClaims(now)).resolves.toMatchObject({
      deletedCount: 3,
    })
    expect(deleteExpiredCompletedApiIdempotencyClaims).toHaveBeenCalledWith(
      now.toISOString()
    )
  })

  it("only matches expired completed claims", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "database/apiIdempotencyClaims.ts"),
      "utf8"
    )
    expect(source).toContain('.lt("expires_at", now)')
    expect(source).toContain('.not("resource_id", "is", null)')
    expect(source).toContain('.not("response_body", "is", null)')
  })
})
