import { useEffect, useMemo, useState } from "react";
import {
  Database,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  createQuestion,
  deleteQuestion,
  exportQuestionBankCsv,
  fetchQuestionBankDashboard,
  fetchQuestionBankSkills,
  fetchQuestions,
  fetchRolesFromBank,
  setQuestionActive,
  updateQuestion,
  seedSampleQuestions,
  uploadQuestionBankCsv,
  type CsvUploadResult,
  type QuestionBankDashboard,
  type QuestionBankItem,
} from "../api/questionBank";

const PAGE_SIZE = 25;

export function QuestionBankPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<QuestionBankDashboard | null>(null);
  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [skills, setSkills] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [filterRole, setFilterRole] = useState("");
  const [filterSkill, setFilterSkill] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterApproval, setFilterApproval] = useState("");
  const [filterActive, setFilterActive] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<QuestionBankItem | null>(null);
  const [uploadResult, setUploadResult] = useState<CsvUploadResult | null>(null);
  const [form, setForm] = useState({
    roleName: "",
    skill: "",
    difficulty: "medium",
    category: "technical",
    question: "",
    expectedAnswer: "",
    keywords: "",
    isActive: true,
  });
  const [saving, setSaving] = useState(false);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [dash, list, skillList, roleList] = await Promise.all([
        fetchQuestionBankDashboard(),
        fetchQuestions({
          page,
          pageSize: PAGE_SIZE,
          role: filterRole,
          skill: filterSkill,
          difficulty: filterDifficulty,
          category: filterCategory,
          search: filterSearch,
          isActive: filterActive,
          approvalStatus: filterApproval,
        }),
        fetchQuestionBankSkills(filterRole || undefined),
        fetchRolesFromBank(),
      ]);
      setDashboard(dash);
      setItems(list.items || []);
      setTotal(list.total || 0);
      setSkills(skillList);
      setRoles(roleList);
    } catch (e: unknown) {
      setError(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterRole, filterSkill, filterDifficulty, filterCategory, filterActive, filterApproval, filterSearch]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      roleName: "",
      skill: "",
      difficulty: "medium",
      category: "technical",
      question: "",
      expectedAnswer: "",
      keywords: "",
      isActive: true,
    });
    setEditorOpen(true);
  };

  const openEdit = (item: QuestionBankItem) => {
    setEditing(item);
    setForm({
      roleName: item.role || item.roleName || "",
      skill: item.skill || item.skillName || "",
      difficulty: item.difficulty,
      category: item.category,
      question: item.question,
      expectedAnswer: item.expectedAnswer,
      keywords: item.keywords,
      isActive: item.isActive,
    });
    setEditorOpen(true);
  };

  const saveForm = async () => {
    try {
      setSaving(true);
      setError("");
      if (editing) {
        await updateQuestion(editing.id, form);
      } else {
        await createQuestion(form);
      }
      setEditorOpen(false);
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm("Delete this question permanently?")) return;
    try {
      await deleteQuestion(id);
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message || e));
    }
  };

  const onToggleActive = async (item: QuestionBankItem) => {
    try {
      await setQuestionActive(item.id, !item.isActive);
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message || e));
    }
  };

  const onSeedSample = async () => {
    try {
      setSeedBusy(true);
      setError("");
      const result = await seedSampleQuestions();
      const msg = `Sample seed: ${result.successRecords}/${result.totalRecords} imported.`;
      if (result.failedRecords > 0) {
        setError(`${msg} ${result.failedRecords} duplicate or invalid row(s) skipped.`);
      }
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message || e));
    } finally {
      setSeedBusy(false);
    }
  };

  const onUpload = async (file: File | null) => {
    if (!file) return;
    try {
      setUploadBusy(true);
      setError("");
      const result = await uploadQuestionBankCsv(file);
      setUploadResult(result);
      const msg = `Imported ${result.successRecords}/${result.totalRecords} records.`;
      if (result.failedRecords && result.failedRecords > 0) {
        setError(`${msg} ${result.failedRecords} row(s) failed — see upload report below.`);
      } else {
        setError("");
      }
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message || e));
    } finally {
      setUploadBusy(false);
    }
  };

  const onExport = async () => {
    try {
      setExportBusy(true);
      const blob = await exportQuestionBankCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "question_bank_export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(String((e as Error)?.message || e));
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-screen-2xl w-full px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
        <div>
          <h1 className="text-display text-2xl font-bold tracking-tight text-primary">Question Bank</h1>
          <p className="text-muted text-sm mt-1">
            Super Admin only — centralized questions for Question Bank interview mode.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-control border border-subtle bg-surface-1 px-4 py-2.5 font-semibold text-secondary transition-colors duration-micro ease-smooth hover:border-strong hover:bg-surface-2 hover:text-primary disabled:opacity-60"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={onSeedSample}
            disabled={seedBusy}
            className="inline-flex items-center gap-2 rounded-control border border-subtle bg-surface-1 px-4 py-2.5 font-semibold text-secondary transition-colors duration-micro ease-smooth hover:border-strong hover:bg-surface-2 hover:text-primary disabled:opacity-60"
          >
            {seedBusy ? "Seeding…" : "Load sample data"}
          </button>
          <label className="inline-flex items-center gap-2 rounded-control border border-subtle bg-surface-1 px-4 py-2.5 font-semibold text-secondary transition-colors duration-micro ease-smooth hover:border-strong hover:bg-surface-2 hover:text-primary cursor-pointer">
            <Upload className="w-4 h-4" />
            {uploadBusy ? "Uploading…" : "Import CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={uploadBusy}
              onChange={(e) => onUpload(e.target.files?.[0] || null)}
            />
          </label>
          <button
            onClick={onExport}
            disabled={exportBusy}
            className="inline-flex items-center gap-2 rounded-control border border-subtle bg-surface-1 px-4 py-2.5 font-semibold text-secondary transition-colors duration-micro ease-smooth hover:border-strong hover:bg-surface-2 hover:text-primary disabled:opacity-60"
          >
            <Download className="w-4 h-4" /> Export
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 btn-depth btn-gradient rounded-control bg-brand-600 px-4 py-2.5 font-semibold text-white"
          >
            <Plus className="w-4 h-4" /> Add Question
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded-card border border-subtle bg-danger-soft p-6 text-danger text-sm">{error}</div>
      ) : null}

      {dashboard ? (
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[
            ["Total", dashboard.totalQuestions],
            ["Active", dashboard.activeQuestions],
            ["Inactive", dashboard.inactiveQuestions],
            ["Skills", dashboard.skillsCount],
            ["Duplicates", dashboard.duplicateQuestions],
            ["Failed imports", dashboard.failedImports],
          ].map(([label, val]) => (
            <div key={String(label)} className="glass fx-gradient-border fx-lift rounded-card p-4 shadow-raised">
              <div className="text-xs font-bold uppercase tracking-widest text-muted">{label}</div>
              <div className="text-display text-2xl font-bold tabular-nums mt-1 text-primary">{val}</div>
            </div>
          ))}
        </div>
      ) : null}

      {uploadResult ? (
        <div className="mt-6 rounded-card border border-subtle bg-surface-1 p-5 shadow-raised">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-extrabold text-primary">Last CSV upload</h2>
            <button
              onClick={() => setUploadResult(null)}
              className="text-xs font-semibold text-muted hover:text-primary"
            >
              Dismiss
            </button>
          </div>
          <p className="text-sm text-secondary mt-2">
            {uploadResult.fileName}: {uploadResult.successRecords}/{uploadResult.totalRecords} imported
            {uploadResult.failedRecords ? ` · ${uploadResult.failedRecords} failed` : ""}
          </p>
          {Array.isArray(uploadResult.warnings) && uploadResult.warnings.length > 0 ? (
            <ul className="mt-3 max-h-32 overflow-y-auto text-xs text-warning space-y-1 list-disc pl-5">
              {uploadResult.warnings.slice(0, 30).map((line, i) => (
                <li key={`w-${line}-${i}`}>{line}</li>
              ))}
            </ul>
          ) : null}
          {Array.isArray(uploadResult.errors) && uploadResult.errors.length > 0 ? (
            <ul className="mt-3 max-h-40 overflow-y-auto text-xs text-danger space-y-1 list-disc pl-5">
              {uploadResult.errors.slice(0, 50).map((line, i) => (
                <li key={`${line}-${i}`}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 glass rounded-card p-4 shadow-raised">
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          <input
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Search question, keywords, role, skill"
            className="h-10 px-3 input-recessed rounded-control text-sm text-primary"
          />
          <select
            value={filterRole}
            onChange={(e) => {
              setPage(1);
              setFilterRole(e.target.value);
              setFilterSkill("");
            }}
            className="h-10 px-3 input-recessed rounded-control text-sm text-primary"
          >
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={filterSkill}
            onChange={(e) => {
              setPage(1);
              setFilterSkill(e.target.value);
            }}
            className="h-10 px-3 input-recessed rounded-control text-sm text-primary"
          >
            <option value="">All skills</option>
            {skills.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={filterDifficulty}
            onChange={(e) => {
              setPage(1);
              setFilterDifficulty(e.target.value);
            }}
            className="h-10 px-3 input-recessed rounded-control text-sm text-primary"
          >
            <option value="">All difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <select
            value={filterCategory}
            onChange={(e) => {
              setPage(1);
              setFilterCategory(e.target.value);
            }}
            className="h-10 px-3 input-recessed rounded-control text-sm text-primary"
          >
            <option value="">All categories</option>
            <option value="technical">Technical</option>
            <option value="behavioral">Behavioral</option>
            <option value="situational">Situational</option>
            <option value="general">General</option>
          </select>
          <select
            value={filterActive}
            onChange={(e) => {
              setPage(1);
              setFilterActive(e.target.value);
            }}
            className="h-10 px-3 input-recessed rounded-control text-sm text-primary"
          >
            <option value="">All status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
          <select
            value={filterApproval}
            onChange={(e) => {
              setPage(1);
              setFilterApproval(e.target.value);
            }}
            className="h-10 px-3 input-recessed rounded-control text-sm text-primary"
          >
            <option value="">All approval</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending review</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => {
              setPage(1);
              load();
            }}
            className="btn-depth btn-gradient rounded-control bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Apply filters
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-card border border-subtle bg-surface-1 shadow-raised overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm lg:min-w-0">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-widest text-muted">
              <tr>
                <th className="px-4 py-3">Question</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Skill</th>
                <th className="px-4 py-3">Difficulty</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Quality</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted">
                    <Database className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    No questions found.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="row-hover border-t border-subtle align-top transition-colors duration-micro ease-smooth">
                    <td className="px-4 py-3 max-w-md">
                      <div className="font-semibold text-primary line-clamp-2">{item.question}</div>
                    </td>
                    <td className="px-4 py-3">{item.role || item.roleName || "—"}</td>
                    <td className="px-4 py-3">{item.skill || item.skillName || "—"}</td>
                    <td className="px-4 py-3 capitalize">{item.difficulty}</td>
                    <td className="px-4 py-3 capitalize">{item.category}</td>
                    <td className="px-4 py-3 text-xs">{item.qualityScore || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${
                          item.isActive ? "bg-success-soft text-success" : "bg-surface-2 text-secondary"
                        }`}
                      >
                        {item.isActive ? "Active" : "Inactive"}
                      </span>
                      {item.approvalStatus && item.approvalStatus !== "approved" ? (
                        <div className="text-xs text-warning mt-1 capitalize">
                          {item.approvalStatus.replace("_", " ")}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{item.createdAt?.slice(0, 10) || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(item)}
                          className="p-2 rounded-control hover:bg-surface-2"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onToggleActive(item)}
                          className="px-2 py-1 rounded-control text-xs font-bold border border-subtle hover:bg-surface-2"
                        >
                          {item.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => onDelete(item.id)}
                          className="p-2 rounded-control hover:bg-danger-soft text-danger"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-subtle text-sm">
          <span className="text-muted">
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-control border border-subtle hover:bg-surface-2 transition disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-control border border-subtle hover:bg-surface-2 transition disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {editorOpen ? (
        <div className="fixed inset-0 z-50 bg-backdrop flex items-center justify-center p-4">
          <div className="bg-surface-1 rounded-modal border border-subtle shadow-modal w-full max-w-2xl max-h-full overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-extrabold">{editing ? "Edit Question" : "Add Question"}</h2>
              <button onClick={() => setEditorOpen(false)} className="p-2 rounded-control hover:bg-surface-2">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="h-10 px-3 input-recessed rounded-control text-sm text-primary"
                placeholder="Role"
                value={form.roleName}
                onChange={(e) => setForm((f) => ({ ...f, roleName: e.target.value }))}
              />
              <input
                className="h-10 px-3 input-recessed rounded-control text-sm text-primary"
                placeholder="Skill"
                value={form.skill}
                onChange={(e) => setForm((f) => ({ ...f, skill: e.target.value }))}
              />
              <select
                className="h-10 px-3 input-recessed rounded-control text-sm text-primary"
                value={form.difficulty}
                onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
              <select
                className="h-10 px-3 input-recessed rounded-control text-sm text-primary"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                <option value="technical">Technical</option>
                <option value="behavioral">Behavioral</option>
                <option value="situational">Situational</option>
                <option value="general">General</option>
              </select>
              <label className="flex items-center gap-2 text-sm font-semibold md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                Active
              </label>
            </div>
            <textarea
              className="mt-3 w-full p-3 input-recessed rounded-control text-sm text-primary min-h-24"
              placeholder="Question"
              value={form.question}
              onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
            />
            <textarea
              className="mt-3 w-full p-3 input-recessed rounded-control text-sm text-primary min-h-24"
              placeholder="Expected answer (optional — AI can generate if empty)"
              value={form.expectedAnswer}
              onChange={(e) => setForm((f) => ({ ...f, expectedAnswer: e.target.value }))}
            />
            <input
              className="mt-3 w-full h-10 px-3 input-recessed rounded-control text-sm text-primary"
              placeholder="Keywords (comma-separated)"
              value={form.keywords}
              onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setEditorOpen(false)}
                className="px-4 py-2 rounded-control border border-subtle font-semibold hover:bg-surface-2 transition"
              >
                Cancel
              </button>
              <button
                onClick={saveForm}
                disabled={saving}
                className="btn-depth btn-gradient rounded-control bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
