import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@ipp/ipp": fileURLToPath(
        new URL("./packages/ipp/src/index.ts", import.meta.url),
      ),
      "@ipp/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    passWithNoTests: false,
  },
})
