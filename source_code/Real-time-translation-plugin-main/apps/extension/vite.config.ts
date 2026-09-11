import { defineConfig } from "vite";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const target = process.env.BROWSER_TARGET === "safari" ? "safari" : "chrome";

function copyStatic() {
  return {
    name: "copy-extension-static",
    closeBundle() {
      const outDir = resolve(import.meta.dirname, target === "safari" ? "dist-safari" : "dist");
      mkdirSync(outDir, { recursive: true });
      cpSync(resolve(import.meta.dirname, `manifests/${target}.json`), resolve(outDir, "manifest.json"));
      for (const file of ["popup.html", "options.html", "offscreen.html"]) {
        const input = resolve(import.meta.dirname, "static", file);
        if (existsSync(input) && (target === "chrome" || file !== "offscreen.html")) cpSync(input, resolve(outDir, file));
      }
      const icons = resolve(import.meta.dirname, "static/icons");
      if (existsSync(icons)) cpSync(icons, resolve(outDir, "icons"), { recursive: true });
    },
  };
}

export default defineConfig({
  define: { __BROWSER_TARGET__: JSON.stringify(target) },
  build: {
    outDir: target === "safari" ? "dist-safari" : "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, target === "safari" ? "src/safari/background.ts" : "src/chrome/background.ts"),
        content: resolve(import.meta.dirname, "src/content.ts"),
        popup: resolve(import.meta.dirname, "src/ui/popup.ts"),
        options: resolve(import.meta.dirname, "src/ui/options.ts"),
        ...(target === "chrome" ? {
          offscreen: resolve(import.meta.dirname, "src/chrome/offscreen.ts"),
          "pcm-worklet": resolve(import.meta.dirname, "src/chrome/pcm-worklet.ts"),
        } : {}),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [copyStatic()],
});
