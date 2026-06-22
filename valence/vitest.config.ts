import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@valence": path.resolve(__dirname, "src"),
      "@valence/types": path.resolve(__dirname, "src/types"),
      "@valence/config": path.resolve(__dirname, "src/config"),
      "@valence/wallet": path.resolve(__dirname, "src/wallet"),
      "@valence/rpc": path.resolve(__dirname, "src/rpc"),
      "@valence/lifecycle": path.resolve(__dirname, "src/lifecycle"),
      "@valence/jito": path.resolve(__dirname, "src/jito"),
      "@valence/yellowstone": path.resolve(__dirname, "src/yellowstone"),
      "@valence/agent": path.resolve(__dirname, "src/agent"),
      "@valence/log": path.resolve(__dirname, "src/log"),
    },
  },
})
