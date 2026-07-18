import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/engine", "@/lib/engine/*"],
              message: "Use canonical engine imports from @/engine/*"
            },
            {
              group: ["@/lib/providers", "@/lib/providers/*"],
              message: "Use canonical provider imports from @/providers/*"
            }
          ]
        }
      ]
    }
  },
  {
    files: ["__tests__/**/*.ts", "__tests__/**/*.tsx"],
    rules: {
      // A small number of module-cache isolation tests intentionally use
      // require() after vi.resetModules(); application source remains ESM-only.
      "@typescript-eslint/no-require-imports": "off"
    }
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated package build artifacts — not source, not linted:
    "packages/*/dist/**",
    "packages/*/node_modules/**",
    "coverage/**",
    // Claude/Codex auxiliary worktrees are complete repository copies. Lint
    // the active checkout only; copied source is validated in its own worktree.
    ".claude/worktrees/**",
    // Hardhat/Solidity toolchain — separate CJS module system, not Next.js app source:
    "contracts/**",
  ]),
]);

export default eslintConfig;
