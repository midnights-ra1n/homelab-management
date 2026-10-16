import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const mg = (p: string) => fileURLToPath(new URL(`./src/mg/${p}`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The management UI keeps homelab-management's imports: "@/…" and the few Next.js modules it used.
  resolve: {
    alias: [
      { find: /^@\//, replacement: mg("") },
      { find: "next/link", replacement: mg("next/link.tsx") },
      { find: "next/navigation", replacement: mg("next/navigation.ts") },
    ],
  },
  build: { outDir: "../server/web/dist", emptyOutDir: true, chunkSizeWarningLimit: 800 },
  // Dev proxy to a server started with `cd server && go run .` (override with HLT_API=http://host:port).
  server: { proxy: { "/api": { target: process.env.HLT_API || "http://127.0.0.1:8080", ws: true } } },
});
