// Builds the screens for the Android app into android/build/www.
// Run with: bun run build:app
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: path.resolve(__dirname, "android/web"),
  publicDir: path.resolve(__dirname, "public"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  define: {
    "import.meta.env.VITE_APP": JSON.stringify("1"),
    "import.meta.env.VITE_API_BASE": JSON.stringify(process.env.LECTURELY_SERVER ?? ""),
  },
  build: { outDir: path.resolve(__dirname, "android/build/www"), emptyOutDir: true, chunkSizeWarningLimit: 30000 },
});
