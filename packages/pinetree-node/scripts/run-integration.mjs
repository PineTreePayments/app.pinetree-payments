import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const vitest = resolve(packageRoot, "..", "..", "node_modules", "vitest", "vitest.mjs")
const env = { ...process.env, PINETREE_RUN_INTEGRATION: "true" }

if (process.argv[2] === "local" && !env.PINETREE_INTEGRATION_BASE_URL) {
  env.PINETREE_INTEGRATION_BASE_URL = "http://localhost:3000"
}

const result = spawnSync(
  process.execPath,
  [vitest, "run", "--config", "vitest.integration.config.ts", "--reporter=verbose"],
  {
    cwd: packageRoot,
    env,
    stdio: "inherit",
  }
)

process.exit(result.status ?? 1)
