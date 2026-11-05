// Karnex Careers — pure helpers (no DOM). Tested by
// scripts/tests/careers_logic.test.mjs (`node --test scripts/tests/`).

/** "1 opening" / "3 openings". */
export function openingsText(n) {
  const v = Number(n) || 0;
  return v === 1 ? "1 opening" : `${v} openings`;
}

/** "Posted today" / "Posted yesterday" / "Posted 4 days ago" / "Posted 3 weeks ago". */
export function postedText(iso, now = new Date()) {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.max(0, Math.round((today - d) / 86_400_000));
  if (days === 0) return "Posted today";
  if (days === 1) return "Posted yesterday";
  if (days < 14) return `Posted ${days} days ago`;
  if (days < 60) return `Posted ${Math.round(days / 7)} weeks ago`;
  return `Posted ${Math.round(days / 30)} months ago`;
}

/** Positions in the chosen city (blank = all). */
export function inLocation(positions, city) {
  if (!city) return positions.slice();
  const want = String(city).toLowerCase();
  // A position may be open in several cities (`cities`); older payloads carry `city` only.
  return positions.filter((p) => (Array.isArray(p.cities) && p.cities.length ? p.cities : [p.city])
    .some((c) => String(c || "").toLowerCase() === want));
}

/** Keyword search over title · code · location · skills · JD summary. */
export function matchesQuery(p, q) {
  const t = String(q || "").trim().toLowerCase();
  if (!t) return true;
  const hay = [p.title, p.code, p.location, p.work_mode, p.summary,
    ...(p.skills || []).map((s) => s.name)].join(" ").toLowerCase();
  return t.split(/\s+/).every((w) => hay.includes(w));
}

export function filterPositions(positions, { city = "", q = "" } = {}) {
  return inLocation(positions, city).filter((p) => matchesQuery(p, q));
}

/** The skills asked most across the open positions (the "Popular:" chips). */
export function popularSkills(positions, limit = 5) {
  const count = new Map();
  for (const p of positions) {
    for (const s of p.skills || []) {
      const key = s.name;
      count.set(key, (count.get(key) || 0) + (s.must ? 2 : 1));
    }
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

/** The RMG JD as blocks to draw: headings, paragraphs and bullet lists.
 *  A line ending in ":" (short) is a heading; "-", "*", "•", "1." / "1)" start a bullet. */
export function jdBlocks(text) {
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { blocks.push({ type: "p", text: para.join(" ") }); para = []; } };
  const flushList = () => { if (list) { blocks.push({ type: "ul", items: list }); list = null; } };
  for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    const bullet = line.match(/^(?:[-*•▪◦]|\d{1,2}[.)])\s+(.*)$/);
    if (bullet) { flushPara(); (list ||= []).push(bullet[1]); continue; }
    if (line.length <= 60 && /:$/.test(line)) {
      flushPara(); flushList(); blocks.push({ type: "h", text: line.replace(/:$/, "") }); continue;
    }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return blocks;
}

/** What the apply form must have before it is sent (mirror of the server). */
// "Serving notice" asks for the last working day — the server's rule
// (services/careers.lwd_problem): at most 30 days ago, at most 180 days ahead.
export function isServingNotice(notice) {
  return /serving/i.test(String(notice || ""));
}

export function lwdProblem(raw, today = new Date()) {
  const text = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "your last working day";
  const [y, m, d] = text.split("-").map(Number);
  const day = Date.UTC(y, m - 1, d);
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((day - base) / 86400000);
  if (diff < -30) return "a last working day no more than 30 days ago";
  if (diff > 180) return "a last working day within the next 6 months";
  return null;
}

export function applyProblems(f, { general = false } = {}) {
  const out = [];
  if (String(f.candidate_name || "").trim().length < 2) out.push("your full name");
  if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(String(f.email || "").trim())) out.push("a valid email");
  if (!/^[+()\-\s\d]{7,20}$/.test(String(f.phone || "").trim())) out.push("a valid mobile number");
  if (!general) {
    if (String(f.experience ?? "").trim() === "") out.push("your experience");
    if (!String(f.notice_period || "").trim()) out.push("your notice period");
    else if (isServingNotice(f.notice_period)) {
      const lwd = lwdProblem(f.last_working_day, f.today);
      if (lwd) out.push(lwd);
    }
    if (!String(f.current_location || "").trim()) out.push("your current location");
  }
  if (!f.file) out.push("your resume");
  else {
    if (!/\.(pdf|docx?|rtf|odt)$/i.test(f.file.name || "")) out.push("a PDF or Word resume");
    if ((f.file.size || 0) > 10 * 1024 * 1024) out.push("a resume under 10 MB");
  }
  if (!f.consent) out.push("your consent to be contacted");
  return out;
}

/** `?src=` kept from the link RMG posted (linkedin, naukri, …), letters only. */
export function cleanSource(raw) {
  return String(raw || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 20);
}

/** The link to one position (shared from the page), keeping the source. */
export function positionLink(origin, id, src) {
  const u = new URL("/careers", origin);
  u.searchParams.set("job", String(id));
  if (src) u.searchParams.set("src", src);
  return u.toString();
}
