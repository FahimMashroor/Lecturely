// Builds the Lecturely website (pages + its small server).
// Run with: bun run build   (the finished website ends up in .output/)
import path from "node:path";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ command }) => ({
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
    // The speech helper (src/lib/speech.worker.ts) is built as a modern module.
    worker: { format: "es" },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      // src/server.ts wraps the server so a crash shows a friendly error page.
      tanstackStart({ server: { entry: "server" } }),
      // The website's server runs on any computer with Node.js:  node .output/server/index.mjs
      ...(command === "build" ? [nitro({ preset: "node-server" })] : []),
      viteReact(),
      VitePWA({
        strategies: "generateSW",
        filename: "sw.js",
        // The finished website is in .output/public.
        outDir: ".output/public",
        registerType: "autoUpdate",
        injectRegister: null,
        manifest: false,
        devOptions: { enabled: false },
        workbox: {
          globPatterns: ["**/*.{js,css,png,ico,svg,webmanifest,woff2}"],
          maximumFileSizeToCacheInBytes: 30_000_000,
          navigateFallback: null,
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) => request.mode === "navigate" && !url.pathname.startsWith("/~oauth"),
              handler: "NetworkFirst",
              options: { cacheName: "pages", networkTimeoutSeconds: 4 },
            },
            {
              // The app's own code and styles. Their names change whenever the code
              // changes, so a saved copy is always the right one. This lets the
              // installed app open with no internet after it has been opened once online.
              urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/assets/") && /\.(js|css|woff2)$/.test(url.pathname),
              handler: "CacheFirst",
              options: { cacheName: "app-files", expiration: { maxEntries: 80 }, cacheableResponse: { statuses: [200] } },
            },
            {
              urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/(icon-192|icon-512|apple-touch-icon|favicon)\.png$|^\/manifest\.webmanifest$/.test(url.pathname),
              handler: "StaleWhileRevalidate",
              options: { cacheName: "app-icons" },
            },
            {
              urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/assets/") && url.pathname.endsWith(".wasm"),
              handler: "CacheFirst",
              options: { cacheName: "offline-wasm", cacheableResponse: { statuses: [200] } },
            },
            {
              urlPattern: ({ url }) => /(^|\.)(jsdelivr\.net|huggingface\.co|hf\.co|githubusercontent\.com)$/.test(url.hostname),
              handler: "CacheFirst",
              options: { cacheName: "offline-engines", expiration: { maxEntries: 200 }, cacheableResponse: { statuses: [0, 200] } },
            },
          ],
        },
      }),
    ],
}));
