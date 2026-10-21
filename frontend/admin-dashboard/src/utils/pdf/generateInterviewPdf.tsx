import { createRoot } from "react-dom/client";
import { getCandidateInterviewDetail, getCandidateStrengthsWeaknesses } from "../../api";
import { InterviewPdfTemplate } from "../../components/pdf/InterviewPdfTemplate";
import type { CandidateInterviewHistory, CandidateInterviewSummary, InterviewRecord } from "../../types";
import type { StrengthsWeaknessesAnalysis } from "../../types/strengthsWeaknesses";
import { SW_POSITION_VERSION } from "../../types/strengthsWeaknesses";
import { buildInterviewPdfData } from "./buildInterviewPdfData";
import { exportElementToPdf } from "./exportElementToPdf";
import { interviewReportFilename } from "./filename";

function mountHost(): { host: HTMLDivElement; inner: HTMLDivElement } {
  const host = document.createElement("div");
  host.setAttribute("data-pdf-export-host", "true");
  host.style.position = "fixed";
  host.style.left = "-14000px";
  host.style.top = "0";
  host.style.zIndex = "-1";
  host.style.pointerEvents = "none";
  const inner = document.createElement("div");
  host.appendChild(inner);
  document.body.appendChild(host);
  return { host, inner };
}

async function flushRender(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function hiringStatusFromCandidate(
  candidate: CandidateInterviewHistory["candidate"],
  interview: CandidateInterviewSummary,
): string {
  if (candidate.hr_decision === "reject") return "Rejected";
  if (candidate.hr_decision === "shortlist") return "Selected";
  if (candidate.hr_decision === "on_hold") return "On Hold";
  return String(interview.status || candidate.status || "Pending Review");
}

async function loadStrengthsWeaknesses(
  candidateId: string,
  interviewId: string,
  record: InterviewRecord | null,
): Promise<StrengthsWeaknessesAnalysis | null> {
  const report = record?.report as Record<string, unknown> | undefined;
  const embedded = report?.strengths_weaknesses_analysis as StrengthsWeaknessesAnalysis | undefined;
  if (embedded?.complete && embedded.questions?.length && Number(embedded.version || 0) >= SW_POSITION_VERSION) return embedded;
  try {
    const res = await getCandidateStrengthsWeaknesses(candidateId, interviewId);
    return (res?.analysis as StrengthsWeaknessesAnalysis) || null;
  } catch {
    return null;
  }
}

export async function generateInterviewPdf(
  candidateId: string,
  ctx: {
    candidate: CandidateInterviewHistory["candidate"];
    interview: CandidateInterviewSummary;
  },
): Promise<void> {
  const { host, inner } = mountHost();
  const root = createRoot(inner);
  try {
    let record: InterviewRecord | null = null;
    try {
      record = await getCandidateInterviewDetail(candidateId, ctx.interview.id);
    } catch {
      record = null;
    }

    const swAnalysis = await loadStrengthsWeaknesses(candidateId, ctx.interview.id, record);
    const candidateRole =
      (ctx.interview.job_title || "").trim() || ctx.candidate.role || "";
    const pdfData = buildInterviewPdfData(
      ctx.candidate.name,
      ctx.candidate.email,
      candidateRole,
      hiringStatusFromCandidate(ctx.candidate, ctx.interview),
      ctx.interview,
      record,
      swAnalysis,
    );

    root.render(<InterviewPdfTemplate data={pdfData} />);
    await flushRender();
    const el = inner.firstElementChild as HTMLElement | null;
    if (!el) throw new Error("PDF template failed to render.");
    const when = pdfData.interviewDate;
    await exportElementToPdf(el, interviewReportFilename(ctx.candidate.name, when), {
      headerLeft: `Karnex Orbit - AI interview report - ${pdfData.candidateName}`.slice(0, 90),
      headerRight: pdfData.role ? pdfData.role.slice(0, 60) : "",
      footerLeft: `Confidential - ${pdfData.interviewDate}`,
    });
  } finally {
    root.unmount();
    document.body.removeChild(host);
  }
}
