import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run against core's source, so no build is needed first.
export default defineConfig({
  resolve: {
    alias: { "@lifecycle/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) },
  },
});
