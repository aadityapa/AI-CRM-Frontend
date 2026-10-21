import type { CSSProperties } from "react";
import type { EnrichedTurn } from "../../utils/reportExtract";
import { turnHasProfessionalAssessment } from "../../utils/reportExtract";
import { PdfScoreBar } from "./PdfScoreBar";

const label: CSSProperties = {
  fontSize: 9,
  fontWeight: 900,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "#94a3b8",
  marginTop: 12,
  marginBottom: 4,
};

const box: CSSProperties = {
  borderRadius: 8,
  padding: 12,
  marginTop: 8,
  border: "1px solid #e2e8f0",
};

export function InterviewPdfQuestionBlock({ turn, bare = false }: { turn: EnrichedTurn; bare?: boolean }) {
  const professional = turnHasProfessionalAssessment(turn);
  const rating =
    turn.overallRating != null
      ? turn.overallRating
      : turn.score != null
        ? Math.round((turn.score / 10) * 10) / 10
        : null;
  const modelAnswer = turn.expectedAnswer || turn.idealAnswer;

  return (
    <div
      style={bare ? { paddingBottom: 12 } : {
        borderBottom: "1px solid #e2e8f0",
        paddingBottom: 18,
        marginBottom: 18,
        pageBreakInside: "avoid",
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 900, color: "#6366f1", letterSpacing: "0.14em" }}>
        QUESTION {turn.idx}
        {turn.excludedFromScore ? " · EXCLUDED FROM SCORE" : ""}
      </div>
      <div style={{ fontWeight: 800, fontSize: 14, marginTop: 6, color: "#0f172a", lineHeight: 1.45 }}>
        {turn.question || "—"}
      </div>

      <div style={label}>Candidate answer</div>
      <div style={{ whiteSpace: "pre-wrap", color: "#334155", fontSize: 12, lineHeight: 1.55 }}>
        {turn.answer.trim() ? turn.answer : "No answer provided"}
      </div>

      {turn.score != null ? (
        <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, color: "#4f46e5" }}>
          Question score: {turn.score}%
        </div>
      ) : null}

      {turn.dimensionScores ? (
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            ["Technical accuracy", turn.dimensionScores.technicalAccuracy],
            ["Concept coverage", turn.dimensionScores.conceptCoverage],
            ["Depth of explanation", turn.dimensionScores.depth],
            ["Communication quality", turn.dimensionScores.communication],
            ["Confidence level", turn.dimensionScores.confidence],
          ].map(([name, val]) => (
            <div key={String(name)}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 700 }}>
                <span>{name}</span>
                <span>{val}%</span>
              </div>
              <PdfScoreBar value={Number(val)} tone="indigo" />
            </div>
          ))}
        </div>
      ) : null}

      {professional ? (
        <>
          <div style={{ ...box, background: "#f8fafc", marginTop: 14 }}>
            <div style={{ ...label, marginTop: 0 }}>Evaluation summary</div>
            {rating != null ? (
              <div style={{ fontSize: 12, fontWeight: 800, color: "#4338ca" }}>Overall rating: {rating}/10</div>
            ) : null}
            <div style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "#334155", fontSize: 12 }}>
              {turn.evaluationSummary || turn.feedback || "—"}
            </div>
          </div>

          <div style={{ ...box, background: "#ecfdf5", borderColor: "#a7f3d0" }}>
            <div style={{ ...label, marginTop: 0, color: "#047857" }}>What candidate explained correctly</div>
            {turn.correctConcepts.length ? (
              <ol style={{ margin: "6px 0 0 18px", padding: 0, color: "#064e3b", fontSize: 12 }}>
                {turn.correctConcepts.map((item, i) => (
                  <li key={i} style={{ marginBottom: 8 }}>
                    <strong>✓ {item.topic}</strong>
                    <div style={{ marginTop: 2 }}>{item.explanation}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <div style={{ fontSize: 12, color: "#047857" }}>No significant technical strengths identified.</div>
            )}
          </div>

          <div style={{ ...box, background: "#fff1f2", borderColor: "#fecdd3" }}>
            <div style={{ ...label, marginTop: 0, color: "#be123c" }}>Areas for improvement</div>
            {turn.improvementAreas.length ? (
              <ol style={{ margin: "6px 0 0 18px", padding: 0, color: "#9f1239", fontSize: 12 }}>
                {turn.improvementAreas.map((item, i) => (
                  <li key={i} style={{ marginBottom: 8 }}>
                    <strong>✗ {item.topic}</strong>
                    <div style={{ marginTop: 2 }}>{item.explanation}</div>
                    {item.correction ? (
                      <div style={{ marginTop: 4, fontSize: 11 }}>
                        <strong>Correction:</strong> {item.correction}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : turn.weaknesses.length ? (
              <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 12 }}>
                {turn.weaknesses.map((w, i) => (
                  <li key={i}>✗ {w}</li>
                ))}
              </ul>
            ) : (
              <div style={{ fontSize: 12, color: "#be123c" }}>—</div>
            )}
          </div>

          {modelAnswer ? (
            <div style={{ ...box, background: "#eef2ff", borderColor: "#c7d2fe" }}>
              <div style={{ ...label, marginTop: 0, color: "#4338ca" }}>Expected interview answer (9–10/10)</div>
              <div style={{ whiteSpace: "pre-wrap", color: "#312e81", fontSize: 12, lineHeight: 1.55 }}>{modelAnswer}</div>
            </div>
          ) : null}

          {turn.interviewFeedback ? (
            <div style={{ ...box, background: "#fff" }}>
              <div style={{ ...label, marginTop: 0 }}>Interview feedback</div>
              <div style={{ whiteSpace: "pre-wrap", color: "#334155", fontSize: 12, lineHeight: 1.6 }}>
                {turn.interviewFeedback}
              </div>
            </div>
          ) : null}

          {turn.followUpQuestions.length ? (
            <div style={{ ...box, background: "#fffbeb", borderColor: "#fde68a" }}>
              <div style={{ ...label, marginTop: 0, color: "#b45309" }}>Manager follow-up questions</div>
              <ol style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 12, color: "#78350f" }}>
                {turn.followUpQuestions.map((q, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {q}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {turn.feedback ? (
            <div style={{ marginTop: 10 }}>
              <div style={label}>AI evaluation</div>
              <div style={{ whiteSpace: "pre-wrap", color: "#334155", fontSize: 12 }}>{turn.feedback}</div>
            </div>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
            <div style={{ ...box, background: "#ecfdf5", borderColor: "#a7f3d0" }}>
              <div style={{ fontSize: 9, fontWeight: 900, color: "#047857" }}>STRENGTHS</div>
              <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: 11, color: "#064e3b" }}>
                {(turn.strengths.length ? turn.strengths : ["—"]).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div style={{ ...box, background: "#fff1f2", borderColor: "#fecdd3" }}>
              <div style={{ fontSize: 9, fontWeight: 900, color: "#be123c" }}>WEAKNESSES</div>
              <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: 11, color: "#9f1239" }}>
                {(turn.weaknesses.length ? turn.weaknesses : ["—"]).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
          {modelAnswer ? (
            <div style={{ ...box, background: "#eef2ff", borderColor: "#c7d2fe", marginTop: 10 }}>
              <div style={{ fontSize: 9, fontWeight: 900, color: "#4338ca" }}>EXPECTED ANSWER</div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#312e81", marginTop: 4 }}>{modelAnswer}</div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
