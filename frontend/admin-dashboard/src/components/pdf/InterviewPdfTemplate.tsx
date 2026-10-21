/** The AI interview report as a PDF (redesigned 21 Oct 2026).
 *
 *  Every top-level child carries `data-pdf-block`: the exporter captures each
 *  block on its own and packs them onto A4 pages, so a section or a question is
 *  never cut in half and no canvas is ever too tall to draw (the "black PDF").
 *  Page header / footer / "Page N of M" are drawn by the exporter.
 *
 *  Inline styles and literal colours only — the capture must look the same in
 *  the light and the dark theme. */
import type { CSSProperties, ReactNode } from "react";
import { fmtDateLabelPdf } from "./dateFmt";
import { InterviewPdfQuestionBlock } from "./InterviewPdfQuestionBlock";
import { PdfScoreBar } from "./PdfScoreBar";
import type { InterviewPdfData } from "../../utils/pdf/buildInterviewPdfData";

const W = 794;
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

const base: CSSProperties = {
  width: W,
  boxSizing: "border-box",
  background: "#ffffff",
  color: INK,
  fontFamily: FONT,
  fontSize: 13,
  lineHeight: 1.55,
};

function scoreColor(v: number): string {
  if (v >= 75) return "#059669";
  if (v >= 55) return "#2563eb";
  if (v >= 40) return "#d97706";
  return "#dc2626";
}

function verdictLook(label: string): { bg: string; fg: string } {
  const l = label.toLowerCase();
  if (l.includes("strong")) return { bg: "#d1fae5", fg: "#065f46" };
  if (l === "hire") return { bg: "#dcfce7", fg: "#166534" };
  if (l.includes("borderline") || l.includes("further")) return { bg: "#fef3c7", fg: "#92400e" };
  return { bg: "#fee2e2", fg: "#991b1b" };
}

const STATUS_LOOK: Record<string, { bg: string; fg: string; word: string }> = {
  shown: { bg: "#d1fae5", fg: "#065f46", word: "Shown" },
  mixed: { bg: "#fef3c7", fg: "#92400e", word: "Mixed" },
  thin: { bg: "#e0f2fe", fg: "#075985", word: "One answer" },
  weak: { bg: "#fee2e2", fg: "#991b1b", word: "Weak" },
  not_tested: { bg: "#f1f5f9", fg: "#475569", word: "Not tested" },
};

function Block({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div data-pdf-block="1" style={{ ...base, padding: "0 0 4px", ...style }}>
      {children}
    </div>
  );
}

function SectionCard({ title, accent = "#4f46e5", children, tint }: {
  title: string; accent?: string; children: ReactNode; tint?: string;
}) {
  return (
    <Block>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, overflow: "hidden", background: tint || "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: `1px solid ${LINE}`, background: "#f8fafc" }}>
          <span style={{ width: 4, height: 18, borderRadius: 4, background: accent, display: "inline-block" }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#334155" }}>{title}</span>
        </div>
        <div style={{ padding: "14px 18px 16px" }}>{children}</div>
      </div>
    </Block>
  );
}

function Bullets({ items, color, mark }: { items: string[]; color: string; mark: string }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {items.map((line, i) => (
        <li key={i} style={{ display: "flex", gap: 8, marginBottom: 7, fontSize: 12, lineHeight: 1.5, color: "#1e293b" }}>
          <span style={{ color, fontWeight: 900, flexShrink: 0 }}>{mark}</span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

export function InterviewPdfTemplate({ data }: { data: InterviewPdfData }) {
  const generated = fmtDateLabelPdf(new Date().toISOString());
  const verdict = verdictLook(data.finalRecommendationLabel);
  const ring = scoreColor(data.overallScore);
  const scores: [string, number][] = [
    ["Technical", data.technicalScore],
    ["Problem solving", data.problemSolvingScore],
    ["Communication", data.communicationScore],
    ["Confidence", data.confidenceScore],
  ];

  return (
    <div style={{ ...base, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Cover */}
      <Block>
        <div style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${LINE}` }}>
          <div style={{ background: "linear-gradient(120deg, #1e3a8a 0%, #2563eb 60%, #4f46e5 100%)", color: "#fff", padding: "22px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", opacity: 0.85 }}>KARNEX ORBIT · AI INTERVIEW REPORT</div>
                <div style={{ fontSize: 26, fontWeight: 900, marginTop: 10, letterSpacing: "-0.01em" }}>{data.candidateName}</div>
                <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>{data.candidateEmail}</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 10 }}>{data.role || "—"}</div>
              </div>
              <div style={{ textAlign: "center", flexShrink: 0 }}>
                <div style={{ width: 104, height: 104, borderRadius: "50%", background: "#fff", border: `8px solid ${ring}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: INK }}>
                  <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1 }}>{data.overallScore}%</div>
                  <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, marginTop: 4, letterSpacing: "0.1em" }}>OVERALL</div>
                </div>
                <div style={{ marginTop: 10, display: "inline-block", padding: "4px 12px", borderRadius: 999, background: verdict.bg, color: verdict.fg, fontSize: 12, fontWeight: 800 }}>
                  {data.finalRecommendationLabel}
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderTop: `1px solid ${LINE}`, background: "#fff" }}>
            {[["Customer", data.customerName || "—"], ["Opportunity", data.opportunityId || "—"], ["Interview date", data.interviewDate], ["Hiring status", data.hiringStatus]].map(([k, v], i) => (
              <div key={k} style={{ padding: "12px 16px", borderLeft: i ? `1px solid ${LINE}` : "none" }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.12em", textTransform: "uppercase" }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4, wordBreak: "break-word" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, padding: "14px 16px 16px", background: "#f8fafc", borderTop: `1px solid ${LINE}` }}>
            {scores.map(([label, val]) => (
              <div key={label} style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: "0.06em" }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 900, margin: "4px 0 6px", color: scoreColor(Number(val)) }}>{val}%</div>
                <PdfScoreBar value={Number(val)} tone={Number(val) >= 75 ? "emerald" : Number(val) >= 40 ? "indigo" : "rose"} />
              </div>
            ))}
          </div>
        </div>
      </Block>

      {/* Verdict */}
      <SectionCard title="The AI's verdict" accent={verdict.fg}>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#1e293b", lineHeight: 1.65 }}>{data.overallFeedback}</div>
        <div style={{ marginTop: 10, fontSize: 11, color: MUTED }}>
          Model recommendation: <strong style={{ color: INK }}>{data.modelRecommendation}</strong>
          {data.managerDashboard ? <> · Confidence: <strong style={{ color: INK }}>{data.managerDashboard.snapshot.confidenceLevel}</strong></> : null}
        </div>
      </SectionCard>

      {/* Position skill check */}
      {data.positionSkills.length ? (
        <SectionCard title="Position skill check — what the answers showed" accent="#0d9488">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: MUTED, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                <th style={{ padding: "6px 8px", borderBottom: `1px solid ${LINE}` }}>Skill</th>
                <th style={{ padding: "6px 8px", borderBottom: `1px solid ${LINE}` }}>Result</th>
                <th style={{ padding: "6px 8px", borderBottom: `1px solid ${LINE}`, width: 170 }}>Average of its answers</th>
                <th style={{ padding: "6px 8px", borderBottom: `1px solid ${LINE}` }}>Questions</th>
              </tr>
            </thead>
            <tbody>
              {data.positionSkills.map((s) => {
                const look = STATUS_LOOK[s.status] || STATUS_LOOK.mixed;
                return (
                  <tr key={s.skill}>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${LINE}`, fontWeight: 700 }}>
                      {s.skill}
                      {s.mandatory ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: "#b45309" }}>MUST-HAVE</span> : null}
                      {s.estimate_overstated ? <div style={{ fontSize: 10, color: "#b45309", fontWeight: 600 }}>AI score higher than the answers support</div> : null}
                    </td>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${LINE}` }}>
                      <span style={{ background: look.bg, color: look.fg, borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 800 }}>{look.word}</span>
                    </td>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${LINE}` }}>
                      {s.avg_score_percent != null ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 34, fontWeight: 800 }}>{Math.round(s.avg_score_percent)}%</span>
                          <div style={{ flex: 1 }}><PdfScoreBar value={s.avg_score_percent} tone={s.avg_score_percent >= 70 ? "emerald" : s.avg_score_percent >= 45 ? "amber" : "rose"} /></div>
                        </div>
                      ) : <span style={{ color: MUTED }}>—</span>}
                    </td>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${LINE}`, color: MUTED }}>
                      {s.questions?.length ? `Q${s.questions.join(", Q")}` : "Not asked"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.caveats.length ? (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", fontSize: 11, color: "#78350f" }}>
              {data.caveats.map((c, i) => <div key={i}>{c}</div>)}
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      {/* Strengths / improvement */}
      <Block>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ border: "1px solid #a7f3d0", background: "#f0fdf4", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#065f46", letterSpacing: "0.06em", marginBottom: 10 }}>STRENGTHS</div>
            <Bullets items={data.strengths} color="#059669" mark="✓" />
          </div>
          <div style={{ border: "1px solid #fecdd3", background: "#fff1f2", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#9f1239", letterSpacing: "0.06em", marginBottom: 10 }}>TO IMPROVE / PROBE</div>
            <Bullets items={data.improvementAreas} color="#e11d48" mark="!" />
          </div>
        </div>
      </Block>

      {/* AI skill estimates */}
      {data.skillBreakdown.length ? (
        <SectionCard title="AI skill scores (the model's estimate)" accent="#7c3aed">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
            {data.skillBreakdown.map((sb) => (
              <div key={sb.skill}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                  <span>{sb.skill}</span><span>{Math.round(sb.score)}%</span>
                </div>
                <PdfScoreBar value={sb.score} tone="violet" />
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {/* Questions — one block each */}
      <Block>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 2px" }}>
          <span style={{ width: 4, height: 18, borderRadius: 4, background: "#2563eb", display: "inline-block" }} />
          <span style={{ fontSize: 14, fontWeight: 900, color: INK }}>Question by question</span>
          <span style={{ fontSize: 11, color: MUTED }}>{data.turns.length} answered turn{data.turns.length === 1 ? "" : "s"}</span>
        </div>
      </Block>
      {data.turns.length ? data.turns.map((t) => (
        <Block key={t.idx}>
          <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: "14px 18px 4px", background: "#fff" }}>
            <InterviewPdfQuestionBlock turn={t} bare />
          </div>
        </Block>
      )) : (
        <Block><div style={{ color: MUTED, fontSize: 12 }}>No question / answer payload for this interview.</div></Block>
      )}

      {/* L2 questions or next-round guidance */}
      {data.l2Questions.length ? (
        <SectionCard title={`Questions for the L2 round (${data.l2Questions.length})`} accent="#4f46e5" tint="#fbfaff">
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
            {data.l2Questions.map((q) => (
              <li key={q.number} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#4f46e5", color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{q.number}</span>
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: INK }}>
                    {q.skill ? <span style={{ color: "#4338ca" }}>[{q.skill}] </span> : null}{q.question}
                  </div>
                  {q.listen_for ? <div style={{ color: "#047857", marginTop: 2 }}>Listen for: {q.listen_for}</div> : null}
                </div>
              </li>
            ))}
          </ol>
        </SectionCard>
      ) : (
        <SectionCard title="Next interview guidance" accent="#d97706">
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#334155" }}>
            {data.nextInterviewFocusAreas.slice(0, 10).map((area, i) => (
              <li key={i} style={{ marginBottom: 6 }}>{area}</li>
            ))}
          </ol>
        </SectionCard>
      )}

      {/* Final recommendation */}
      <SectionCard title="Final recommendation" accent={verdict.fg} tint="#f8fafc">
        <div style={{ display: "inline-block", padding: "4px 14px", borderRadius: 999, background: verdict.bg, color: verdict.fg, fontSize: 15, fontWeight: 900 }}>
          {data.finalRecommendationLabel}
        </div>
        <div style={{ marginTop: 12, whiteSpace: "pre-wrap", color: "#334155", fontSize: 12, lineHeight: 1.65 }}>
          {data.finalRecommendationReasoning}
        </div>
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${LINE}`, fontSize: 10, color: "#94a3b8", display: "flex", justifyContent: "space-between" }}>
          <span>Interview ID: {data.interviewId}</span>
          <span>Generated {generated} · AI assessment — confirm in a human round</span>
        </div>
      </SectionCard>
    </div>
  );
}
