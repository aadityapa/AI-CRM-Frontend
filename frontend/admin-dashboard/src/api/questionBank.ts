import { apiGet, authFetch, invalidateApiCache } from "./client";

export type QuestionBankItem = {
  id: string;
  role?: string;
  roleName?: string;
  skill?: string;
  skillName?: string;
  difficulty: string;
  category: string;
  question: string;
  expectedAnswer: string;
  keywords: string;
  isActive: boolean;
  approvalStatus?: string;
  version?: number;
  qualityScore?: number | string;
  createdAt?: string;
};

export type QuestionBankDashboard = {
  totalQuestions: number;
  activeQuestions: number;
  inactiveQuestions: number;
  skillsCount: number;
  rolesCount?: number;
  duplicateQuestions: number;
  failedImports: number;
  recentUploads?: unknown[];
};

export type CsvUploadResult = {
  uploadId?: string;
  fileName?: string;
  totalRecords: number;
  successRecords: number;
  failedRecords: number;
  updatedRecords?: number;
  status?: string;
  errorReportPath?: string;
  warnings?: string[];
  errors?: string[];
};

export type QuestionListParams = {
  page?: number;
  pageSize?: number;
  role?: string;
  skill?: string;
  difficulty?: string;
  category?: string;
  search?: string;
  isActive?: string;
  approvalStatus?: string;
};

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function fetchQuestionBankDashboard(): Promise<QuestionBankDashboard> {
  return apiGet<QuestionBankDashboard>("/api/question-bank/dashboard", { force: true });
}

export async function fetchQuestions(params: QuestionListParams = {}) {
  const query = qs({
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 25,
    role: params.role,
    skill: params.skill,
    difficulty: params.difficulty,
    category: params.category,
    search: params.search,
    isActive: params.isActive,
    approvalStatus: params.approvalStatus,
  });
  return apiGet<{ items: QuestionBankItem[]; total: number; page: number; pageSize: number }>(
    `/api/question-bank/questions${query}`,
    { force: true },
  );
}

export async function fetchRolesFromBank(): Promise<string[]> {
  const data = await apiGet<{ roles: string[] }>("/api/question-bank/roles", { force: true });
  return Array.isArray(data.roles) ? data.roles : [];
}

export async function fetchQuestionBankSkills(role?: string): Promise<string[]> {
  const query = role ? `?role=${encodeURIComponent(role)}` : "";
  const data = await apiGet<{ skills: string[] }>(`/api/question-bank/skills${query}`, { force: true });
  return Array.isArray(data.skills) ? data.skills : [];
}

export async function createQuestion(payload: Partial<QuestionBankItem>): Promise<QuestionBankItem> {
  const res = await authFetch("/api/question-bank/questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error || `Create failed (${res.status})`);
  invalidateApiCache("/api/question-bank");
  return data;
}

export async function updateQuestion(id: string, payload: Partial<QuestionBankItem>): Promise<QuestionBankItem> {
  const res = await authFetch(`/api/question-bank/questions/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error || `Update failed (${res.status})`);
  invalidateApiCache("/api/question-bank");
  return data;
}

export async function deleteQuestion(id: string): Promise<void> {
  const res = await authFetch(`/api/question-bank/questions/${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error || `Delete failed (${res.status})`);
  invalidateApiCache("/api/question-bank");
}

export async function setQuestionActive(id: string, active: boolean): Promise<QuestionBankItem> {
  const action = active ? "activate" : "deactivate";
  const res = await authFetch(`/api/question-bank/questions/${encodeURIComponent(id)}/${action}`, {
    method: "PATCH",
  });
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error || `Update failed (${res.status})`);
  invalidateApiCache("/api/question-bank");
  return data;
}

export async function uploadQuestionBankCsv(file: File): Promise<CsvUploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await authFetch("/api/question-bank/import/csv", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error || `Upload failed (${res.status})`);
  invalidateApiCache("/api/question-bank");
  return { ...data, fileName: file.name };
}

export async function exportQuestionBankCsv(): Promise<Blob> {
  const res = await authFetch("/api/question-bank/export");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Export failed (${res.status})`);
  }
  return res.blob();
}

export async function seedSampleQuestions(): Promise<CsvUploadResult> {
  const res = await authFetch("/api/question-bank/seed-sample", { method: "POST" });
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error || `Seed failed (${res.status})`);
  invalidateApiCache("/api/question-bank");
  return data;
}

export type QuestionBankPreviewMatch = {
  id?: string;
  role?: string;
  skill?: string;
  difficulty?: string;
  category?: string;
  question?: string;
};

export type QuestionBankPreviewParams = {
  role: string;
  requiredSkills: string;
  optionalSkills?: string;
  categories: string[];
  difficulties: string[];
  questionCount: number;
  randomizationEnabled: boolean;
  avoidDuplicateQuestions: boolean;
  excludedQuestionIds?: string[];
};

export type QuestionBankPreviewResult = {
  questions: string[];
  matches: QuestionBankPreviewMatch[];
  totalMatched: number;
  poolTotal: number;
  skillsUsed?: string[];
};

export async function previewQuestionBankFromTemplate(
  params: QuestionBankPreviewParams,
): Promise<QuestionBankPreviewResult> {
  const fd = new FormData();
  fd.append("role", params.role);
  fd.append("requiredSkills", params.requiredSkills);
  fd.append("optionalSkills", params.optionalSkills || "");
  fd.append("categories", params.categories.join(","));
  fd.append("difficulties", params.difficulties.join(","));
  fd.append("questionCount", String(params.questionCount));
  fd.append("randomizationEnabled", params.randomizationEnabled ? "true" : "false");
  fd.append("avoidDuplicateQuestions", params.avoidDuplicateQuestions ? "true" : "false");
  if (params.excludedQuestionIds?.length) {
    fd.append("excludedQuestionIds", params.excludedQuestionIds.join(","));
  }
  const res = await authFetch("/job/template/question-bank/preview", { method: "POST", body: fd });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  if (!res.ok || data?.error) {
    throw new Error(String(data?.error || `Preview failed (${res.status})`));
  }
  const questions = Array.isArray(data.questions) ? data.questions.map((q) => String(q)).filter(Boolean) : [];
  const matches = Array.isArray(data.matches) ? (data.matches as QuestionBankPreviewMatch[]) : [];
  return {
    questions,
    matches,
    totalMatched: Number(data.totalMatched || questions.length),
    poolTotal: Number(data.poolTotal || data.totalMatched || questions.length),
    skillsUsed: Array.isArray(data.skillsUsed) ? data.skillsUsed.map((s) => String(s)) : [],
  };
}
