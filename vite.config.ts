// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        strategies: "generateSW",
        filename: "sw.js",
        // Lovable publishes the website from dist/client.
        outDir: "dist/client",
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
  },
});
