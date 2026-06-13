import { configDefaults, defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@pinetree/js": path.resolve(
        __dirname,
        "packages/pinetree-js/src/index.ts"
      ),
      "@pinetree/react": path.resolve(
        __dirname,
        "packages/pinetree-react/src/index.ts"
      ),
    },
  },
  test: {
    environment: "node",
    exclude: [
      ...configDefaults.exclude,
      "packages/pinetree-node/test/integration/**",
    ],
  },
})
