import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "frontend/admin-dashboard/dist");
const admin = resolve(root, "frontend/admin");
const vercelConfigPath = resolve(root, "vercel.json");

const backendUrl = (
  process.env.BACKEND_URL ||
  process.env.VITE_BACKEND_URL ||
  "https://ai-interview-backend-u6y0.onrender.com"
).replace(/\/$/, "");

rmSync(admin, { recursive: true, force: true });
cpSync(dist, admin, { recursive: true });

const vercel = JSON.parse(readFileSync(vercelConfigPath, "utf8"));
const apiPrefixes = [
  "admin/hr-code",
  "auth",
  "hr",
  "job",
  "interview",
  "api",
  "masters",
  "ats",
  "candidate",
  "proctor",
  "session-status",
  "setup",
  "extract-skills",
  "next",
  "answer",
  "submit",
  "report",
  "network-info",
  "models",
  "candidates",
  "health",
  "hr-records",
  "hr-record",
  "version",
];

const rewrites = [];
for (const prefix of apiPrefixes) {
  rewrites.push({
    source: `/${prefix}/:path*`,
    destination: `${backendUrl}/${prefix}/:path*`,
  });
  rewrites.push({
    source: `/${prefix}`,
    destination: `${backendUrl}/${prefix}`,
  });
}
rewrites.push({ source: "/admin", destination: "/admin/index.html" });
rewrites.push({ source: "/admin/", destination: "/admin/index.html" });

vercel.rewrites = rewrites;
writeFileSync(vercelConfigPath, `${JSON.stringify(vercel, null, 2)}\n`, "utf8");

console.log(`Copied admin dashboard build to frontend/admin/`);
console.log(`Vercel rewrites target: ${backendUrl}`);
