import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@boringos/shared": resolve(__dirname, "packages/@boringos/shared/src/index.ts"),
      "@boringos/memory": resolve(__dirname, "packages/@boringos/memory/src/index.ts"),
      "@boringos/runtime": resolve(__dirname, "packages/@boringos/runtime/src/index.ts"),
      "@boringos/drive": resolve(__dirname, "packages/@boringos/drive/src/index.ts"),
      "@boringos/db": resolve(__dirname, "packages/@boringos/db/src/index.ts"),
      "@boringos/agent": resolve(__dirname, "packages/@boringos/agent/src/index.ts"),
      "@boringos/pipeline": resolve(__dirname, "packages/@boringos/pipeline/src/index.ts"),
      "@boringos/connector": resolve(__dirname, "packages/@boringos/connector/src/index.ts"),
      "@boringos/connector-slack": resolve(__dirname, "packages/@boringos/connector-slack/src/index.ts"),
      "@boringos/connector-google": resolve(__dirname, "packages/@boringos/connector-google/src/index.ts"),
      "@boringos/workflow": resolve(__dirname, "packages/@boringos/workflow/src/index.ts"),
      "@boringos/core": resolve(__dirname, "packages/@boringos/core/src/index.ts"),
      "@boringos/ui": resolve(__dirname, "packages/@boringos/ui/src/index.ts"),
      "@boringos/app-sdk": resolve(__dirname, "packages/@boringos/app-sdk/src/index.ts"),
      "@boringos/connector-sdk": resolve(__dirname, "packages/@boringos/connector-sdk/src/index.ts"),
      "@boringos/shell": resolve(__dirname, "packages/@boringos/shell/src"),
      "@boringos/control-plane": resolve(__dirname, "packages/@boringos/control-plane/src/index.ts"),
      "@boringos/dev-host": resolve(__dirname, "packages/@boringos/dev-host/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 120000,
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 1,
        minForks: 1,
      },
    },
  },
});
