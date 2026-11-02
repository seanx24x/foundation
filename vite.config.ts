import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ["@monaco-editor/react", "monaco-editor"] },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    hmr: { overlay: false },
    watch: {
      ignored: [
        "**/artifacts/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    },
    proxy: {
      "/api": `http://127.0.0.1:${process.env.FOUNDATION_API_PORT || 4174}`,
    },
  },
  build: {
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        preview: resolve(import.meta.dirname, "project-preview.html"),
      },
    },
  },
});
