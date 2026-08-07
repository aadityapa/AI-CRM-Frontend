import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Copy,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Database,
  Info,
  RotateCcw,
  Save,
  X,
  Zap,
} from "lucide-react";
import { apiGet, authFetch } from "../api/client";
import { previewQuestionBankFromTemplate } from "../api/questionBank";
import { CreatableMasterCombobox } from "../components/CreatableMasterCombobox";
import { INTELLIGENCE_SUITE_CATEGORIES } from "../constants/intelligenceSuiteCategories";
import { MAX_COUNT_MODE_QUESTIONS, clampCountModeQuestions } from "../constants/interviewLimits";

type QuestionType = "dynamic" | "manual" | "question_bank";

type QuestionBankMatch = {
  id?: string;
  role?: string;
  skill?: string;
  difficulty?: string;
  category?: string;
  question?: string;
};

const QB_CATEGORIES = [
  { value: "technical", label: "Technical" },
  { value: "behavioral", label: "Behavioral" },
  { value: "situational", label: "Situational" },
  { value: "general", label: "General" },
] as const;

const QB_DIFFICULTIES = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
] as const;

type QbCategoryValue = (typeof QB_CATEGORIES)[number]["value"];
type QbDifficultyValue = (typeof QB_DIFFICULTIES)[number]["value"];

type JobConfig = {
  jobId: string;
  jobTitle: string;
  domain?: string;
  opportunityId?: string;
  customerName?: string;
  requiredSkills?: string[];
  optionalSkills?: string[];
  expMin?: number;
  expMax?: number;
  difficulty?: string;
  numQ?: number;
  interviewMode?: string;
  timingMode?: "count" | "time";
  timeLimitSec?: number;
  micAlwaysOn?: boolean;
  showSpokenText?: boolean;
  enableTranscriptInput?: boolean;
  jdText?: string;
  templateInstructions?: string;
  weights?: Record<string, unknown>;
  questionType?: string;
  manualQuestions?: string[];
  generatedPrompt?: string;
  editedPrompt?: string;
  promptVersion?: number;
  promptUpdatedBy?: string;
  promptUpdatedAt?: string;
  promptHistory?: Array<Record<string, unknown>>;
  effectivePrompt?: string;
  promptPreview?: string;
  promptCharCount?: number;
};

function toCsv(list: string[] | undefined) {
  return (list || []).join(", ");
}

function clampInt(raw: any, min: number, max: number) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function toBoolean(raw: unknown, fallback = false) {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
  return Boolean(raw);
}

/** Align with backend: trim, drop empties, case-insensitive dedupe, max 120 lines. */
function normalizeManualQuestionLines(raw: string): string[] {
  const lines = String(raw || "").split(/\r?\n/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ln of lines) {
    const line = ln.trim();
    if (!line) continue;
    const low = line.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(line);
    if (out.length >= 120) break;
  }
  return out;
}

function readExpRange(j: JobConfig): { min: number; max: number } {
  const w = (j.weights || {}) as Record<string, unknown>;
  const rawMin = (j as any).expMin ?? (j as any).exp_min ?? w["expMin"] ?? w["exp_min"];
  const rawMax = (j as any).expMax ?? (j as any).exp_max ?? w["expMax"] ?? w["exp_max"];
  return { min: clampInt(rawMin ?? 0, 0, 40), max: clampInt(rawMax ?? 0, 0, 40) };
}

/* Section header in the shared "New Opportunity wizard" banner language, using
 * this page's own tokens: a gradient icon tile (fx-glow) + title + description.
 * Structure mirrors the CRM SectionHeaderBanner; visual-only, no logic. */
function SectionBanner({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <header className="relative mb-2 overflow-hidden rounded-card border border-subtle bg-surface-1 px-4 py-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-500/15 via-transparent to-violet-500/10" />
      <div aria-hidden className="pointer-events-none absolute -right-8 -top-12 h-40 w-40 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="relative z-[1] flex items-start gap-3">
        <span className="fx-glow flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-gradient-to-br from-brand-600 to-violet-600 text-white">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-primary">{title}</h3>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
      </div>
    </header>
  );
}

export function TemplateFormPage({
  jobId,
  onDone,
  onOpenHrSetup,
}: {
  jobId: string | null;
  onDone: () => void;
  onOpenHrSetup: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qbToast, setQbToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<JobConfig[]>([]);
  const [editingJob, setEditingJob] = useState<JobConfig | null>(null);

  const editing = useMemo(
    () => editingJob || jobs.find((j) => j.jobId === jobId) || null,
    [editingJob, jobs, jobId],
  );

  const [jobTitle, setJobTitle] = useState("");
  const [domain, setDomain] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [requiredSkills, setRequiredSkills] = useState("");
  const [optionalSkills, setOptionalSkills] = useState("");
  const [expMin, setExpMin] = useState(0);
  const [expMax, setExpMax] = useState(0);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [numQ, setNumQ] = useState(5);
  const [interviewMode, setInterviewMode] = useState<"technical" | "hr">("technical");
  const [timingMode, setTimingMode] = useState<"" | "count" | "time">("");
  const [timeLimitMin, setTimeLimitMin] = useState(20);
  const [enableTimeWarnings, setEnableTimeWarnings] = useState(true);
  const [warn5Min, setWarn5Min] = useState(5);
  const [warn2Min, setWarn2Min] = useState(2);
  const [warn1Min, setWarn1Min] = useState(1);
  const [warn30Sec, setWarn30Sec] = useState(30);
  const [micAlwaysOn, setMicAlwaysOn] = useState(false);
  const [showSpokenText, setShowSpokenText] = useState(false);
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(true);
  const [initialResponseWaitSec, setInitialResponseWaitSec] = useState(5);
  const [noResponseExtraWaitSec, setNoResponseExtraWaitSec] = useState(2.5);
  const [silenceDetectionSec, setSilenceDetectionSec] = useState(2.5);
  const [autoSkipEnabled, setAutoSkipEnabled] = useState(true);
  const [voiceCommandsEnabled, setVoiceCommandsEnabled] = useState(true);
  const [confirmationBeforeNextSec, setConfirmationBeforeNextSec] = useState(2.5);
  const [minimumAnswerWords, setMinimumAnswerWords] = useState(5);
  const [minimumSpeechDurationSec, setMinimumSpeechDurationSec] = useState(2);
  const [speechEnergyThreshold, setSpeechEnergyThreshold] = useState(0.038);
  const [speechConfirmMs, setSpeechConfirmMs] = useState(400);
  const [jdText, setJdText] = useState("");
  const [templateInstructions, setTemplateInstructions] = useState("");
  const [questionType, setQuestionType] = useState<QuestionType>("dynamic");
  const [manualQuestionsText, setManualQuestionsText] = useState("");
  /**
   * Manual question order. Defaults to "random" because that is what the
   * platform has always done — an existing template with no stored setting must
   * keep behaving the way its author saw it behave.
   */
  const [manualQuestionOrder, setManualQuestionOrder] = useState<"sequential" | "random">("random");
  /**
   * Whether this role is assessed on spoken communication at all. Defaults ON
   * for the same reason: templates saved before this existed were assessed.
   */
  const [communicationRequired, setCommunicationRequired] = useState(true);
  const [qbCategories, setQbCategories] = useState<QbCategoryValue[]>(["technical"]);
  const [qbDifficulties, setQbDifficulties] = useState<QbDifficultyValue[]>(["medium"]);
  const [qbExcludedQuestionIds, setQbExcludedQuestionIds] = useState<string[]>([]);
  const [qbRandomize, setQbRandomize] = useState(true);
  const [qbAvoidDuplicates, setQbAvoidDuplicates] = useState(true);
  const [qbPreviewBusy, setQbPreviewBusy] = useState(false);
  const [qbMatches, setQbMatches] = useState<QuestionBankMatch[]>([]);
  const [qbTotalMatched, setQbTotalMatched] = useState(0);
  const [qbPoolTotal, setQbPoolTotal] = useState(0);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleQuestions, setSampleQuestions] = useState<string[]>([]);
  const [sampleDomains, setSampleDomains] = useState<string[]>([]);
  const [sampleAssignments, setSampleAssignments] = useState<string[]>([]);
  const [sampleSkillsUsed, setSampleSkillsUsed] = useState<string[]>([]);
  const [suiteTargetRole, setSuiteTargetRole] = useState("");
  const [suiteSeniority, setSuiteSeniority] = useState("");
  const [suiteTechStack, setSuiteTechStack] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [adaptiveNextQuestion, setAdaptiveNextQuestion] = useState(true);
  const [promptExpanded, setPromptExpanded] = useState(true);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [editedPrompt, setEditedPrompt] = useState("");
  const [promptPreview, setPromptPreview] = useState("");
  const [promptCharCount, setPromptCharCount] = useState(0);
  const [promptTokenEstimate, setPromptTokenEstimate] = useState(0);
  const [promptVersion, setPromptVersion] = useState(1);
  const [promptHistory, setPromptHistory] = useState<Array<Record<string, unknown>>>([]);
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptTestBusy, setPromptTestBusy] = useState(false);
  const [promptTestQuestions, setPromptTestQuestions] = useState<string[]>([]);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const manualQuestionCount = useMemo(
    () => normalizeManualQuestionLines(manualQuestionsText).length,
    [manualQuestionsText]
  );
  const manualQuestionLines = useMemo(
    () => normalizeManualQuestionLines(manualQuestionsText),
    [manualQuestionsText]
  );
  const assessmentDomainLabels = useMemo(
    () =>
      selectedCategoryIds.map(
        (id) => INTELLIGENCE_SUITE_CATEGORIES.find((c) => c.id === id)?.title || id,
      ),
    [selectedCategoryIds],
  );
  const createdDateLabel = useMemo(() => {
    const raw =
      String((editing as any)?.created_at_ist || (editing as any)?.createdAtIst || "").trim() ||
      String((editing as any)?.updated_at_ist || "").trim();
    if (!raw) return "—";
    const d = Date.parse(raw);
    if (!Number.isFinite(d)) return raw;
    return new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }, [editing]);
  const bankPreviewCount = useMemo(
    () => (questionType === "question_bank" ? sampleQuestions.length : 0),
    [questionType, sampleQuestions.length],
  );
  const countModeQuestionsToAsk = useMemo(() => {
    const n = clampCountModeQuestions(numQ, 5);
    if (questionType === "manual" && manualQuestionCount > 0) return Math.min(n, manualQuestionCount);
    if (questionType === "question_bank" && bankPreviewCount > 0) return Math.min(n, bankPreviewCount);
    return n;
  }, [numQ, questionType, manualQuestionCount, bankPreviewCount]);

  const interviewDurationLabel = useMemo(() => {
    if (timingMode === "time") return `${timeLimitMin} minutes (time limit)`;
    if (timingMode === "count") return `${countModeQuestionsToAsk} questions (fixed count)`;
    return "—";
  }, [timingMode, timeLimitMin, countModeQuestionsToAsk]);

  const prevHydratedJobIdRef = useRef<string | null | undefined>(undefined);
  // Tracks the jobId whose data has actually been loaded into the form. Save is
  // blocked when editing (jobId != null) unless this matches jobId — this is the
  // guard that stops an un-hydrated (empty) edit form from overwriting the DB.
  const hydratedJobIdRef = useRef<string | null>(null);
  const promptDraftTouchedRef = useRef(false);
  const lastAutoGeneratedPromptRef = useRef("");

  const steps = [
    { id: 1 as const, label: "Basics" },
    { id: 2 as const, label: "Skills & JD" },
    { id: 3 as const, label: "Review" },
  ];

  const refresh = async () => {
    const data = await apiGet<{ jobs: JobConfig[] }>("/job/configs", { force: true });
    setJobs(Array.isArray(data.jobs) ? data.jobs : []);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        await refresh();
        if (!alive) return;
      } catch (e: any) {
        if (!alive) return;
        setError(String(e?.message || e));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const prev = prevHydratedJobIdRef.current;

    if (jobId == null) {
      if (prev != null) {
        setEditingJob(null);
        setTimingMode("");
        setStep(1);
        setJobTitle("");
        setDomain("");
        let prefillOpp = "";
        try {
          prefillOpp = sessionStorage.getItem("crm_prefill_opportunityId") || "";
          if (prefillOpp) sessionStorage.removeItem("crm_prefill_opportunityId");
        } catch { /* ignore */ }
        setOpportunityId(prefillOpp);
        setCustomerName("");
        setRequiredSkills("");
        setOptionalSkills("");
        setExpMin(0);
        setExpMax(0);
        setDifficulty("medium");
        setNumQ(5);
        setInterviewMode("technical");
        setTimeLimitMin(20);
        setMicAlwaysOn(false);
        setShowSpokenText(false);
        setJdText("");
        setTemplateInstructions("");
        setQuestionType("dynamic");
        setManualQuestionsText("");
        setSelectedCategoryIds([]);
        setSuiteTargetRole("");
        setSuiteSeniority("");
        setSuiteTechStack("");
        setSampleQuestions([]);
        setSampleDomains([]);
        setSampleAssignments([]);
        setSampleSkillsUsed([]);
        setAdaptiveNextQuestion(true);
        setGeneratedPrompt("");
        setEditedPrompt("");
        setPromptPreview("");
        setPromptCharCount(0);
        setPromptTokenEstimate(0);
        setPromptVersion(1);
        setPromptHistory([]);
        setPromptTestQuestions([]);
        setAutoAdvanceEnabled(true);
        promptDraftTouchedRef.current = false;
        lastAutoGeneratedPromptRef.current = "";
      }
      prevHydratedJobIdRef.current = jobId;
      // New-template mode: the empty form is intentional and safe to save.
      hydratedJobIdRef.current = null;
      return;
    }

    // Editing an existing template: until this template's data is loaded into the
    // form, block saves so we can never overwrite good data with empty defaults.
    hydratedJobIdRef.current = null;

    let alive = true;
    (async () => {
      try {
        let j: JobConfig | null = null;
        try {
          const data = await apiGet<{ job: JobConfig }>(`/job/config/${encodeURIComponent(jobId)}`, { force: true });
          j = data?.job || null;
        } catch {
          j = null;
        }
        // Fallback: reuse the already-loaded list (it carries every field). This
        // keeps the form populated even if the single-template fetch fails.
        if (!j) {
          try {
            const list = await apiGet<{ jobs: JobConfig[] }>("/job/configs", { force: true });
            j = (Array.isArray(list?.jobs) ? list.jobs : []).find((x) => x.jobId === jobId) || null;
          } catch {
            j = null;
          }
        }
        if (!j) {
          j = jobs.find((x) => x.jobId === jobId) || null;
        }
        if (!alive) return;
        if (!j) {
          setError("Could not load this template. Refresh before editing to avoid overwriting saved data.");
          return;
        }
        setEditingJob(j);
        hydrateJobIntoForm(j);
        prevHydratedJobIdRef.current = jobId;
        hydratedJobIdRef.current = jobId; // form is now safe to save
      } catch (e: any) {
        if (!alive) return;
        setError(String(e?.message || e || "Failed to load template."));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  function hydrateJobIntoForm(j: JobConfig) {
    setJobTitle(j.jobTitle || "");
    setDomain(j.domain || "");
    setOpportunityId((j as any).opportunityId || (j as any).opportunity_id || "");
    setCustomerName((j as any).customerName || (j as any).customer_name || "");
    setRequiredSkills(toCsv(j.requiredSkills));
    setOptionalSkills(toCsv(j.optionalSkills));
    const exp = readExpRange(j);
    setExpMin(exp.min);
    setExpMax(exp.max);
    const d = String(j.difficulty || "medium").toLowerCase();
    setDifficulty(d === "easy" || d === "hard" ? (d as any) : "medium");
    const im = String(j.interviewMode || "technical").toLowerCase();
    setInterviewMode(im === "hr" || im === "standard" ? "hr" : "technical");
    const tm = String((j as any).timingMode || (j as any).timing_mode || "count").toLowerCase();
    setTimingMode(tm === "time" ? "time" : "count");
    const tls = Number((j as any).timeLimitSec || (j as any).time_limit_sec || 0);
    setTimeLimitMin(Math.max(1, Math.min(360, Math.round((Number.isFinite(tls) ? tls : 0) / 60) || 20)));
    setMicAlwaysOn(Boolean((j as any).micAlwaysOn ?? (j as any).mic_always_on ?? false));
    setShowSpokenText(
      toBoolean((j as any).enableTranscriptInput ?? (j as any).enable_transcript_input ?? (j as any).showSpokenText ?? (j as any).show_spoken_text, false),
    );
    setJdText(j.jdText || "");
    setTemplateInstructions(
      String((j as JobConfig).templateInstructions || (j as any).template_instructions || "").trim(),
    );

    const qt = String((j as any).questionType || (j as any).question_type || "dynamic").toLowerCase();
    setQuestionType(qt === "manual" ? "manual" : qt === "question_bank" ? "question_bank" : "dynamic");
    const mq = (j as any).manualQuestions ?? (j as any).manual_questions;
    if (Array.isArray(mq) && mq.length) {
      setManualQuestionsText(mq.map((x: unknown) => String(x)).filter(Boolean).join("\n"));
    } else {
      setManualQuestionsText("");
    }

    const w = (j.weights || {}) as Record<string, unknown>;
    const qbCfg = (w.questionBankConfig || {}) as Record<string, unknown>;
    const savedCats = Array.isArray(qbCfg.categories)
      ? qbCfg.categories.map((x) => String(x).toLowerCase())
      : qbCfg.category
        ? [String(qbCfg.category).toLowerCase()]
        : ["technical"];
    setQbCategories(
      savedCats.filter((c): c is QbCategoryValue => QB_CATEGORIES.some((x) => x.value === c)).length
        ? (savedCats.filter((c): c is QbCategoryValue => QB_CATEGORIES.some((x) => x.value === c)) as QbCategoryValue[])
        : ["technical"],
    );
    const savedDiffs = Array.isArray(qbCfg.difficulties)
      ? qbCfg.difficulties.map((x) => String(x).toLowerCase())
      : qbCfg.difficulty
        ? [String(qbCfg.difficulty).toLowerCase()]
        : [String(j.difficulty || "medium").toLowerCase()];
    setQbDifficulties(
      savedDiffs.filter((d): d is QbDifficultyValue => QB_DIFFICULTIES.some((x) => x.value === d)).length
        ? (savedDiffs.filter((d): d is QbDifficultyValue => QB_DIFFICULTIES.some((x) => x.value === d)) as QbDifficultyValue[])
        : ["medium"],
    );
    const savedExcluded = qbCfg.excludedQuestionIds;
    setQbExcludedQuestionIds(
      Array.isArray(savedExcluded) ? savedExcluded.map((x) => String(x)).filter(Boolean) : [],
    );
    setQbRandomize(toBoolean(qbCfg.randomizationEnabled, true));
    setQbAvoidDuplicates(toBoolean(qbCfg.avoidDuplicateQuestions, true));
    setQbMatches([]);
    setQbTotalMatched(0);
    const savedPoolTotal = Number((w as any).questionBankPoolTotal || 0);
    setQbPoolTotal(savedPoolTotal > 0 ? savedPoolTotal : 0);
    const qbQuestionCount = Number(qbCfg.questionCount || qbCfg.question_count || 0);
    if (qt === "question_bank" && qbQuestionCount > 0) {
      setNumQ(clampCountModeQuestions(qbQuestionCount, 5));
    } else {
      setNumQ(clampCountModeQuestions(j.numQ ?? 5, 5));
    }
    const qc = w.questionCategories;
    setSelectedCategoryIds(Array.isArray(qc) ? qc.map((x) => String(x)).filter(Boolean) : []);
    setSuiteTargetRole(typeof w.intelligenceTargetRole === "string" ? (w.intelligenceTargetRole as string) : "");
    setSuiteSeniority(typeof w.intelligenceSeniority === "string" ? (w.intelligenceSeniority as string) : "");
    setSuiteTechStack(typeof w.intelligenceTechStack === "string" ? (w.intelligenceTechStack as string) : "");
    setAdaptiveNextQuestion(toBoolean((w as any).adaptiveNextQuestion, false));
    // Both default to the platform's historic behaviour when the template
    // predates the setting: communication WAS assessed, order WAS shuffled.
    setCommunicationRequired(toBoolean((w as any).communicationRequired, true));
    setManualQuestionOrder(
      String((w as any).manualQuestionOrder || "").toLowerCase() === "sequential"
        ? "sequential"
        : "random",
    );
    setEnableTimeWarnings(
      w.enableTimeWarnings === undefined ? true : toBoolean(w.enableTimeWarnings, true),
    );
    const tw = (w.timeWarningSec || {}) as Record<string, unknown>;
    setWarn5Min(Math.max(1, Math.min(60, Math.round(Number(tw["5min"] ?? 300) / 60) || 5)));
    setWarn2Min(Math.max(1, Math.min(30, Math.round(Number(tw["2min"] ?? 120) / 60) || 2)));
    setWarn1Min(Math.max(1, Math.min(15, Math.round(Number(tw["1min"] ?? 60) / 60) || 1)));
    setWarn30Sec(Math.max(10, Math.min(120, Number(tw["30sec"] ?? 30) || 30)));
    setAutoAdvanceEnabled(toBoolean(w.autoAdvanceEnabled ?? w.auto_advance_enabled, true));
    setInitialResponseWaitSec(clampInt(w.initialResponseWaitSec ?? w.initial_response_wait_sec ?? 5, 2, 30));
    setNoResponseExtraWaitSec(
      Math.max(1, Math.min(15, Number(w.noResponseExtraWaitSec ?? w.no_response_extra_wait_sec ?? 2.5) || 2.5)),
    );
    setSilenceDetectionSec(
      Math.max(1, Math.min(15, Number(w.silenceDetectionSec ?? w.silence_detection_sec ?? 2.5) || 2.5)),
    );
    setAutoSkipEnabled(toBoolean(w.autoSkipEnabled ?? w.auto_skip_enabled, true));
    setVoiceCommandsEnabled(toBoolean(w.voiceCommandsEnabled ?? w.voice_commands_enabled, true));
    setConfirmationBeforeNextSec(
      Math.max(0, Math.min(10, Number(w.confirmationBeforeNextSec ?? w.confirmation_before_next_sec ?? 2.5) || 2.5)),
    );
    setMinimumAnswerWords(clampInt(w.minimumAnswerWords ?? w.minimum_answer_words ?? 5, 1, 30));
    setMinimumSpeechDurationSec(clampInt(w.minimumSpeechDurationSec ?? w.minimum_speech_duration_sec ?? 2, 1, 30));
    setSpeechEnergyThreshold(
      Math.max(0.01, Math.min(0.12, Number(w.speechEnergyThreshold ?? w.speech_energy_threshold ?? 0.038) || 0.038)),
    );
    setSpeechConfirmMs(clampInt(w.speechConfirmMs ?? w.speech_confirm_ms ?? 400, 300, 500));

    const savedPreview = w.previewQuestions;
    if (Array.isArray(savedPreview)) {
      const preview = savedPreview.map((q) => String(q)).filter(Boolean).slice(0, 15);
      setSampleQuestions(preview);
      if (qt === "question_bank") {
        setQbTotalMatched(preview.length);
        setQbPoolTotal(
          Math.max(preview.length, savedPoolTotal > 0 ? savedPoolTotal : 0, preview.length),
        );
      }
    } else {
      setSampleQuestions([]);
    }
    const savedDomains = w.previewDomains;
    setSampleDomains(Array.isArray(savedDomains) ? savedDomains.map((d) => String(d)) : []);
    const savedAssignments = w.previewAssignments;
    setSampleAssignments(Array.isArray(savedAssignments) ? savedAssignments.map((d) => String(d || "")) : []);
    const savedSkillsUsed = w.previewSkillsUsed;
    setSampleSkillsUsed(Array.isArray(savedSkillsUsed) ? savedSkillsUsed.map((s) => String(s)) : []);
    setGeneratedPrompt(String((j as any).generatedPrompt || ""));
    const hydratedEditedPrompt = String((j as any).editedPrompt || "");
    setEditedPrompt(hydratedEditedPrompt);
    promptDraftTouchedRef.current = Boolean(hydratedEditedPrompt.trim());
    setPromptPreview(String((j as any).promptPreview || ""));
    setPromptCharCount(Number((j as any).promptCharCount || 0));
    const hist = (j as any).promptHistory;
    setPromptHistory(Array.isArray(hist) ? hist : []);
    setPromptVersion(Math.max(1, Number((j as any).promptVersion || 1)));
    setPromptTokenEstimate(Math.max(0, Math.round(Number((j as any).promptCharCount || 0) / 4)));
    setPromptTestQuestions([]);
    lastAutoGeneratedPromptRef.current = String((j as JobConfig).generatedPrompt || "").trim();
  }

  const validateStep = (targetStep: 1 | 2 | 3) => {
    if (targetStep >= 1) {
      if (!jobTitle.trim()) return "Job title is required.";
      if (!timingMode) return "Select a timing mode (question count or time limit).";
    }
    if (targetStep >= 2) {
      if (!requiredSkills.trim()) return "Required skills are required.";
      if (questionType === "manual" && manualQuestionCount < 1) {
        return "Manual Interview Questions: add at least one non-empty line (one question per line).";
      }
      if (questionType === "question_bank") {
        if (!(suiteTargetRole || jobTitle).trim()) {
          return "Question Bank mode requires a target role.";
        }
        if (qbPoolTotal < 1 && bankPreviewCount < 1) {
          return "Question Bank mode: click “Preview from Bank” to verify matching questions before continuing.";
        }
      }
    }
    return "";
  };

  const next = () => {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError("");
    if (step === 1 && !suiteTargetRole.trim() && jobTitle.trim()) {
      setSuiteTargetRole(jobTitle.trim());
    }
    setStep((s) => (s < 3 ? ((s + 1) as any) : s));
  };

  const back = () => {
    setError("");
    setStep((s) => (s > 1 ? ((s - 1) as any) : s));
  };

  const toggleSuiteCategory = (id: string) => {
    setSelectedCategoryIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllSuiteCategories = () => {
    if (selectedCategoryIds.length === INTELLIGENCE_SUITE_CATEGORIES.length) {
      setSelectedCategoryIds([]);
    } else {
      setSelectedCategoryIds(INTELLIGENCE_SUITE_CATEGORIES.map((c) => c.id));
    }
  };

  const toggleQbCategory = (value: QbCategoryValue) => {
    setQbCategories((prev) => {
      if (prev.includes(value)) {
        const next = prev.filter((x) => x !== value);
        return next.length ? next : [value];
      }
      return [...prev, value];
    });
  };

  const toggleQbDifficulty = (value: QbDifficultyValue) => {
    setQbDifficulties((prev) => {
      if (prev.includes(value)) {
        const next = prev.filter((x) => x !== value);
        return next.length ? next : [value];
      }
      return [...prev, value];
    });
  };

  const removeQuestionFromBankPreview = (idx: number) => {
    const match = qbMatches[idx];
    const removedId = match?.id ? String(match.id) : "";
    setSampleQuestions((prev) => prev.filter((_, i) => i !== idx));
    setQbMatches((prev) => prev.filter((_, i) => i !== idx));
    setQbTotalMatched((prev) => Math.max(0, prev - 1));
    if (removedId) {
      setQbExcludedQuestionIds((prev) => (prev.includes(removedId) ? prev : [...prev, removedId]));
    }
  };

  const showQbToast = (msg: string) => {
    setQbToast(msg);
    window.setTimeout(() => setQbToast(""), 7000);
  };

  const runQuestionBankPreview = async () => {
    if (questionType !== "question_bank") return;
    const roleLine = (suiteTargetRole || jobTitle).trim();
    if (!roleLine) {
      setError("Target role is required for Question Bank preview.");
      return;
    }
    if (!requiredSkills.trim()) {
      setError("Required skills are required for Question Bank preview.");
      return;
    }
    if (!qbCategories.length) {
      setError("Select at least one bank category.");
      return;
    }
    if (!qbDifficulties.length) {
      setError("Select at least one difficulty level.");
      return;
    }
    try {
      setQbPreviewBusy(true);
      setError("");
      setQbToast("");
      const data = await previewQuestionBankFromTemplate({
        role: roleLine,
        requiredSkills,
        optionalSkills,
        categories: qbCategories,
        difficulties: qbDifficulties,
        questionCount: clampCountModeQuestions(numQ, 5),
        randomizationEnabled: qbRandomize,
        avoidDuplicateQuestions: qbAvoidDuplicates,
        excludedQuestionIds: qbExcludedQuestionIds,
      });
      setSampleQuestions(data.questions);
      setQbMatches(data.matches);
      setQbTotalMatched(data.totalMatched);
      setQbPoolTotal(data.poolTotal);
      setSampleDomains([]);
      setSampleAssignments([]);
      setSampleSkillsUsed(data.skillsUsed || []);
    } catch (e: unknown) {
      const backendErr = String((e as Error)?.message || e || "").trim();
      const toastMsg = backendErr
        ? `Unable to load Question Bank preview. ${backendErr}`
        : "Unable to load Question Bank preview.";
      showQbToast(toastMsg);
      setError(backendErr || "Unable to load Question Bank preview.");
      setSampleQuestions([]);
      setQbMatches([]);
      setQbTotalMatched(0);
      setQbPoolTotal(0);
    } finally {
      setQbPreviewBusy(false);
    }
  };

  const runIntelligenceQuestionnaire = async () => {
    if (questionType === "manual") {
      setError("Switch to Dynamic Questions to generate a questionnaire.");
      return;
    }
    if (!requiredSkills.trim()) {
      setError("Required skills are required before generating a questionnaire.");
      return;
    }
    if (!selectedCategoryIds.length) {
      setError("Select at least one assessment category.");
      return;
    }
    try {
      setSampleBusy(true);
      setError("");
      const fd = new FormData();
      fd.append("requiredSkills", requiredSkills);
      fd.append("optionalSkills", optionalSkills);
      fd.append("difficulty", difficulty);
      const genCount = Math.min(15, Math.max(numQ || 5, selectedCategoryIds.length));
      fd.append("numQ", String(genCount));
      fd.append("jdText", jdText);
      fd.append("templateInstructions", templateInstructions);
      fd.append("expMin", String(expMin || 0));
      fd.append("expMax", String(expMax || 0));
      fd.append("questionCategories", JSON.stringify(selectedCategoryIds));
      fd.append("targetRole", (suiteTargetRole || jobTitle).trim());
      fd.append("seniorityLevel", suiteSeniority.trim());
      fd.append("technicalStack", suiteTechStack.trim());
      fd.append("interviewMode", interviewMode);
      fd.append("avoidHistory", JSON.stringify(sampleQuestions || []));
      fd.append("generatedPrompt", generatedPrompt);
      fd.append("editedPrompt", editedPrompt);
      const res = await authFetch("/job/template/sample-questions", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || `Failed (${res.status})`);
      const list = Array.isArray(data?.questions) ? data.questions : [];
      const trimmed = list.map((q: unknown) => String(q)).filter(Boolean).slice(0, 30);
      setSampleQuestions(trimmed);
      const domains = Array.isArray(data?.domains) ? data.domains.map((d: unknown) => String(d)) : [];
      const assignments = Array.isArray(data?.domainAssignments)
        ? data.domainAssignments.map((d: unknown) => String(d || ""))
        : [];
      const skillsUsed = Array.isArray(data?.skillsUsed) ? data.skillsUsed.map((s: unknown) => String(s)) : [];
      setSampleDomains(domains);
      setSampleAssignments(assignments.slice(0, trimmed.length));
      setSampleSkillsUsed(skillsUsed);
      if (typeof data?.effectivePrompt === "string") setPromptPreview(String(data.effectivePrompt));
      if (typeof data?.charCount === "number") setPromptCharCount(Number(data.charCount || 0));
      if (typeof data?.tokenEstimate === "number") setPromptTokenEstimate(Number(data.tokenEstimate || 0));
    } catch (e: unknown) {
      setError(String((e as Error)?.message || e));
      setSampleQuestions([]);
      setSampleDomains([]);
      setSampleAssignments([]);
      setSampleSkillsUsed([]);
    } finally {
      setSampleBusy(false);
    }
  };

  const refreshPromptPreview = async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setPromptBusy(true);
      const fd = new FormData();
      fd.append("jobTitle", jobTitle);
      fd.append("requiredSkills", requiredSkills);
      fd.append("optionalSkills", optionalSkills);
      fd.append("expMin", String(expMin || 0));
      fd.append("expMax", String(expMax || 0));
      fd.append("difficulty", difficulty);
      fd.append("interviewMode", interviewMode);
      fd.append("jdText", jdText);
      fd.append("templateInstructions", templateInstructions);
      fd.append("customerName", customerName);
      fd.append("opportunityId", opportunityId);
      fd.append("technologyStack", suiteTechStack);
      fd.append("generatedPrompt", generatedPrompt);
      fd.append("editedPrompt", editedPrompt);
      const res = await authFetch("/job/template/prompt-preview", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || `Prompt preview failed (${res.status})`);
      const nextGenerated = String(data?.generatedPrompt || "");
      const nextPreview = String(data?.previewPrompt || data?.effectivePrompt || "");
      const usingCustom = Boolean(data?.usingCustomPrompt);
      setGeneratedPrompt(nextGenerated);
      setPromptPreview(nextPreview);
      setPromptCharCount(Number(data?.charCount || 0));
      setPromptTokenEstimate(Number(data?.tokenEstimate || 0));

      const prevAuto = lastAutoGeneratedPromptRef.current.trim();
      const currentEdited = editedPrompt.trim();
      const shouldSyncEditable =
        !usingCustom &&
        (!promptDraftTouchedRef.current ||
          !currentEdited ||
          (prevAuto && currentEdited === prevAuto));

      if (shouldSyncEditable) {
        setEditedPrompt(nextGenerated);
        promptDraftTouchedRef.current = false;
      } else if (usingCustom) {
        promptDraftTouchedRef.current = true;
      }
      lastAutoGeneratedPromptRef.current = nextGenerated;
    } catch (e) {
      if (!opts?.silent) setError(String((e as Error)?.message || e));
    } finally {
      if (!opts?.silent) setPromptBusy(false);
    }
  };

  const resetPromptToDefault = async () => {
    const ok = window.confirm("Reset custom prompt changes?");
    if (!ok) return;
    setEditedPrompt(generatedPrompt || "");
    promptDraftTouchedRef.current = false;
    setPromptVersion((v) => Math.max(1, v + 1));
    await refreshPromptPreview();
  };

  const testPrompt = async () => {
    try {
      setPromptTestBusy(true);
      setError("");
      const fd = new FormData();
      fd.append("requiredSkills", requiredSkills);
      fd.append("optionalSkills", optionalSkills);
      fd.append("difficulty", difficulty);
      fd.append("jdText", jdText);
      fd.append("templateInstructions", templateInstructions);
      fd.append("expMin", String(expMin || 0));
      fd.append("expMax", String(expMax || 0));
      fd.append("interviewMode", interviewMode);
      fd.append("targetRole", suiteTargetRole || jobTitle);
      fd.append("technicalStack", suiteTechStack);
      fd.append("generatedPrompt", generatedPrompt);
      fd.append("editedPrompt", editedPrompt);
      const testCount = Math.min(20, Math.max(15, numQ || 15));
      fd.append("numQ", String(testCount));
      const res = await authFetch("/job/template/test-prompt", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || `Prompt test failed (${res.status})`);
      const list = Array.isArray(data?.sampleQuestions)
        ? data.sampleQuestions.map((q: unknown) => String(q)).filter(Boolean)
        : data?.sampleQuestion
          ? [String(data.sampleQuestion)]
          : [];
      const trimmed = list.map((q: unknown) => String(q)).filter(Boolean).slice(0, 20);
      setPromptTestQuestions(trimmed);
      // Persist these as the template's preview questions on Save (so candidates
      // can be served a randomized subset during live interviews).
      if (questionType !== "manual") {
        setSampleQuestions(trimmed);
      }
      setPromptPreview(String(data?.effectivePrompt || promptPreview));
      setPromptCharCount(Number(data?.charCount || promptCharCount));
      setPromptTokenEstimate(Number(data?.tokenEstimate || promptTokenEstimate));
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setPromptTestBusy(false);
    }
  };

  useEffect(() => {
    if (step !== 3 || questionType === "manual" || questionType === "question_bank") return;
    const t = window.setTimeout(() => {
      refreshPromptPreview({ silent: true });
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    step,
    jobTitle,
    requiredSkills,
    optionalSkills,
    expMin,
    expMax,
    difficulty,
    interviewMode,
    jdText,
    templateInstructions,
    customerName,
    opportunityId,
    suiteTechStack,
    generatedPrompt,
    editedPrompt,
  ]);

  const save = async () => {
    // Guard: when editing an existing template, refuse to save until its data has
    // been loaded into the form. Without this, a failed/slow load leaves the form
    // empty and a save would overwrite the stored template with blank values —
    // the exact "template details disappear" data-loss bug.
    if (jobId && hydratedJobIdRef.current !== jobId) {
      setError("This template hasn't finished loading yet. Please wait for it to load before saving.");
      return;
    }
    const err = validateStep(2);
    if (err) {
      setError(err);
      setStep(2);
      return;
    }
    setBusy(true);
    try {
      setError("");
      const fd = new FormData();
      if (jobId) fd.append("jobId", jobId);
      fd.append("jobTitle", jobTitle);
      fd.append("domain", domain);
      fd.append("opportunityId", opportunityId);
      fd.append("customerName", customerName);
      fd.append("requiredSkills", requiredSkills);
      fd.append("optionalSkills", optionalSkills);
      fd.append("expMin", String(expMin || 0));
      fd.append("expMax", String(expMax || 0));
      fd.append("difficulty", difficulty);
      const saveNumQ =
        timingMode === "count"
          ? countModeQuestionsToAsk
          : questionType === "manual" && manualQuestionCount > 0
            ? manualQuestionCount
            : questionType === "question_bank" && bankPreviewCount > 0
              ? countModeQuestionsToAsk
              : clampCountModeQuestions(numQ, 5);
      fd.append("numQ", String(saveNumQ));
      fd.append("followupMode", "false");
      fd.append("interviewMode", interviewMode);
      fd.append("timingMode", timingMode || "count");
      fd.append("timeLimitSec", String(Math.max(0, Math.round((timeLimitMin || 0) * 60))));
      fd.append("micAlwaysOn", micAlwaysOn ? "true" : "false");
      fd.append("showSpokenText", showSpokenText ? "true" : "false");
      fd.append("enableTranscriptInput", showSpokenText ? "true" : "false");
      fd.append("jdText", jdText);
      fd.append("templateInstructions", templateInstructions);
      fd.append("questionType", questionType);
      fd.append("manualQuestions", JSON.stringify(normalizeManualQuestionLines(manualQuestionsText)));
      const prevEdited = String((editing as any)?.editedPrompt || "").trim();
      const prevGenerated = String((editing as any)?.generatedPrompt || "").trim();
      const prevEffective = prevEdited || prevGenerated;
      const sanitizedEdited = editedPrompt.trim();
      const generatedTrimmed = String(generatedPrompt || "").trim();
      const persistEdited = sanitizedEdited && sanitizedEdited !== generatedTrimmed ? sanitizedEdited : "";
      const currentEffective = persistEdited || generatedTrimmed;
      const promptChanged = currentEffective !== prevEffective;
      const nextPromptVersion = Math.max(1, promptChanged ? promptVersion + 1 : promptVersion);
      const nextPromptHistory = persistEdited && promptChanged
        ? [
            ...promptHistory,
            {
              version: nextPromptVersion,
              updated_at: new Date().toISOString(),
              edited_prompt: persistEdited.slice(0, 12000),
            },
          ].slice(-50)
        : promptHistory.slice(-50);
      fd.append("generatedPrompt", generatedPrompt);
      fd.append("editedPrompt", persistEdited);
      fd.append("promptVersion", String(nextPromptVersion));
      fd.append("promptHistory", JSON.stringify(nextPromptHistory));
      const prior =
        editing?.weights && typeof editing.weights === "object" ? { ...(editing.weights as Record<string, unknown>) } : {};
      const mergedWeights: Record<string, unknown> = {
        ...prior,
        questionCategories: selectedCategoryIds,
        intelligenceTargetRole: suiteTargetRole.trim(),
        intelligenceSeniority: suiteSeniority.trim(),
        intelligenceTechStack: suiteTechStack.trim(),
        adaptiveNextQuestion: questionType === "question_bank" ? false : adaptiveNextQuestion,
        // Is this role assessed on spoken communication at all? When false the
        // report is technical-only: no communication/confidence scores, and
        // communication carries no weight in the per-question scores either.
        communicationRequired,
        // Manual questions: keep the RMG's order, or shuffle per candidate.
        manualQuestionOrder,
        expMin,
        expMax,
        previewQuestions:
          questionType === "manual" ? [] : questionType === "question_bank" ? sampleQuestions : sampleQuestions,
        previewDomains: questionType === "manual" || questionType === "question_bank" ? [] : sampleDomains,
        previewAssignments: questionType === "manual" || questionType === "question_bank" ? [] : sampleAssignments,
        previewSkillsUsed: questionType === "manual" ? [] : sampleSkillsUsed,
        questionBankPoolTotal: questionType === "question_bank" ? qbPoolTotal : prior.questionBankPoolTotal,
        questionBankConfig:
          questionType === "question_bank"
            ? {
                role: (suiteTargetRole || jobTitle).trim(),
                skills: requiredSkills
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                categories: qbCategories,
                difficulties: qbDifficulties,
                category: qbCategories[0] || "technical",
                difficulty: qbDifficulties[0] || difficulty,
                questionCount: countModeQuestionsToAsk,
                randomizationEnabled: qbRandomize,
                avoidDuplicateQuestions: qbAvoidDuplicates,
                excludedQuestionIds: qbExcludedQuestionIds,
              }
            : prior.questionBankConfig,
        enableTimeWarnings: enableTimeWarnings,
        timeWarningSec: {
          "5min": Math.max(60, Math.round(warn5Min * 60)),
          "2min": Math.max(60, Math.round(warn2Min * 60)),
          "1min": Math.max(30, Math.round(warn1Min * 60)),
          "30sec": Math.max(10, Math.min(120, warn30Sec)),
        },
        timeWarningsTts: false,
        autoAdvanceEnabled,
        initialResponseWaitSec,
        noResponseExtraWaitSec,
        silenceDetectionSec,
        autoSkipEnabled,
        voiceCommandsEnabled,
        confirmationBeforeNextSec,
        minimumAnswerWords,
        minimumSpeechDurationSec,
        speechEnergyThreshold,
        speechConfirmMs,
      };
      fd.append("weights", JSON.stringify(mergedWeights));
      const res = await authFetch("/job/config", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || `Save failed (${res.status})`);
      if (data?.warning) {
        window.alert(String(data.warning));
      }
      setPromptVersion(nextPromptVersion);
      setPromptHistory(nextPromptHistory);
      await refresh();
      onDone();
    } catch (e: unknown) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="platform-form-shell mx-auto max-w-screen-2xl w-full px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
        <div>
          <div className="flex items-center gap-2">
            <button
              onClick={onDone}
              className="h-10 px-3 rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-surface-2 text-sm font-semibold text-secondary inline-flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <a
              onClick={(e) => {
                e.preventDefault();
                onOpenHrSetup();
              }}
              href="/?focus=template"
              className="h-10 px-3 rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-surface-2 text-sm font-semibold text-secondary inline-flex items-center gap-2"
            >
              HR Setup <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>
          <h1 className="text-display mt-4 text-2xl font-bold tracking-tight text-primary">
            {jobId ? "Edit Template" : "Create Template"}
          </h1>
          <p className="text-muted text-sm mt-1">Templates power HR setup (skills/role/JD) and ATS scoring.</p>
        </div>
        <div className="flex items-center gap-2">
          {step > 1 ? (
            <button
              onClick={back}
              className="inline-flex items-center gap-2 rounded-control border border-subtle bg-surface-1 px-4 py-2.5 font-semibold text-secondary transition-colors duration-micro ease-smooth hover:border-strong hover:bg-surface-2 hover:text-primary"
              disabled={busy || loading}
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
          ) : null}
          {step < 3 ? (
            <button
              onClick={next}
              className="inline-flex items-center gap-2 btn-depth btn-gradient rounded-control bg-brand-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
              disabled={busy || loading}
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={save}
              className="inline-flex items-center gap-2 btn-depth btn-gradient rounded-control bg-brand-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
              disabled={busy || loading}
            >
              <Save className="w-4 h-4" />
              Save Template
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded-card border border-subtle bg-danger-soft p-6 text-danger">
          <div className="font-extrabold">Template error</div>
          <div className="mt-2 text-sm">{error}</div>
        </div>
      ) : null}

      {qbToast ? (
        <div className="mt-4 rounded-card border border-subtle bg-warning-soft px-4 py-3 text-sm text-warning">
          {qbToast}
        </div>
      ) : null}

      <div className="platform-form-card mt-6 bg-surface-1 border border-subtle rounded-card p-6 shadow-raised">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="fx-glow w-11 h-11 rounded-card bg-gradient-to-br from-brand-600 to-violet-600 flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-extrabold tracking-tight text-primary">Template wizard</div>
              <div className="text-xs text-muted mt-0.5">
                {editing ? `Editing ${editing.jobTitle}` : "Create a job template HR can reuse."}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {steps.map((s, idx) => {
              const active = s.id === step;
              const done = s.id < step;
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <div
                    className={`h-9 px-3 rounded-control border text-sm font-semibold flex items-center gap-2 transition-colors duration-micro ease-smooth ${
                      active
                        ? "bg-surface-1 border-subtle text-brand-700 shadow-raised dark:text-brand-300"
                        : done
                          ? "bg-success-soft border-subtle text-success"
                          : "bg-surface-2 border-subtle text-secondary"
                    }`}
                  >
                    {done ? <CheckCircle2 className="w-4 h-4" /> : <span className="w-4 text-center">{idx + 1}</span>}
                    <span className="hidden sm:inline">{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-start gap-4">
          {/* spacer for layout consistency */}
        </div>

          {step === 1 ? (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <SectionBanner
                icon={<Info className="w-5 h-5" />}
                title="Template Basics"
                description="Name the role, set difficulty and interview mode, and define how the interview ends."
              />
            </div>
            <div>
              <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Job title</label>
              <input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="mt-2 w-full h-11 px-4 input-recessed rounded-control text-primary"
                placeholder="e.g. Python Developer"
              />
            </div>
            <div>
              <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Domain (optional)</label>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="mt-2 w-full h-11 px-4 input-recessed rounded-control text-primary"
                placeholder="e.g. Automotive / FinTech / Enterprise"
              />
            </div>
            <CreatableMasterCombobox
              kind="opportunity"
              label="Opportunity ID"
              value={opportunityId}
              onChange={setOpportunityId}
              placeholder="Search or create opportunity ID"
            />
            <CreatableMasterCombobox
              kind="customer"
              label="Customer Name"
              value={customerName}
              onChange={setCustomerName}
              placeholder="Search or create customer"
            />
            <div>
              <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty((e.target.value as any) || "medium")}
                className="mt-2 w-full h-11 px-4 input-recessed rounded-control text-primary"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Interview mode</label>
              <select
                value={interviewMode}
                onChange={(e) => setInterviewMode((e.target.value as "technical" | "hr") || "technical")}
                className="mt-2 w-full h-11 px-4 input-recessed rounded-control text-primary"
              >
                <option value="technical">Technical Interview</option>
                <option value="hr">HR Interview</option>
              </select>
            </div>

            <div className="rounded-card border border-subtle p-4 md:col-span-2">
              <div className="text-xs font-extrabold tracking-widest uppercase text-muted">Timing</div>
              <div className="mt-3">
                <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Mode</label>
                <select
                  value={timingMode}
                  onChange={(e) => {
                    const v = e.target.value as "" | "count" | "time";
                    setTimingMode(v === "count" || v === "time" ? v : "");
                  }}
                  className="mt-2 w-full h-11 px-4 input-recessed rounded-control text-primary"
                >
                  <option value="">Select timing mode…</option>
                  <option value="count">Ask by question count (fixed)</option>
                  <option value="time">Ask by time limit</option>
                </select>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Questions count</label>
                  <input
                    type="number"
                    min={1}
                    max={MAX_COUNT_MODE_QUESTIONS}
                    value={numQ}
                    onChange={(e) => setNumQ(clampCountModeQuestions(e.target.value, numQ))}
                    disabled={timingMode !== "count"}
                    className="mt-2 w-full h-11 px-4 input-recessed rounded-control text-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Time limit (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={360}
                    value={timeLimitMin}
                    onChange={(e) => setTimeLimitMin(clampInt(e.target.value, 1, 360))}
                    disabled={timingMode !== "time"}
                    className="mt-2 w-full h-11 px-4 input-recessed rounded-control text-primary"
                  />
                </div>
              </div>
              <div className="mt-2 text-xs text-muted">
                {!timingMode
                  ? "Choose how the interview ends: fixed number of questions, or a time limit."
                  : timingMode === "time"
                    ? `Candidates will be auto-submitted after ${timeLimitMin} minutes.`
                    : questionType === "manual"
                      ? manualQuestionCount > 0
                        ? `Ask ${countModeQuestionsToAsk} questions from your manual list (${manualQuestionCount} in pool, up to ${MAX_COUNT_MODE_QUESTIONS} per interview).`
                        : "Add manual questions in step 2, then set how many to ask per interview."
                      : questionType === "question_bank"
                        ? bankPreviewCount > 0
                          ? `Ask up to ${countModeQuestionsToAsk} questions from Question Bank (${bankPreviewCount} matched in preview).`
                          : "Configure Question Bank filters in step 2 and run preview."
                        : `Candidates will answer exactly ${numQ} questions (max ${MAX_COUNT_MODE_QUESTIONS}).`}
              </div>
              {timingMode === "time" ? (
                <div className="mt-4 rounded-card border border-subtle bg-surface-1 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-xs font-extrabold tracking-widest uppercase text-muted">
                        Time warnings
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        Non-blocking banners before auto-submit (default ON).
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEnableTimeWarnings((v) => !v)}
                      className={`h-9 px-3 rounded-control border text-sm font-semibold transition-colors duration-micro ease-smooth ${
                        enableTimeWarnings
                          ? "bg-brand-50 border-subtle text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                          : "bg-surface-2 border-subtle text-secondary"
                      }`}
                    >
                      {enableTimeWarnings ? "ON" : "OFF"}
                    </button>
                  </div>
                  {enableTimeWarnings ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                      <div>
                        <label className="text-xs font-bold uppercase text-muted">5 min warn</label>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={warn5Min}
                          onChange={(e) => setWarn5Min(clampInt(e.target.value, 1, 60))}
                          className="mt-1 w-full h-10 px-3 input-recessed rounded-control text-primary"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase text-muted">2 min warn</label>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={warn2Min}
                          onChange={(e) => setWarn2Min(clampInt(e.target.value, 1, 30))}
                          className="mt-1 w-full h-10 px-3 input-recessed rounded-control text-primary"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase text-muted">1 min warn</label>
                        <input
                          type="number"
                          min={1}
                          max={15}
                          value={warn1Min}
                          onChange={(e) => setWarn1Min(clampInt(e.target.value, 1, 15))}
                          className="mt-1 w-full h-10 px-3 input-recessed rounded-control text-primary"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase text-muted">30 sec warn</label>
                        <input
                          type="number"
                          min={10}
                          max={120}
                          value={warn30Sec}
                          onChange={(e) => setWarn30Sec(clampInt(e.target.value, 10, 120))}
                          className="mt-1 w-full h-10 px-3 input-recessed rounded-control text-primary"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/*
              "Mic always on" UI removed (May 2026 spec): the candidate microphone now starts
              automatically after the AI finishes each question. We still send `micAlwaysOn=false`
              to the backend so legacy DB columns and API contracts remain valid.
            */}

            <div className="rounded-card border border-subtle p-4 md:col-span-2 bg-surface-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs font-extrabold tracking-widest uppercase text-muted">Enable Transcript Input</div>
                  <div className="mt-1 text-sm font-semibold text-secondary">{showSpokenText ? "ON" : "OFF"}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSpokenText((v) => !v)}
                  className={`h-9 px-3 rounded-control border text-sm font-semibold transition-colors duration-micro ease-smooth ${
                    showSpokenText
                      ? "bg-success-soft border-subtle text-success hover:border-strong"
                      : "bg-surface-2 border-subtle text-secondary hover:border-strong"
                  }`}
                >
                  Toggle
                </button>
              </div>
              <div className="mt-2 text-xs text-muted">
                When ON, the candidate sees the live transcript panel. Turn OFF to hide the transcript section entirely.
              </div>
            </div>

            {/* Communication assessment — for roles where RMG has judged that
                spoken communication is not a genuine requirement, the report
                should cover technical substance only. */}
            <div className="rounded-card border border-subtle p-4 md:col-span-2 bg-surface-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs font-extrabold tracking-widest uppercase text-muted">
                    Assess Communication
                  </div>
                  <div className="mt-1 text-sm font-semibold text-secondary">
                    {communicationRequired
                      ? "ON — technical + communication"
                      : "OFF — technical only"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCommunicationRequired((v) => !v)}
                  className={`h-9 px-3 rounded-control border text-sm font-semibold transition-colors duration-micro ease-smooth ${
                    communicationRequired
                      ? "bg-success-soft border-subtle text-success hover:border-strong"
                      : "bg-surface-2 border-subtle text-secondary hover:border-strong"
                  }`}
                >
                  Toggle
                </button>
              </div>
              <div className="mt-2 text-xs text-muted">
                {communicationRequired ? (
                  <>
                    The report scores communication and confidence alongside technical
                    performance, and communication carries 10% of every question's score.
                  </>
                ) : (
                  <>
                    The report covers <span className="font-semibold text-secondary">technical
                    aspects only</span>. Communication and confidence are not scored, not shown,
                    and carry no weight in the question scores — a candidate is judged on what
                    they said, not how they said it. Use this for positions where proper
                    spoken communication is not a real requirement.
                  </>
                )}
              </div>
            </div>

            <div className="fx-gradient-border rounded-card border border-subtle p-4 md:col-span-2 bg-surface-1">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs font-extrabold tracking-widest uppercase text-brand-600 dark:text-brand-300">Smart Auto-Advance</div>
                  <div className="mt-1 text-sm font-semibold text-secondary">
                    {autoAdvanceEnabled ? "ON — voice-driven flow" : "OFF — manual Send / Skip"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoAdvanceEnabled((v) => !v)}
                  className={`h-9 px-3 rounded-control border text-sm font-semibold transition-colors duration-micro ease-smooth ${
                    autoAdvanceEnabled
                      ? "bg-brand-100 border-subtle text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                      : "bg-surface-2 border-subtle text-secondary"
                  }`}
                >
                  {autoAdvanceEnabled ? "ON" : "OFF"}
                </button>
              </div>
              {autoAdvanceEnabled ? (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                  <div>
                    <label className="text-xs font-bold uppercase text-muted">Initial wait (sec)</label>
                    <input type="number" min={2} max={30} value={initialResponseWaitSec}
                      onChange={(e) => setInitialResponseWaitSec(clampInt(e.target.value, 2, 30))}
                      className="mt-1 w-full h-10 px-3 input-recessed rounded-control text-primary" />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase text-muted">Extra skip wait (sec)</label>
                    <input type="number" min={1} max={15} step={0.5} value={noResponseExtraWaitSec}
                      onChange={(e) => setNoResponseExtraWaitSec(Math.max(1, Math.min(15, Number(e.target.value) || 2.5)))}
                      className="mt-1 w-full h-10 px-3 input-recessed rounded-control text-primary" />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase text-muted">Silence detect (sec)</label>
                    <input type="number" min={1} max={15} step={0.5} value={silenceDetectionSec}
                      onChange={(e) => setSilenceDetectionSec(Math.max(1, Math.min(15, Number(e.target.value) || 2.5)))}
                      className="mt-1 w-full h-10 px-3 input-recessed rounded-control text-primary" />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase text-muted">Post-complete silence (sec)</label>
                    <input type="number" min={0} max={10} step={0.5} value={confirmationBeforeNextSec}
                      onChange={(e) => setConfirmationBeforeNextSec(Math.max(0, Math.min(10, Number(e.target.value) || 2.5)))}
                      className="mt-1 w-full h-10 px-3 input-recessed rounded-control text-primary" />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase text-muted">Min answer words</label>
                    <input type="number" min={1} max={30} value={minimumAnswerWords}
                      onChange={(e) => setMinimumAnswerWords(clampInt(e.target.value, 1, 30))}
                      className="mt-1 w-full h-10 px-3 input-recessed rounded-control text-primary" />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase text-muted">Min speech (sec)</label>
                    <input type="number" min={1} max={30} value={minimumSpeechDurationSec}
                      onChange={(e) => setMinimumSpeechDurationSec(clampInt(e.target.value, 1, 30))}
                      className="mt-1 w-full h-10 px-3 input-recessed rounded-control text-primary" />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase text-muted">Speech energy threshold</label>
                    <input type="number" min={0.01} max={0.12} step={0.001} value={speechEnergyThreshold}
                      onChange={(e) => setSpeechEnergyThreshold(Math.max(0.01, Math.min(0.12, Number(e.target.value) || 0.038)))}
                      className="mt-1 w-full h-10 px-3 input-recessed rounded-control text-primary" />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase text-muted">Speech confirm (ms)</label>
                    <input type="number" min={300} max={500} value={speechConfirmMs}
                      onChange={(e) => setSpeechConfirmMs(clampInt(e.target.value, 300, 500))}
                      className="mt-1 w-full h-10 px-3 input-recessed rounded-control text-primary" />
                  </div>
                  <div className="flex items-end">
                    <button type="button" onClick={() => setAutoSkipEnabled((v) => !v)}
                      className={`w-full h-10 rounded-control border text-xs font-bold ${autoSkipEnabled ? "bg-warning-soft border-subtle text-warning" : "bg-surface-2 border-subtle text-secondary"}`}>
                      Auto-skip: {autoSkipEnabled ? "ON" : "OFF"}
                    </button>
                  </div>
                  <div className="flex items-end">
                    <button type="button" onClick={() => setVoiceCommandsEnabled((v) => !v)}
                      className={`w-full h-10 rounded-control border text-xs font-bold ${voiceCommandsEnabled ? "bg-success-soft border-subtle text-success" : "bg-surface-2 border-subtle text-secondary"}`}>
                      Voice commands: {voiceCommandsEnabled ? "ON" : "OFF"}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted">
                  When ON, the interview detects speech and silence to auto-submit answers and auto-skip silent questions.
                </p>
              )}
            </div>

          </div>
        ) : step === 2 ? (
          <div className="mt-6 space-y-5">
            <SectionBanner
              icon={<Zap className="w-5 h-5" />}
              title="Skills, JD & Question Source"
              description="Set experience, skills and JD, then choose how questions are generated — dynamic AI, manual, or Question Bank."
            />
            <div>
              <div className="text-xs font-extrabold tracking-widest uppercase text-muted">Years of experience</div>
              <p className="text-xs text-muted mt-1 mb-2">Used for question generation and saved on the template.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Experience min</label>
                  <input
                    type="number"
                    min={0}
                    max={40}
                    value={expMin}
                    onChange={(e) => setExpMin(clampInt(e.target.value, 0, 40))}
                    className="mt-1.5 w-full h-10 px-4 input-recessed rounded-control text-sm text-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Experience max</label>
                  <input
                    type="number"
                    min={0}
                    max={40}
                    value={expMax}
                    onChange={(e) => setExpMax(clampInt(e.target.value, 0, 40))}
                    className="mt-1.5 w-full h-10 px-4 input-recessed rounded-control text-sm text-primary"
                  />
                </div>
              </div>
            </div>

            {/* Row 1: Skills */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Required skills</label>
                <input
                  value={requiredSkills}
                  onChange={(e) => setRequiredSkills(e.target.value)}
                  className="mt-1.5 w-full h-10 px-4 input-recessed rounded-control text-sm text-primary"
                  placeholder="e.g. python, fastapi, sql"
                />
              </div>
              <div>
                <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Optional skills</label>
                <input
                  value={optionalSkills}
                  onChange={(e) => setOptionalSkills(e.target.value)}
                  className="mt-1.5 w-full h-10 px-4 input-recessed rounded-control text-sm text-primary"
                  placeholder="e.g. docker, aws"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Question Type</label>
              <select
                value={questionType}
                onChange={(e) => {
                  const raw = e.target.value;
                  const v: QuestionType =
                    raw === "manual" ? "manual" : raw === "question_bank" ? "question_bank" : "dynamic";
                  setQuestionType(v);
                  setError("");
                  if (v === "question_bank") {
                    setAdaptiveNextQuestion(false);
                  }
                  if (v !== "question_bank") {
                    setQbMatches([]);
                    setQbTotalMatched(0);
                  }
                }}
                className="mt-1.5 w-full md:max-w-md h-10 px-4 input-recessed rounded-control text-sm text-primary"
              >
                <option value="dynamic">Dynamic Questions</option>
                <option value="manual">Manual Questions</option>
                <option value="question_bank">Question Bank</option>
              </select>
              <p className="text-xs text-muted mt-1.5">
                <span className="font-semibold text-secondary">Dynamic</span> — AI generates from skills and domains.{" "}
                <span className="font-semibold text-secondary">Manual</span> — fixed list you provide.{" "}
                <span className="font-semibold text-secondary">Question Bank</span> — pulls approved questions from your
                centralized bank by role, skills, and difficulty.
              </p>
            </div>

            {/* Row 2: Target Role / Seniority / Tech Stack */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Target role</label>
                <input
                  value={suiteTargetRole}
                  onChange={(e) => setSuiteTargetRole(e.target.value)}
                  className="mt-1.5 w-full h-10 px-4 input-recessed rounded-control text-sm text-primary"
                  placeholder="e.g. Python Developer"
                />
              </div>
              <div>
                <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Seniority level</label>
                <select
                  value={suiteSeniority}
                  onChange={(e) => setSuiteSeniority(e.target.value)}
                  className="mt-1.5 w-full h-10 px-4 input-recessed rounded-control text-sm text-primary"
                >
                  <option value="">Select…</option>
                  <option value="Junior">Junior</option>
                  <option value="Mid">Mid</option>
                  <option value="Senior">Senior</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Tech stack (optional)</label>
                <input
                  value={suiteTechStack}
                  onChange={(e) => setSuiteTechStack(e.target.value)}
                  className="mt-1.5 w-full h-10 px-4 input-recessed rounded-control text-sm text-primary"
                  placeholder="e.g. React, Node.js, AWS"
                />
              </div>
            </div>

            {questionType === "dynamic" ? (
              <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-extrabold tracking-tight text-primary flex items-center gap-2">
                  <Zap className="w-4 h-4 text-brand-600 dark:text-brand-300" />
                  Assessment Domains
                  {selectedCategoryIds.length > 0 && (
                    <span className="ml-1 text-xs font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full dark:bg-brand-900 dark:text-brand-200">
                      {selectedCategoryIds.length} selected
                    </span>
                  )}
                </h3>
                <p className="text-xs text-muted mt-0.5">Select domains to shape question generation alongside your skills.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllSuiteCategories}
                  className="px-3 py-1.5 text-xs font-bold text-secondary rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-surface-2 hover:text-brand-600 dark:hover:text-brand-300"
                >
                  {selectedCategoryIds.length === INTELLIGENCE_SUITE_CATEGORIES.length ? "Clear all" : "Select all"}
                </button>
                <button
                  type="button"
                  onClick={runIntelligenceQuestionnaire}
                  disabled={selectedCategoryIds.length === 0 || !requiredSkills.trim() || sampleBusy}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-control font-bold text-xs transition-colors duration-micro ease-smooth ${
                    selectedCategoryIds.length > 0 && requiredSkills.trim() && !sampleBusy
                      ? "btn-depth btn-gradient bg-brand-600 text-white"
                      : "bg-surface-2 text-muted cursor-not-allowed"
                  }`}
                >
                  {sampleBusy ? "Generating…" : "Generate Questions"}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Row 4: Compact domain grid — 4 cols */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {INTELLIGENCE_SUITE_CATEGORIES.map((cat) => {
                const isSelected = selectedCategoryIds.includes(cat.id);
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleSuiteCategory(cat.id)}
                    className={`group flex items-center gap-2.5 text-left px-3 py-2.5 rounded-card border transition-colors duration-micro ease-smooth ${
                      isSelected
                        ? "fx-gradient-border border-transparent bg-brand-50 shadow-raised dark:bg-brand-900"
                        : "border-subtle bg-surface-1 hover:border-strong hover:shadow-raised"
                    }`}
                  >
                    <div
                      className={`shrink-0 p-1.5 rounded-control transition-colors duration-micro ease-smooth ${
                        isSelected ? "bg-brand-600 text-white" : `${cat.bgColor} ${cat.color}`
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1 flex items-center gap-1.5">
                      <span className={`text-xs font-bold leading-tight truncate ${isSelected ? "text-brand-700 dark:text-brand-200" : "text-primary"}`}>
                        {cat.title}
                      </span>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-brand-500" />}
                    </div>
                  </button>
                );
              })}
            </div>

              </>
            ) : questionType === "question_bank" ? (
              <div className="fx-gradient-border rounded-card border border-subtle bg-surface-1 p-5 space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-sm font-extrabold tracking-tight text-primary flex items-center gap-2">
                      <Database className="w-4 h-4 text-violet-600 dark:text-violet-300" />
                      Question Bank selection
                    </h3>
                    <p className="text-xs text-secondary mt-1 max-w-2xl">
                      Questions are loaded from your approved Question Bank using target role, required skills, and your
                      selected categories and difficulty levels. Each candidate gets a unique randomized subset when
                      randomization is enabled; parallel interviews avoid repeating the same questions when possible.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={runQuestionBankPreview}
                    disabled={qbPreviewBusy || !requiredSkills.trim() || !(suiteTargetRole || jobTitle).trim()}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-control font-bold text-xs transition-colors duration-micro ease-smooth ${
                      !qbPreviewBusy && requiredSkills.trim() && (suiteTargetRole || jobTitle).trim()
                        ? "bg-violet-600 text-white shadow-raised hover:bg-violet-700"
                        : "bg-surface-2 text-muted cursor-not-allowed"
                    }`}
                  >
                    {qbPreviewBusy ? "Loading…" : "Preview from Bank"}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Bank category</label>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {QB_CATEGORIES.map((c) => {
                        const active = qbCategories.includes(c.value);
                        return (
                          <button
                            key={c.value}
                            type="button"
                            onClick={() => toggleQbCategory(c.value)}
                            className={`px-3 py-1.5 rounded-control text-xs font-bold border transition-colors duration-micro ease-smooth ${
                              active
                                ? "bg-violet-600 text-white border-transparent"
                                : "bg-surface-1 text-secondary border-subtle hover:border-strong"
                            }`}
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Difficulty filter</label>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {QB_DIFFICULTIES.map((d) => {
                        const active = qbDifficulties.includes(d.value);
                        return (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => toggleQbDifficulty(d.value)}
                            className={`px-3 py-1.5 rounded-control text-xs font-bold border transition-colors duration-micro ease-smooth ${
                              active
                                ? "bg-violet-600 text-white border-transparent"
                                : "bg-surface-1 text-secondary border-subtle hover:border-strong"
                            }`}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-extrabold tracking-widest uppercase text-muted">Preview pool size</label>
                    <input
                      type="number"
                      min={1}
                      max={MAX_COUNT_MODE_QUESTIONS}
                      value={numQ}
                      onChange={(e) => setNumQ(clampCountModeQuestions(e.target.value, numQ))}
                      className="mt-1.5 w-full h-10 px-4 input-recessed rounded-control text-sm text-primary"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="inline-flex items-center gap-2 text-secondary">
                    <input
                      type="checkbox"
                      checked={qbRandomize}
                      onChange={(e) => setQbRandomize(e.target.checked)}
                      className="rounded border-strong text-violet-600"
                    />
                    Randomize per candidate
                  </label>
                  <label className="inline-flex items-center gap-2 text-secondary">
                    <input
                      type="checkbox"
                      checked={qbAvoidDuplicates}
                      onChange={(e) => setQbAvoidDuplicates(e.target.checked)}
                      className="rounded border-strong text-violet-600"
                    />
                    Avoid duplicate questions across sessions
                  </label>
                </div>
                <p className="text-xs text-muted">
                  With both options enabled, each scheduled candidate receives a different mix from the bank pool.
                  Questions you remove below are excluded for every interview on this template.
                </p>

                {qbPoolTotal > 0 ? (
                  <div className="rounded-card border border-subtle bg-success-soft px-3 py-2 text-xs font-semibold text-success">
                    {qbPoolTotal} matching question{qbPoolTotal === 1 ? "" : "s"} in the bank
                    {qbExcludedQuestionIds.length
                      ? ` (${qbExcludedQuestionIds.length} excluded from interviews)`
                      : ""}
                    .
                  </div>
                ) : (
                  <div className="rounded-card border border-subtle bg-warning-soft px-3 py-2 text-xs text-warning">
                    Run a preview to confirm the bank has questions for role “{suiteTargetRole || jobTitle || "—"}” and skills{" "}
                    {requiredSkills || "—"}.
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="text-xs font-extrabold tracking-widest uppercase text-muted">
                  Manual Interview Questions
                </label>
                <textarea
                  value={manualQuestionsText}
                  onChange={(e) => setManualQuestionsText(e.target.value)}
                  rows={16}
                  spellCheck={false}
                  className="mt-1.5 w-full min-h-56 max-h-96 overflow-y-auto p-3 input-recessed rounded-control text-sm leading-relaxed text-primary resize-y whitespace-pre-wrap"
                  placeholder={"Paste interview questions here.\nOne question per line."}
                />
                <p className="text-xs text-muted mt-1.5">
                  {manualQuestionCount} question{manualQuestionCount === 1 ? "" : "s"} (empty lines ignored, duplicates removed, up to 120
                  saved).
                </p>

                {/* Question order — the pool used to be shuffled unconditionally,
                    which breaks questions that deliberately build on each other. */}
                <fieldset className="mt-4">
                  <legend className="text-xs font-extrabold tracking-widest uppercase text-muted">
                    Question order
                  </legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label
                      className={`flex cursor-pointer gap-2.5 rounded-control border p-3 transition ${
                        manualQuestionOrder === "sequential"
                          ? "border-brand-400 bg-brand-50/60 dark:border-brand-500/60 dark:bg-brand-950/30"
                          : "border-subtle hover:border-strong"
                      }`}
                    >
                      <input
                        type="radio"
                        name="manualQuestionOrder"
                        value="sequential"
                        checked={manualQuestionOrder === "sequential"}
                        onChange={() => setManualQuestionOrder("sequential")}
                        className="mt-0.5"
                      />
                      <span className="text-sm">
                        <span className="block font-semibold text-primary">One by one, in order</span>
                        <span className="block text-xs text-muted mt-0.5">
                          Asked exactly as listed above. Use this when the questions build on
                          each other.
                        </span>
                      </span>
                    </label>

                    <label
                      className={`flex cursor-pointer gap-2.5 rounded-control border p-3 transition ${
                        manualQuestionOrder === "random"
                          ? "border-brand-400 bg-brand-50/60 dark:border-brand-500/60 dark:bg-brand-950/30"
                          : "border-subtle hover:border-strong"
                      }`}
                    >
                      <input
                        type="radio"
                        name="manualQuestionOrder"
                        value="random"
                        checked={manualQuestionOrder === "random"}
                        onChange={() => setManualQuestionOrder("random")}
                        className="mt-0.5"
                      />
                      <span className="text-sm">
                        <span className="block font-semibold text-primary">Random order</span>
                        <span className="block text-xs text-muted mt-0.5">
                          Same pool, shuffled per candidate, so parallel sessions do not all
                          see question 1 first.
                        </span>
                      </span>
                    </label>
                  </div>
                </fieldset>
              </div>
            )}

            {/* Row 5: JD text (moved up, before Generated Preview) */}
            <div>
              <label className="text-xs font-extrabold tracking-widest uppercase text-muted">JD text (optional)</label>
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                rows={4}
                className="mt-1.5 w-full p-3 input-recessed rounded-control text-sm text-primary resize-y"
                placeholder="Paste job description here…"
              />
            </div>

            {/* Row 6: AI-Generated Interview Questions (API Response) */}
            {(questionType === "dynamic" || questionType === "question_bank") && sampleQuestions.length > 0 && (
              <div className="fx-gradient-border-animated rounded-card bg-surface-1 p-5 shadow-raised">
                <div className="fx-hairline-b flex items-center justify-between flex-wrap gap-3 mb-4 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-2 rounded-control text-white ${questionType === "question_bank" ? "bg-violet-600" : "bg-gradient-to-br from-brand-600 to-violet-600"}`}>
                      {questionType === "question_bank" ? <Database className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="text-sm font-extrabold tracking-tight text-primary">
                        {questionType === "question_bank" ? "Question Bank Preview" : "AI-Generated Interview Questions"}
                      </h4>
                      <p className="text-xs text-muted mt-0.5">
                        {sampleQuestions.length} question{sampleQuestions.length === 1 ? "" : "s"} ready
                      </p>
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-success-soft ring-1 ring-inset ring-subtle">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                    <span className="text-xs font-bold text-success">
                      {questionType === "question_bank"
                        ? "Sample preview — live interviews draw from the full pool"
                        : "Will be asked in the live interview"}
                    </span>
                  </div>
                </div>

                <ol className="space-y-2.5">
                  {sampleQuestions.map((q: string, idx: number) => {
                    const assignedDomain = sampleAssignments[idx] || "";
                    const match = qbMatches[idx];
                    return (
                      <li
                        key={`${match?.id || "q"}-${idx}`}
                        className="row-hover flex gap-3 p-3 rounded-card bg-surface-2 border border-subtle transition-colors duration-micro ease-smooth"
                      >
                        <span className="shrink-0 w-7 h-7 rounded-control bg-gradient-to-br from-brand-600 to-violet-600 text-white text-xs font-extrabold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-primary leading-relaxed">{String(q)}</p>
                          {questionType === "question_bank" && match ? (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {match.skill ? (
                                <span className="text-xs font-semibold text-violet-600 dark:text-violet-300 bg-surface-1 px-2 py-0.5 rounded-full ring-1 ring-inset ring-subtle">
                                  {match.skill}
                                </span>
                              ) : null}
                              {match.difficulty ? (
                                <span className="text-xs font-semibold text-secondary bg-surface-1 px-2 py-0.5 rounded-full ring-1 ring-inset ring-subtle">
                                  {match.difficulty}
                                </span>
                              ) : null}
                              {match.category ? (
                                <span className="text-xs font-semibold text-muted bg-surface-1 px-2 py-0.5 rounded-full ring-1 ring-inset ring-subtle">
                                  {match.category}
                                </span>
                              ) : null}
                            </div>
                          ) : assignedDomain ? (
                            <span className="inline-block mt-1.5 text-xs font-semibold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900 px-2 py-0.5 rounded-full ring-1 ring-inset ring-subtle">
                              {assignedDomain}
                            </span>
                          ) : null}
                        </div>
                        {questionType === "question_bank" ? (
                          <button
                            type="button"
                            onClick={() => removeQuestionFromBankPreview(idx)}
                            className="shrink-0 self-start p-2 rounded-control text-muted transition-colors duration-micro ease-smooth hover:text-danger hover:bg-danger-soft"
                            title="Remove — will not be asked in any interview"
                            aria-label="Remove question — will not be asked in any interview"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>

                {sampleSkillsUsed.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-subtle flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-muted uppercase tracking-wider">Skills covered:</span>
                    {sampleSkillsUsed.map((sk) => (
                      <span
                        key={sk}
                        className="text-xs font-bold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-900 dark:text-brand-200 ring-1 ring-inset ring-subtle"
                      >
                        {sk}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : step === 3 && questionType === "question_bank" ? (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="fx-gradient-border lg:col-span-7 rounded-card border border-subtle p-6 bg-surface-1">
              <div className="text-sm font-extrabold tracking-tight text-primary flex items-center gap-2">
                <Database className="w-4 h-4 text-violet-600 dark:text-violet-300" />
                Question Bank template review
              </div>
              <p className="mt-1 text-xs text-muted">
                Live interviews pull from the bank using these filters; preview is a sample of the matching pool.
              </p>
              <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Target role</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{suiteTargetRole || jobTitle || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Categories</dt>
                  <dd className="mt-0.5 font-semibold text-primary capitalize">{qbCategories.join(", ") || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Difficulty levels</dt>
                  <dd className="mt-0.5 font-semibold text-primary capitalize">{qbDifficulties.join(", ") || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Questions per interview</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{countModeQuestionsToAsk}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Skills filter</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{requiredSkills || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Randomize</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{qbRandomize ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Avoid duplicates</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{qbAvoidDuplicates ? "Yes" : "No"}</dd>
                </div>
              </dl>
            </div>
            <div className="lg:col-span-5 rounded-card border border-subtle p-5 bg-surface-1">
              <div className="text-sm font-extrabold tracking-tight text-primary">Preview sample ({sampleQuestions.length})</div>
              {sampleQuestions.length ? (
                <ol className="mt-3 space-y-2 text-sm text-secondary list-decimal list-inside max-h-80 overflow-y-auto">
                  {sampleQuestions.map((q, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {q}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-sm text-warning">No preview loaded. Go back to step 2 and run “Preview from Bank”.</p>
              )}
            </div>
          </div>
        ) : step === 3 && questionType === "manual" ? (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 rounded-card border border-subtle p-6 bg-surface-1 shadow-raised">
              <div className="text-sm font-extrabold tracking-tight text-primary">Manual template review</div>
              <p className="mt-1 text-xs text-muted">Recruiter-friendly summary — no AI prompt configuration.</p>
              <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Template name</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{jobTitle || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Target role</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{suiteTargetRole || jobTitle || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Seniority</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{suiteSeniority || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Opportunity ID</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{opportunityId || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Customer name</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{customerName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Question count</dt>
                  <dd className="mt-0.5 font-semibold text-primary">
                    {timingMode === "count" ? countModeQuestionsToAsk : manualQuestionCount}
                    {timingMode === "count" && manualQuestionCount > countModeQuestionsToAsk
                      ? ` (from ${manualQuestionCount} in pool)`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Interview mode</dt>
                  <dd className="mt-0.5 font-semibold text-primary">
                    {interviewMode === "hr" ? "HR Interview" : "Technical Interview"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Interview duration</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{interviewDurationLabel}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Assessment domains</dt>
                  <dd className="mt-0.5 font-semibold text-primary">
                    {assessmentDomainLabels.length ? assessmentDomainLabels.join(", ") : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-widest text-muted">Created date</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{createdDateLabel}</dd>
                </div>
              </dl>
            </div>
            <div className="lg:col-span-5 rounded-card border border-subtle p-5 bg-surface-2">
              <div className="text-sm font-extrabold tracking-tight text-primary">What gets saved</div>
              <p className="mt-2 text-sm text-secondary leading-relaxed">
                This manual template stores your question list, role metadata, timing settings, and scheduling references.
                Candidates receive exactly the questions listed — no AI generation at runtime.
              </p>
            </div>
            <div className="lg:col-span-12 rounded-card border border-subtle bg-success-soft p-6">
              <div className="fx-hairline-b flex flex-wrap items-center justify-between gap-3 pb-2">
                <div className="text-sm font-extrabold tracking-tight text-success">Manual interview questions</div>
                <div className="text-xs font-bold uppercase tracking-widest text-success">
                  Total questions: {manualQuestionCount}
                </div>
              </div>
              {manualQuestionLines.length ? (
                <ul className="mt-4 space-y-2 max-h-96 overflow-auto pr-1">
                  {manualQuestionLines.map((q, idx) => (
                    <li
                      key={`${idx}-${q.slice(0, 32)}`}
                      className="flex items-start gap-2 rounded-card border border-subtle bg-surface-1 px-3 py-2.5 text-sm text-primary shadow-raised"
                    >
                      <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" aria-hidden />
                      <span className="leading-relaxed">
                        <span className="font-bold text-success mr-1">Q{idx + 1}.</span>
                        {q}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-warning">No manual questions added yet. Go back to step 2 to add your list.</p>
              )}
            </div>
          </div>
        ) : step === 3 ? (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 rounded-card border border-subtle p-5 bg-surface-2">
              <div className="text-sm font-extrabold tracking-tight text-primary">Summary</div>
              <div className="mt-3 space-y-2 text-sm text-secondary">
                <div><span className="font-semibold text-primary">Title:</span> {jobTitle || "—"}</div>
                <div><span className="font-semibold text-primary">Domain:</span> {domain || "—"}</div>
                <div><span className="font-semibold text-primary">Opportunity ID:</span> {opportunityId || "—"}</div>
                <div><span className="font-semibold text-primary">Customer:</span> {customerName || "—"}</div>
                <div className="pt-1">
                  <label className="block text-sm font-semibold text-primary mb-1.5">Template Instructions</label>
                  <textarea
                    value={templateInstructions}
                    onChange={(e) => setTemplateInstructions(e.target.value)}
                    rows={4}
                    spellCheck={false}
                    className="w-full input-recessed rounded-control p-3 text-sm leading-relaxed text-primary resize-y min-h-24"
                    placeholder="e.g. Focus on CAN/LIN and UDS diagnostics; use practical embedded scenarios; avoid generic theory."
                  />
                  <p className="mt-1.5 text-xs text-muted">
                    Shown in the AI prompt as <span className="font-mono">Template Instructions</span>. Updates the live prompt preview below when you edit.
                  </p>
                </div>
                <div><span className="font-semibold text-primary">Difficulty:</span> {difficulty}</div>
                <div><span className="font-semibold text-primary">Questions:</span> {numQ}</div>
                <div>
                  <span className="font-semibold text-primary">Timing:</span>{" "}
                  {!timingMode
                    ? "—"
                    : timingMode === "time"
                      ? `${timeLimitMin} min limit`
                      : `Fixed question count (${numQ})`}
                </div>
                <div><span className="font-semibold text-primary">Mic:</span> Auto-activated after each question</div>
                <div><span className="font-semibold text-primary">Transcript input:</span> {showSpokenText ? "Enabled" : "Hidden"}</div>
                <div><span className="font-semibold text-primary">Interview mode:</span> {interviewMode === "hr" ? "HR Interview" : "Technical Interview"}</div>
                <div><span className="font-semibold text-primary">Required skills:</span> {requiredSkills || "—"}</div>
                <div><span className="font-semibold text-primary">Optional skills:</span> {optionalSkills || "—"}</div>
                <div>
                  <span className="font-semibold text-primary">Experience range:</span>{" "}
                  {expMax > 0 ? `${expMin}–${expMax} years` : expMin > 0 ? `${expMin}+ years` : "Any / not set"}
                </div>
                <div>
                  <span className="font-semibold text-primary">Question type:</span>{" "}
                  {questionType === "manual"
                    ? "Manual Questions"
                    : questionType === "question_bank"
                      ? "Question Bank"
                      : "Dynamic Questions"}
                </div>
                <div>
                  <span className="font-semibold text-primary">Intelligence suite:</span>{" "}
                  {selectedCategoryIds.length
                    ? `${selectedCategoryIds.length} domain(s) — ${suiteTargetRole || jobTitle || "—"}`
                    : "—"}
                </div>
                <div>
                  <span className="font-semibold text-primary">Adaptive next question:</span>{" "}
                  {adaptiveNextQuestion ? "Enabled" : "Disabled"}
                </div>
                {suiteSeniority ? (
                  <div>
                    <span className="font-semibold text-primary">Seniority:</span> {suiteSeniority}
                  </div>
                ) : null}
                {suiteTechStack ? (
                  <div>
                    <span className="font-semibold text-primary">Stack emphasis:</span> {suiteTechStack}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="lg:col-span-5 rounded-card border border-subtle p-5">
              <div className="text-sm font-extrabold tracking-tight text-primary">What gets saved</div>
              <div className="mt-2 text-sm text-muted">
                This template stores interview setup fields, template instructions for AI prompts, opportunity/customer references, and interview configuration.
              </div>
            </div>

            <div className="fx-gradient-border-animated lg:col-span-12 rounded-card bg-surface-1 text-primary p-5 shadow-raised">
              <button
                type="button"
                onClick={() => setPromptExpanded((v) => !v)}
                className="w-full flex items-center justify-between gap-3 text-left"
              >
                <div>
                  <div className="flex items-center gap-2 text-sm font-extrabold tracking-tight text-primary">
                    AI Prompt Configuration
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-accent-600 ring-1 ring-inset ring-subtle dark:text-accent-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
                      AI
                    </span>
                  </div>
                  <div className="text-xs text-muted mt-1">
                    Review and customize the exact prompt used for AI question generation.
                  </div>
                </div>
                <div className="text-muted">{promptExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</div>
              </button>

              {promptExpanded ? (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-xs text-muted">
                      Characters: <span className="font-semibold tabular-nums text-secondary">{promptCharCount}</span> | Tokens (est):{" "}
                      <span className="font-semibold tabular-nums text-secondary">{promptTokenEstimate}</span> | Version:{" "}
                      <span className="font-semibold tabular-nums text-secondary">{promptVersion}</span>
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs text-secondary">
                      <input
                        type="checkbox"
                        checked={adaptiveNextQuestion}
                        onChange={(e) => setAdaptiveNextQuestion(e.target.checked)}
                        disabled={questionType === "question_bank"}
                        className="rounded border-strong text-brand-500 disabled:opacity-40"
                      />
                      Adaptive next-question mode
                      {questionType === "question_bank" ? (
                        <span className="text-muted">(disabled for Question Bank)</span>
                      ) : null}
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText((promptPreview || editedPrompt || generatedPrompt || "").trim())}
                        className="h-8 px-3 rounded-control border border-subtle bg-surface-2 text-secondary transition-colors duration-micro ease-smooth hover:bg-surface-3 hover:text-primary text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy Prompt
                      </button>
                      <button
                        type="button"
                        onClick={resetPromptToDefault}
                        className="h-8 px-3 rounded-control border border-subtle bg-surface-2 text-secondary transition-colors duration-micro ease-smooth hover:bg-surface-3 hover:text-primary text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Reset to Default
                      </button>
                      <button
                        type="button"
                        onClick={testPrompt}
                        disabled={promptTestBusy}
                        className="h-8 px-3 rounded-control border border-subtle bg-brand-50 text-brand-700 transition-colors duration-micro ease-smooth hover:bg-brand-100 text-xs font-semibold dark:bg-brand-900 dark:text-brand-200 dark:hover:bg-brand-800"
                      >
                        {promptTestBusy ? "Generating 15–20…" : "Test Prompt (15–20)"}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-widest font-bold text-muted mb-1.5">Editable Prompt</div>
                    <textarea
                      value={editedPrompt}
                      onChange={(e) => {
                        promptDraftTouchedRef.current = true;
                        setEditedPrompt(e.target.value);
                      }}
                      rows={12}
                      spellCheck={false}
                      className="input-recessed w-full rounded-control p-3 text-sm leading-6 font-mono text-primary resize-y min-h-56 max-h-screen overflow-auto"
                      placeholder={generatedPrompt || "Generating default prompt..."}
                    />
                    <div className="mt-1.5 text-xs text-muted">
                      Leave blank to use the generated default prompt. Custom prompt is sanitized and size-limited before save.
                    </div>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-widest font-bold text-muted mb-1.5">Live Prompt Preview</div>
                    <pre className="w-full rounded-card border border-subtle bg-surface-2 p-3 text-xs leading-6 font-mono text-secondary overflow-auto max-h-80 whitespace-pre-wrap">
                      {promptBusy ? "Refreshing prompt preview..." : promptPreview || generatedPrompt || "No prompt yet."}
                    </pre>
                  </div>

                  {promptTestQuestions.length > 0 ? (
                    <div className="rounded-card border border-subtle bg-success-soft p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-xs uppercase tracking-widest font-bold text-success">
                          Sample Output ({promptTestQuestions.length} questions)
                        </div>
                        <div className="text-xs text-success">Preview only — not saved to the template</div>
                      </div>
                      <ol className="space-y-2 text-sm text-secondary list-decimal list-inside max-h-96 overflow-auto">
                        {promptTestQuestions.map((q, idx) => (
                          <li key={`${idx}-${q.slice(0, 24)}`} className="leading-relaxed">
                            {q}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

