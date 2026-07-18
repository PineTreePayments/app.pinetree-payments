import { configDefaults, defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@pinetreepayments/js": path.resolve(
        __dirname,
        "packages/pinetree-js/src/index.ts"
      ),
      "@pinetreepayments/react": path.resolve(
        __dirname,
        "packages/pinetree-react/src/index.ts"
      ),
    },
  },
  test: {
    environment: "node",
    env: {
      // Source-contract tests import database modules without contacting a
      // database. Give Supabase's constructor valid inert test configuration
      // so collection does not depend on a developer's untracked env files.
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "pinetree-test-anon-key",
    },
    exclude: [
      ...configDefaults.exclude,
      "packages/pinetree-node/test/integration/**",
      ".claude/worktrees/**",
    ],
  },
})
