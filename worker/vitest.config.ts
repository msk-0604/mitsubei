import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["test/calc.test.ts"] } },
      {
        test: {
          name: "api",
          include: ["test/api.test.ts"],
          globalSetup: ["test/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 90_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
