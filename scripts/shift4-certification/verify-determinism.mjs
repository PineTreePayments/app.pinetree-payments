import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"

const runOnce = async () => {
  const output = execFileSync(process.execPath, ["scripts/shift4-certification/run.mjs", "--mode", "fixture", "--channel", "all"], { encoding: "utf8" }).trim()
  const summary = JSON.parse(output)
  const report = JSON.parse(await readFile(summary.jsonPath, "utf8"))
  const { startedAt: _startedAt, completedAt: _completedAt, ...normalized } = report
  void _startedAt
  void _completedAt
  const normalizedJson = JSON.stringify(normalized)
  return { summary, normalizedSha256: createHash("sha256").update(normalizedJson).digest("hex").toUpperCase() }
}

const first = await runOnce()
const second = await runOnce()
if (first.summary.providerRequestsSent !== 0 || second.summary.providerRequestsSent !== 0) throw new Error("Fixture isolation failed")
if (first.summary.runId !== second.summary.runId) throw new Error("Stable run ID mismatch")
if (first.summary.manifestHash !== second.summary.manifestHash) throw new Error("Manifest hash mismatch")
if (first.normalizedSha256 !== second.normalizedSha256) throw new Error("Normalized certification evidence is not deterministic")

console.log(JSON.stringify({ ok: true, runs: 2, caseCount: first.summary.caseCount, runId: first.summary.runId, manifestHash: first.summary.manifestHash, normalizedSha256: first.normalizedSha256, providerRequestsSent: 0 }))
