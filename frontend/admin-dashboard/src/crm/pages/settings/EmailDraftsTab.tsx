/**
 * Settings → Email Drafts — every email the system sends, editable in one
 * place (28 Aug 2026), reworked 3 Sep 2026 (user requests):
 *
 *   Candidate emails   open PREFILLED with the current built-in wording, so
 *                      the admin edits real text. Saving text identical to
 *                      the built-in stores nothing (the code default keeps
 *                      applying); anything else is saved as the draft.
 *   Internal emails    show the LAYOUT every notification is composed with
 *                      ({title} {message} {details} {action}…) plus the last
 *                      one actually sent, as a worked example of the format.
 *   Custom drafts      the admin's own emails ("if I want any another email")
 *                      — created here, offered in every composer as
 *                      "Use a draft". Nothing sends them automatically.
 *
 * Layout (3 Sep 2026, "full size, attractive"): a template studio — a draft
 * list down the left, the editor in the middle and a live preview of the
 * email (sample values filled in) on the right, using the whole page.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bell, ChevronDown, ChevronUp, Eye, Mail, PenLine, Plus, RotateCcw, Save, Search, Sparkles,
  Trash2, UserRound,
} from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut } from "../../api";
import { ActionError, ConfirmModal, ErrorBox, Modal, Spinner, btnPrimary, btnSecondary, inputCls } from "../../components/ui";

type Notify = (msg: string, kind?: "ok" | "err") => void;

export type EmailFlow = {
  event: string;
  label: string;
  description: string;
  kind: "internal" | "candidate" | "custom";
  tokens: string[];
  roles: string[];
  extra_emails: string[];
  enabled: boolean;
  subject_template?: string | null;
  body_template?: string | null;
  /** The CURRENT built-in wording — what goes out today when nothing is
   * saved. Placeholders are left as {token}. Null for custom drafts. */
  default_subject?: string | null;
  default_body?: string | null;
  /** Internal notifications: the most recent one actually sent. */
  last_sent?: { subject: string; body: string; to: string; sent_at?: string | null; status: string } | null;
  customized: boolean;
};

type Draft = { subject: string; body: string; label?: string; description?: string };

/** What the editor shows: the saved draft, else the built-in. */
const shownDraft = (f: EmailFlow): Draft => ({
  subject: f.subject_template || f.default_subject || "",
  body: f.body_template || f.default_body || "",
  label: f.label,
  description: f.kind === "custom" ? f.description : undefined,
});

const fmtWhen = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";

/** Sample values for the live preview — realistic, obviously fictional. */
const SAMPLE: Record<string, string> = {
  candidate: "Asha Rao", first_name: "Asha", full_name: "Asha Rao", email: "asha.rao@example.com",
  role: "Senior Java Developer", customer: "Visteon", sender: "Karan Singh",
  sender_designation: "Talent Acquisition Lead", sender_department: "Human Resources",
  sender_phone: "+91 98765 43210", sender_email: "karan.singh@karnex.in",
  company: "Karnex", company_name: "Karnex Software Solutions PVT LTD", company_website: "https://karnex.in/",
  link: "https://karnex.in/book/x7Qk9…", access_key: "K7X-42QD", when: "Mon, 8 Sep 2026, 10:30 AM IST",
  level: "L1 — AI Screening Interview", duration: "45 minutes", round: "Customer L1 Interview",
  team: "engineering", interviewer: "Ravi Teja", note: "Please keep your ID proof handy.",
  // internal notification parts
  subject: "Timesheet submitted for approval — Asha Rao, August 2026",
  title: "Timesheet submitted for approval",
  message: "Asha Rao submitted the August 2026 timesheet for Visteon. Please review and approve.",
  details: "Project: Visteon ADAS\nPeriod: 01 Aug – 31 Aug 2026\nHours: 176",
  action: "Open in Karnex: https://karnex.in/admin?view=crm&p=timesheets/42",
  recipient: "Karan",
  body: "Timesheet submitted for approval\n\nAsha Rao submitted the August 2026 timesheet for Visteon.\n\n— Karnex",
};

const fillSample = (text: string) =>
  (text || "")
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => SAMPLE[k.toLowerCase()] ?? m)
    .replace(/\{([a-z_]+)\}/gi, (m, k: string) => SAMPLE[k.toLowerCase()] ?? m);

const GROUPS: { kind: EmailFlow["kind"]; title: string; icon: typeof Mail; hint: string }[] = [
  { kind: "candidate", title: "Candidate emails", icon: UserRound,
    hint: "What candidates receive — shown exactly as it goes out today." },
  { kind: "custom", title: "Your own drafts", icon: PenLine,
    hint: "Emails you write yourself, offered as “Use a draft” in every composer." },
  { kind: "internal", title: "Internal notifications", icon: Bell,
    hint: "What your team receives. The layout is editable; open the last sent example to see the real email." },
];

export function EmailDraftsTab({ notify }: { notify: Notify }) {
  const [flows, setFlows] = useState<EmailFlow[]>([]);
  const [customTokens, setCustomTokens] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingEvent, setSavingEvent] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [exampleOpen, setExampleOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteFlow, setDeleteFlow] = useState<EmailFlow | null>(null);

  const load = useCallback((keep?: string | null) => {
    let alive = true;
    setLoading(true);
    crmGet<{ flows: EmailFlow[]; custom_tokens?: string[] }>("/api/email-flows")
      .then((r) => {
        if (!alive) return;
        const fl = r.data?.flows || [];
        setFlows(fl);
        setCustomTokens(r.data?.custom_tokens || []);
        const d: Record<string, Draft> = {};
        fl.forEach((f) => { d[f.event] = shownDraft(f); });
        setDrafts(d);
        setSelected((prev) => {
          const want = keep ?? prev;
          return want && fl.some((f) => f.event === want) ? want : (fl[0]?.event ?? null);
        });
        setError("");
      })
      .catch((e: any) => { if (alive) setError(e?.message || "Failed to load email drafts"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => load(), [load]);

  const save = async (f: EmailFlow, reset = false) => {
    setSavingEvent(f.event);
    try {
      const d = reset ? { subject: "", body: "" } : drafts[f.event] || { subject: "", body: "" };
      // Text equal to the built-in is NOT stored — the code default keeps
      // applying, so a later wording fix in code still reaches people.
      const isCustomDraft = f.kind === "custom";
      const subj = !isCustomDraft && d.subject.trim() === (f.default_subject || "").trim() ? "" : d.subject;
      const body = !isCustomDraft && d.body.trim() === (f.default_body || "").trim() ? "" : d.body;
      await crmPut(`/api/email-flows/${f.event}`, {
        roles: f.roles, extra_emails: f.extra_emails, enabled: f.enabled,
        subject_template: subj || null, body_template: body || null,
        ...(isCustomDraft ? { label: d.label, description: d.description ?? "" } : {}),
      });
      notify(reset ? `${f.label} — back to the built-in wording` : `${d.label || f.label} — draft saved`);
      load(f.event);
    } catch (e: any) {
      notify(e?.message || "Failed to save draft", "err");
    } finally {
      setSavingEvent(null);
    }
  };

  const remove = async (f: EmailFlow) => {
    setSavingEvent(f.event);
    try {
      const res = await crmDelete(`/api/email-flows/${f.event}`);
      notify(res.message || "Draft deleted");
      setDeleteFlow(null);
      load(null);
    } catch (e: any) {
      notify(e?.message || "Failed to delete draft", "err");
    } finally {
      setSavingEvent(null);
    }
  };

  const setDraft = (event: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [event]: { ...prev[event], ...patch } }));

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return flows;
    return flows.filter((f) => [f.label, f.description, f.event, drafts[f.event]?.subject]
      .some((v) => String(v || "").toLowerCase().includes(t)));
  }, [flows, drafts, q]);

  const current = flows.find((f) => f.event === selected) || null;
  const d = current ? (drafts[current.event] || { subject: "", body: "" }) : null;
  const base = current ? shownDraft(current) : null;
  const dirty = !!(current && d && base && (
    (d.subject || "") !== base.subject || (d.body || "") !== base.body
    || (current.kind === "custom" && ((d.label || "") !== (base.label || "") || (d.description || "") !== (base.description || "")))
  ));
  const isCustomised = !!(current && current.kind !== "custom" && (current.subject_template || current.body_template));

  const statusPill = (f: EmailFlow) => {
    if (f.kind === "custom") return <span className="rounded-full bg-brand-600/10 px-1.5 py-px text-[10px] font-bold text-brand-700 dark:text-brand-300">Yours</span>;
    if (f.subject_template || f.body_template) return <span className="rounded-full bg-info-soft px-1.5 py-px text-[10px] font-bold text-info">Customised</span>;
    if (f.kind === "internal" && !f.enabled) return <span className="rounded-full bg-danger-soft px-1.5 py-px text-[10px] font-bold text-danger">Disabled</span>;
    return null;
  };

  if (loading && flows.length === 0) return <Spinner label="Loading email drafts…" />;
  if (error) return <ErrorBox error={error} onRetry={() => load()} />;

  const kindTitle = (k: EmailFlow["kind"]) => GROUPS.find((g) => g.kind === k)?.title || "";

  return (
    <div className="flex min-h-[calc(100vh-15rem)] flex-col">
      {/* ------------------------------------------------ header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-bold text-primary">
            <Sparkles size={16} className="text-brand-600 dark:text-brand-300" /> Email Drafts
          </h2>
          <p className="text-xs text-muted">
            Every email Karnex sends, in one place. Pick a draft, edit the words, watch the preview, save.
            Placeholders in {"{braces}"} fill in at send time.
          </p>
        </div>
        <div className="flex w-64 items-center gap-2 rounded-control border border-subtle bg-surface-1 px-3">
          <Search size={14} className="shrink-0 text-muted" />
          <input className="h-9 w-full bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
            placeholder="Search drafts…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className={btnPrimary} onClick={() => setCreating(true)}>
          <Plus size={14} /> New draft
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* ------------------------------------------------ draft list */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {GROUPS.map((g) => {
              const items = filtered.filter((f) => f.kind === g.kind);
              if (items.length === 0 && q) return null;
              return (
                <div key={g.kind}>
                  <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-subtle bg-surface-2/80 px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-muted backdrop-blur">
                    <g.icon size={12} /> {g.title}
                    <span className="ml-auto rounded-full bg-surface-1 px-1.5 text-[10px] font-bold text-muted">{items.length}</span>
                  </div>
                  {items.length === 0 && (
                    <p className="px-3.5 py-2 text-xs text-muted">
                      {g.kind === "custom" ? "None yet — click “New draft”." : "Nothing here."}
                    </p>
                  )}
                  {items.map((f) => {
                    const active = f.event === selected;
                    const unsaved = (() => {
                      const dd = drafts[f.event]; const bb = shownDraft(f);
                      return !!dd && ((dd.subject || "") !== bb.subject || (dd.body || "") !== bb.body);
                    })();
                    return (
                      <button key={f.event} type="button" onClick={() => { setSelected(f.event); setExampleOpen(false); }}
                        className={`block w-full border-b border-subtle border-l-2 px-3.5 py-2.5 text-left transition-colors duration-micro ${
                          active ? "border-l-brand-600 bg-brand-600/10" : "border-l-transparent hover:bg-surface-2"}`}>
                        <div className="flex items-center gap-2">
                          <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${active ? "text-primary" : "text-secondary"}`}>
                            {drafts[f.event]?.label || f.label}
                          </span>
                          {unsaved && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Unsaved changes" />}
                          {statusPill(f)}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-muted">{drafts[f.event]?.subject || f.default_subject || f.description}</div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* ------------------------------------------------ editor */}
        {!current || !d ? (
          <div className="flex items-center justify-center rounded-card border border-subtle bg-surface-1 text-sm text-muted xl:col-span-2">
            Select a draft to edit it.
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-col overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
              <div className="border-b border-subtle px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {current.kind === "custom" ? (
                    <input className={`${inputCls} !h-8 !w-80 text-sm font-bold`} value={d.label || ""}
                      placeholder="Draft name"
                      onChange={(e) => setDraft(current.event, { label: e.target.value })} />
                  ) : (
                    <span className="text-sm font-bold text-primary">{current.label}</span>
                  )}
                  {isCustomised ? (
                    <span className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-bold text-info">Customised</span>
                  ) : current.kind === "custom" ? (
                    <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-bold text-brand-700 dark:text-brand-300">Your draft</span>
                  ) : (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-muted">Built-in wording</span>
                  )}
                  {current.kind === "internal" && !current.enabled && (
                    <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-bold text-danger">Disabled</span>
                  )}
                  <span className="ml-auto text-[11px] text-muted">{kindTitle(current.kind)}</span>
                </div>
                {current.kind === "custom" ? (
                  <input className={`${inputCls} mt-2 !h-8 text-xs`} value={d.description || ""}
                    placeholder="What is this draft for? (shown next to the name in the composer)"
                    onChange={(e) => setDraft(current.event, { description: e.target.value })} />
                ) : (
                  <p className="mt-1 text-xs text-muted">{current.description}</p>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-muted">Placeholders</span>
                  {current.tokens.map((t) => {
                    const chip = t.startsWith("{") ? t : `{${t}}`;
                    return (
                      <button key={t} type="button"
                        className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-secondary ring-1 ring-inset ring-subtle transition-colors duration-micro hover:bg-brand-600/10 hover:text-brand-700 dark:hover:text-brand-300"
                        title={`Insert ${chip} at the end of the body — preview shows “${fillSample(chip)}”`}
                        onClick={() => setDraft(current.event, { body: `${d.body || ""}${chip}` })}>
                        {chip}
                      </button>
                    );
                  })}
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-secondary">Subject</span>
                  <input className={inputCls} value={d.subject} placeholder="Subject line"
                    onChange={(e) => setDraft(current.event, { subject: e.target.value })} />
                </label>
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-semibold text-secondary">Body</span>
                  <textarea className={`${inputCls} !h-auto min-h-[320px] py-2 font-mono text-[13px] leading-relaxed`}
                    rows={Math.min(30, Math.max(14, (d.body || "").split("\n").length + 2))}
                    value={d.body} placeholder="Message body"
                    onChange={(e) => setDraft(current.event, { body: e.target.value })} />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-subtle px-5 py-3">
                {current.kind === "custom" ? (
                  <button className={`${btnSecondary} !px-2.5 !py-1 text-xs text-danger`}
                    disabled={savingEvent === current.event} onClick={() => setDeleteFlow(current)}>
                    <Trash2 size={13} /> Delete draft
                  </button>
                ) : (isCustomised || dirty) && (
                  <button className={`${btnSecondary} !px-2.5 !py-1 text-xs`}
                    disabled={savingEvent === current.event}
                    title="Discard the draft and go back to the built-in wording"
                    onClick={() => {
                      if (isCustomised) void save(current, true);
                      else setDraft(current.event, { subject: current.default_subject || "", body: current.default_body || "" });
                    }}>
                    <RotateCcw size={13} /> Reset to built-in
                  </button>
                )}
                {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
                <button className={`${btnPrimary} ml-auto`} disabled={savingEvent === current.event || !dirty}
                  onClick={() => void save(current)}>
                  <Save size={14} /> {savingEvent === current.event ? "Saving…" : "Save draft"}
                </button>
              </div>
            </div>

            {/* ------------------------------------------------ preview */}
            <div className="flex min-h-0 flex-col overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised lg:col-span-2 xl:col-span-1">
              <div className="flex items-center gap-2 border-b border-subtle px-5 py-3">
                <Eye size={14} className="text-muted" />
                <span className="text-sm font-bold text-primary">Preview</span>
                <span className="text-[11px] text-muted">— with sample values, as the recipient would see it</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2/40 p-5">
                <EmailPreview
                  subject={fillSample(d.subject)}
                  body={fillSample(d.body)}
                  to={current.kind === "internal" ? "Karan Singh <karan.singh@karnex.in>" : `${SAMPLE.candidate} <${SAMPLE.email}>`}
                  from={current.kind === "internal" ? "Karnex" : `${SAMPLE.sender} (Karnex)`}
                />
                {current.kind === "internal" && current.last_sent && (
                  <div className="mt-4 rounded-card border border-subtle bg-surface-1">
                    <button type="button"
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold text-secondary"
                      onClick={() => setExampleOpen((v) => !v)}>
                      <span>
                        Last sent example — to {current.last_sent.to}
                        {current.last_sent.sent_at ? `, ${fmtWhen(current.last_sent.sent_at)}` : ""} ({current.last_sent.status})
                      </span>
                      {exampleOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {exampleOpen && (
                      <div className="border-t border-subtle px-4 py-3">
                        <EmailPreview subject={current.last_sent.subject} body={current.last_sent.body}
                          to={current.last_sent.to} from="Karnex" compact />
                      </div>
                    )}
                  </div>
                )}
                {current.kind === "internal" && !current.last_sent && (
                  <p className="mt-3 text-xs text-muted">No email has been sent for this event yet.</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {creating && (
        <NewDraftModal
          tokens={customTokens}
          onClose={() => setCreating(false)}
          onCreated={(msg, key) => { setCreating(false); notify(msg); load(key); }}
          onError={(m) => notify(m, "err")}
        />
      )}
      {deleteFlow && (
        <ConfirmModal
          title="Delete this draft?"
          message={<>Delete <b>{deleteFlow.label}</b>? It disappears from every composer's “Use a draft” list. This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          busy={savingEvent === deleteFlow.event}
          onConfirm={() => void remove(deleteFlow)}
          onClose={() => setDeleteFlow(null)}
        />
      )}
    </div>
  );
}

/** A mock of the branded email — the same header block the real HTML uses. */
function EmailPreview({ subject, body, to, from, compact }: {
  subject: string; body: string; to: string; from: string; compact?: boolean;
}) {
  return (
    <div className={`overflow-hidden rounded-card border border-subtle bg-white text-[#1e293b] shadow-raised dark:border-neutral-700 ${compact ? "text-xs" : ""}`}>
      <div className="border-b border-[#e2e8f0] bg-[#f8fafc] px-5 py-3 text-xs text-[#64748b]">
        <div className="flex gap-2"><span className="w-12 shrink-0 font-semibold">From</span><span className="truncate text-[#0f172a]">{from}</span></div>
        <div className="mt-0.5 flex gap-2"><span className="w-12 shrink-0 font-semibold">To</span><span className="truncate text-[#0f172a]">{to}</span></div>
        <div className="mt-0.5 flex gap-2"><span className="w-12 shrink-0 font-semibold">Subject</span><span className="truncate font-bold text-[#0f172a]">{subject || <span className="font-normal italic text-[#94a3b8]">(no subject)</span>}</span></div>
      </div>
      <div className="px-5 py-4">
        <div className="mb-3 border-b-2 border-[#e2e8f0] pb-2">
          <span className="text-lg font-extrabold tracking-tight text-[#0f172a]">KARNEX</span>
          <span className="text-lg font-extrabold tracking-tight text-[#4f46e5]"> Careers</span>
        </div>
        <pre className={`whitespace-pre-wrap font-sans leading-relaxed text-[#1e293b] ${compact ? "text-xs" : "text-[13.5px]"}`}>
          {body || <span className="italic text-[#94a3b8]">(empty body)</span>}
        </pre>
      </div>
    </div>
  );
}

function NewDraftModal({ tokens, onClose, onCreated, onError }: {
  tokens: string[];
  onClose: () => void;
  onCreated: (msg: string, key: string | null) => void;
  onError: (msg: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("Hello {candidate},\n\n\n\nBest regards,\n{sender}\n{company}");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const ok = label.trim().length >= 2 && subject.trim() && body.trim();

  const create = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      const res = await crmPost<{ event?: string }>("/api/email-flows/custom", {
        label: label.trim(), description: description.trim() || null,
        subject: subject.trim(), body: body.trim(),
      });
      onCreated(res.message || "Draft created", res.data?.event ?? null);
    } catch (e: any) {
      const msg = e?.message || "Failed to create draft";
      setServerError(msg);
      onError(msg);
      setBusy(false);
    }
  };

  const chips: ReactNode = tokens.map((t) => (
    <button key={t} type="button"
      className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-secondary ring-1 ring-inset ring-subtle hover:text-primary"
      onClick={() => setBody((b) => `${b}{${t}}`)}>
      {`{${t}}`}
    </button>
  ));

  return (
    <Modal title="New email draft" onClose={onClose} dirty={!!(label || subject)}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Draft name</span>
            <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Document request before onboarding" autoFocus />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Description (optional)</span>
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="When to use it — shown next to the name in the composer" />
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-muted">Placeholders:</span>
            {chips}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Subject</span>
            <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Documents needed for your onboarding — {role}" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Body</span>
            <textarea className={`${inputCls} !h-auto py-2 font-mono text-[13px]`} rows={12}
              value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
        </div>
        <div className="rounded-card bg-surface-2/40 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted"><Eye size={12} /> Preview</div>
          <EmailPreview subject={fillSample(subject)} body={fillSample(body)}
            to={`${SAMPLE.candidate} <${SAMPLE.email}>`} from={`${SAMPLE.sender} (Karnex)`} compact />
        </div>
      </div>
      <ActionError error={serverError} className="mt-4" />
      <div className="mt-4 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={!ok || busy} onClick={() => void create()}>
          <Plus size={14} /> {busy ? "Creating…" : "Create draft"}
        </button>
      </div>
    </Modal>
  );
}
