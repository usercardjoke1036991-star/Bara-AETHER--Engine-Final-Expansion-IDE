// Comprobación rápida del panel de IA sin navegador:  npm run test:ai
//
// Empaqueta las piezas puras de `src/ai/selfcheck.ts` con la API de Vite (no se
// añade ninguna dependencia nueva) y ejecuta el autodiagnóstico en Node, de modo
// que la lógica multimodal se puede validar sin abrir la ventana del IDE.

import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../src/ai/selfcheck.ts");
const outDir = resolve(here, "../node_modules/.cache/bara-ai-selfcheck");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  configFile: false,
  logLevel: "warn",
  build: {
    ssr: entry,
    outDir,
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: { output: { entryFileNames: "selfcheck.mjs", format: "es" } },
  },
});

const module = await import(pathToFileURL(resolve(outDir, "selfcheck.mjs")).href);
const results = module.runSelfCheck();
console.log(module.formatReport(results));

const { failed, total } = module.summarize(results);
if (failed > 0) {
  console.error(`\n${failed} de ${total} comprobaciones del panel de IA han fallado`);
  process.exit(1);
}
console.log(`\nAutodiagnóstico del panel de IA: ${total} comprobaciones correctas.`);
