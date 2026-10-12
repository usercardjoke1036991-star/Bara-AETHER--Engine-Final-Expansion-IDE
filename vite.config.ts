import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El front-end vive en `web/` y no en `src/`: en esta carpeta `src/` ya está
// ocupada por los fuentes Rust del motor (`bara-ide`). Vite sirve `web/` como
// raíz, y Tauri arranca `npm run dev` desde aquí esperando el puerto 1420.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: "web",
  plugins: [react()],
  // Tauri muestra sus propios diagnósticos: no borrar la consola.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    // El backend Rust no se observa desde Vite (lo compila Cargo).
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // WebView2 (Chromium) va muy por delante de este objetivo.
    target: "chrome105",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
  },
});
