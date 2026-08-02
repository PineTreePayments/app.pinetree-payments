import { certificationCases, workbookProvenance } from "./manifest.mjs"

const ids = new Set()
for (const item of certificationCases) {
  if (ids.has(item.id)) throw new Error(`Duplicate certification case: ${item.id}`)
  ids.add(item.id)
  if (!Number.isInteger(item.test) || !item.name || !item.expected) throw new Error(`Invalid certification case: ${item.id}`)
  if (item.amountMinor !== null && (!Number.isSafeInteger(item.amountMinor) || item.amountMinor <= 0)) throw new Error(`Invalid amount: ${item.id}`)
}
if (certificationCases.filter((item) => item.channel === "ecommerce").length !== 23) throw new Error("Expected 23 e-commerce cases")
if (certificationCases.filter((item) => item.channel === "retail").length !== 26) throw new Error("Expected 26 retail cases")
if (!Object.values(workbookProvenance).every((item) => /^[A-F0-9]{64}$/.test(item.sha256))) throw new Error("Workbook provenance hashes are invalid")
console.log(JSON.stringify({ ok: true, caseCount: certificationCases.length, channels: { ecommerce: 23, retail: 26 } }))
