import { defineConfig } from "vite";

const api = process.env.COPILOT_URL || "http://127.0.0.1:8787";

// No React plugin: Vite's own esbuild compiles the JSX (automatic runtime). Edits reload the page instead of hot
// swapping components, which is all this panel needs.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  build: { outDir: "dist/app", emptyOutDir: true },
  server: {
    proxy: {
      // The API refuses cross-origin writes, so the dev proxy drops the browser's Origin (localhost:5173).
      "/api": { target: api, changeOrigin: true, configure: (proxy) => proxy.on("proxyReq", (r) => r.removeHeader("origin")) },
    },
  },
});
