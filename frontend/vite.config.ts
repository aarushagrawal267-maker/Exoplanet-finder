/// <reference types="vitest/config" />
/**
 * Vite configuration for the Exoplanet Finder UI.
 *
 * - Dev server on :5173 (strictPort) with `/api` proxied to the FastAPI backend
 *   (default http://127.0.0.1:8000, override with VITE_API_URL in the environment or `.env`).
 * - Vitest runs in jsdom with Testing Library matchers (see src/test/setup.ts).
 * - Plotly is large (~4.6 MB minified); it is only ever loaded lazily, in its own chunk.
 */
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_URL || process.env.VITE_API_URL || "http://127.0.0.1:8000";

  return {
    plugins: [react()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          // Server-sent events must not be buffered by the proxy.
          configure: (proxy) => {
            // Backend down → 502 with the API's error envelope (instead of Vite's empty 500), so
            // the client can tell "server not running" apart from a real server error.
            proxy.on("error", (err, _req, res) => {
              const out = res as unknown as import("node:http").ServerResponse;
              if (!out || typeof out.writeHead !== "function" || out.headersSent) return;
              out.writeHead(502, { "Content-Type": "application/json" });
              out.end(
                JSON.stringify({
                  detail: "The Exoplanet Finder backend is not reachable.",
                  code: "backend_unreachable",
                  hint: `Start it with scripts/start.sh (or start.ps1) — expected at ${apiTarget}. (${(err as NodeJS.ErrnoException).code ?? err.message})`,
                }),
              );
            });
            proxy.on("proxyRes", (proxyRes) => {
              if (String(proxyRes.headers["content-type"] ?? "").includes("text/event-stream")) {
                proxyRes.headers["cache-control"] = "no-cache";
                proxyRes.headers["x-accel-buffering"] = "no";
              }
            });
          },
        },
      },
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy: { "/api": { target: apiTarget, changeOrigin: true } },
    },
    optimizeDeps: {
      include: ["react-plotly.js/factory", "plotly.js-dist-min"],
    },
    build: {
      target: "es2022",
      sourcemap: true,
      // The lazily-loaded Plotly chunk is intentionally large.
      chunkSizeWarningLimit: 5000,
      // No manualChunks: Plotly and Recharts are only reached through dynamic imports, so Rollup
      // already isolates them; forcing chunks can hoist shared CJS helpers into the entry graph.
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: false,
      include: ["src/**/*.test.{ts,tsx}"],
      restoreMocks: true,
      // Vitest's default 5 s per test/hook is too tight on slow or busy machines (page tests render
      // whole pages in jsdom and some wait up to 5 s for async UI), so they timed out spuriously.
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  };
});
