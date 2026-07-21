import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const API_PROXY_PREFIXES = [
  "/hr",
  "/auth",
  "/job",
  "/interview",
  "/api",
  "/masters",
  "/ats",
  "/candidate",
  "/proctor",
  "/session-status",
  "/setup",
  "/extract-skills",
  "/next",
  "/answer",
  "/submit",
  "/report",
  "/network-info",
  "/models",
  "/candidates",
  "/health",
  "/hr-records",
  "/hr-record",
  "/version",
  "/admin/hr-code",
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendTarget = env.VITE_BACKEND_URL || "http://127.0.0.1:2020";
  const proxy = Object.fromEntries(
    API_PROXY_PREFIXES.map((prefix) => [
      prefix,
      {
        target: backendTarget,
        changeOrigin: true,
        secure: false,
      },
    ])
  );

  return {
    plugins: [react()],
    base: "/admin/",
    server: {
      port: 5173,
      strictPort: true,
      proxy,
    },
    esbuild: {
      drop: mode === "production" ? ["console", "debugger"] : [],
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      target: "es2022",
      minify: "esbuild",
      cssCodeSplit: true,
      reportCompressedSize: false,
      modulePreload: {
        polyfill: false,
        resolveDependencies(_filename, deps) {
          return deps.filter((dep) => !dep.includes("vendor-pdf"));
        },
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("/node_modules/react-dom/") || id.match(/[\\/]node_modules[\\/]react[\\/]/)) {
              return "vendor-react";
            }
            if (id.includes("/node_modules/lucide-react/")) {
              return "vendor-icons";
            }
            if (id.includes("/node_modules/framer-motion/")) {
              return "vendor-motion";
            }
            if (id.includes("/node_modules/recharts/")) {
              return "vendor-charts";
            }
            if (
              id.includes("/node_modules/html2canvas/") ||
              id.includes("/node_modules/jspdf/") ||
              id.includes("/node_modules/dompurify/")
            ) {
              return "vendor-pdf";
            }
            return undefined;
          },
        },
      },
      chunkSizeWarningLimit: 400,
    },
  };
});
