import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react()],
  build: {
    target: "es2022",
    cssCodeSplit: true,
    chunkSizeWarningLimit: 400,
  },
  clearScreen: false,
  server: {
    port: 43123,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 43124,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  preview: {
    port: 43123,
    strictPort: true,
    host: "127.0.0.1",
  },
}));
