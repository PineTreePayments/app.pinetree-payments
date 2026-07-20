import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const inventory = read("app/dashboard/inventory/page.tsx")

describe("Inventory UI polish", () => {
  it("uses a compact rectangular Add Item action while preserving behavior", () => {
    const addItemAction = inventory.slice(
      inventory.indexOf("action={"),
      inventory.indexOf('<div className="overflow-hidden rounded-2xl')
    )

    expect(addItemAction).toContain("onClick={openCreate}")
    expect(addItemAction).toContain("disabled={!available}")
    expect(addItemAction).toContain("<PackagePlus")
    expect(addItemAction).toContain("Add Item")
    expect(addItemAction).toContain("<PrimaryActionButton")
    expect(addItemAction).not.toContain("rounded-full")
    expect(addItemAction).not.toContain("w-full")
  })

  it("uses the shared PineTree segmented button component for inventory filters", () => {
    const filterButtons = inventory.slice(
      inventory.indexOf("(["),
      inventory.indexOf("{loading ? (")
    )

    expect(inventory).toContain('import { SegmentedButtons } from "@/components/ui/SegmentedButtons"')
    expect(filterButtons).toContain("<SegmentedButtons")
    expect(filterButtons).toContain('["ALL", "All"]')
    expect(filterButtons).toContain('["ACTIVE", "Active"]')
  })
})
