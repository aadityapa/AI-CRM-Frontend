/** Story harness — the Interview Integrity page with mocked data (7 Oct 2026).
 *  Build via /tmp/fb/vite.story.config.ts (input integ.html); the two WebMs come
 *  from the recording harness. `?open=1` expands the first row. */
import { createRoot } from "react-dom/client";
import "../styles.css";
import { ThemeProvider } from "../theme/ThemeProvider";
import { IntegrityLogsPage } from "../pages/IntegrityLogs";

const day = (d: number) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 16).replace("T", " ");
const fam = (o: Partial<Record<string, number>>) => ({ tab: 0, focus: 0, fullscreen: 0, keys: 0, face: 0, clipboard: 0, devtools: 0, ...o });
const base = (i: number, name: string, status: string, score: number, extra: object) => ({
  invite_token: `tok-${i}`, hr_username: "karnex-crm", candidate_name: name, candidate_email: `${name.toLowerCase().replace(/ /g, ".")}@example.com`,
  scheduled_at: day(i), session_status: status, login_attempts: 1, verified_at: day(i), interview_started_at: day(i), interview_completed_at: day(i),
  strikes: 0, event_count: 0, by_family: fam({}), by_type: {}, integrity_score: score, needs_review: score <= 70, active_device_id: "9f1c3a7b2d4e6f80a1b2",
  template_name: "Embedded C", recording_status: "ready", has_recording: true, recording_bytes: 21_000_000, shared_with: [],
  profile_id: 100 + i, requirement_title: "Senior non-AUTOSAR engineer", customer_name: "Harman", scheduled_by_name: "Gargee",
  ai_score: 71, ai_result: "Passed", report_link: status === "completed" || status === "terminated" ? `/admin/?view=candidateReport&cid=x&iid=rec-${i}` : null,
  ...extra,
});
const rows = [
  base(1, "Gautami Satish", "completed", 94, { strikes: 1, event_count: 3, by_family: fam({ tab: 2, focus: 1 }) }),
  base(2, "Rohan Mehta", "terminated", 20, { strikes: 3, event_count: 7, by_family: fam({ tab: 3, fullscreen: 2, face: 2 }), reason: "3 strikes: tab switch", shared_with: ["Priya K"] }),
  base(3, "Priya K", "active", 100, { recording_status: "recording", has_recording: false, interview_completed_at: "" }),
  base(4, "Arjun Rao", "pending", 100, { recording_status: "", has_recording: false, interview_started_at: "", interview_completed_at: "", verified_at: "" }),
];
const summary = { total: 4, active: 1, pending: 1, completed: 1, terminated: 1, needs_review: 2, violations: 10, avg_score: 71, shared_devices: 2 };
const events = [
  { type: "visibility_hidden", label: "Tab hidden", details: "Candidate switched away for 6 s", timestamp: new Date().toISOString(), question: "2", ip: "", user_agent: "", is_strike: true },
  { type: "window_blur", label: "Focus lost", details: "Window lost focus", timestamp: new Date().toISOString(), question: "3", ip: "", user_agent: "", is_strike: true },
  { type: "no_face", label: "No face", details: "3 empty scans", timestamp: new Date().toISOString(), question: "", ip: "", user_agent: "", is_strike: false },
];
const realFetch = window.fetch.bind(window);
(window as any).fetch = async (url: string, init?: RequestInit) => {
  const u = String(url);
  if (u.endsWith(".webm")) return realFetch(u, init);
  let body: any = {};
  if (/integrity-logs\/tok-/.test(u)) body = { violations_log: events, recording: { available: true, backend: "local", url: "./cam.webm", size_bytes: 1_200_000, screen: { available: true, url: "./screen.webm", size_bytes: 400_000 } } };
  else if (u.includes("/integrity-logs")) body = { logs: rows, summary };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
try { localStorage.setItem("authToken", "x"); localStorage.setItem("authTokenExpiryIst", "2099-01-01T00:00:00+05:30"); } catch { /* ignore */ }
createRoot(document.getElementById("root")!).render(<ThemeProvider><IntegrityLogsPage /></ThemeProvider>);
