import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Keeps favicon.png in renderer `public/` in sync with `electron/assets/logo.png`. */
function copyElectronLogoFavicon() {
  return {
    name: "copy-electron-logo-favicon",
    buildStart() {
      const repoRoot = __dirname;
      const logoPath = path.join(repoRoot, "electron/assets/logo.png");
      const publicDir = path.join(repoRoot, "src/renderer/public");
      const dest = path.join(publicDir, "favicon.png");
      if (!existsSync(logoPath)) {
        return;
      }
      mkdirSync(publicDir, { recursive: true });
      copyFileSync(logoPath, dest);
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, "src/renderer"),
  base: "./",
  plugins: [react(), copyElectronLogoFavicon()],
  server: {
    port: 5180,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
});
