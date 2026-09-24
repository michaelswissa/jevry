import { build } from "esbuild";
await build({
  entryPoints: ["desktop/main.ts", "desktop/preload.ts"],
  outdir: "dist-desktop",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  external: ["electron", "tesseract.js", "@tesseract.js-data/eng"],
  sourcemap: true,
});
