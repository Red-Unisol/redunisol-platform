import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { UI_LAB_API_ORIGIN } from "./network-guard";

const labRoot = fileURLToPath(new URL(".", import.meta.url));
const frontendRoot = path.resolve(labRoot, "..");
const outDir = path.resolve(frontendRoot, ".local/ui-lab-dist");
if (
  path.relative(frontendRoot, outDir).replaceAll("\\", "/") !==
  ".local/ui-lab-dist"
)
  throw new Error("UI Lab output must stay inside frontend/.local/ui-lab-dist");
const contentSecurityPolicy =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:5271 ws://localhost:5271; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
const headers = {
  "Content-Security-Policy": contentSecurityPolicy,
  "X-DNS-Prefetch-Control": "off",
};
export default defineConfig({
  root: labRoot,
  envDir: false,
  envPrefix: "UI_LAB_ONLY_",
  publicDir: false,
  plugins: [
    {
      name: "ui-lab-policy",
      transformIndexHtml: (html) =>
        html.replace(
          "<!-- UI_LAB_POLICY -->",
          `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />`,
        ),
    },
    react(),
    tailwindcss(),
  ],
  define: {
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(UI_LAB_API_ORIGIN),
  },
  resolve: { alias: { "@": path.resolve(frontendRoot, "src") } },
  server: {
    host: "127.0.0.1",
    port: 5271,
    strictPort: true,
    open: false,
    headers,
    fs: { allow: [frontendRoot] },
  },
  preview: {
    host: "127.0.0.1",
    port: 5271,
    strictPort: true,
    open: false,
    headers,
  },
  build: { outDir, emptyOutDir: true },
});
