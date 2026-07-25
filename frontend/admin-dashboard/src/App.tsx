import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { BarChart3, Briefcase, Database, LayoutTemplate, Sigma, Users, Terminal, Shield } from "lucide-react";
import { PlatformTopBar } from "./components/platform-nav/PlatformTopBar";
import { useSpotlight } from "./crm/components/motion3d";
import { getAuthToken, getStoredAuthUser } from "./lib/authSession";
import { navButtonMotion, pageSurfaceMotion, routeSurfaceKey } from "./lib/motionPresets";
import {
  canAccessInterviewView,
  defaultLanding,
  hasCrmAccess,
  ivTabKey,
  tabVisible,
  type InterviewView,
} from "./lib/rbac";
import type { CandidateReportReturnTarget } from "./pages/CandidateReportPage";

const HrDashboard = lazy(() => import("./pages/HrDashboard").then((m) => ({ default: m.HrDashboard })));
const TemplatesPage = lazy(() => import("./pages/Templates").then((m) => ({ default: m.TemplatesPage })));
const CandidatesPage = lazy(() => import("./pages/Candidates").then((m) => ({ default: m.CandidatesPage })));
const AtsPage = lazy(() => import("./pages/ATS").then((m) => ({ default: m.AtsPage })));
const TemplateFormPage = lazy(() => import("./pages/TemplateForm").then((m) => ({ default: m.TemplateFormPage })));
const CandidateInterviewsPage = lazy(() =>
  import("./pages/CandidateInterviews").then((m) => ({ default: m.CandidateInterviewsPage })),
);
const CandidateReportPage = lazy(() => import("./pages/CandidateReportPage").then((m) => ({ default: m.CandidateReportPage })));
const PromptLogsPage = lazy(() => import("./pages/PromptLogs").then((m) => ({ default: m.PromptLogsPage })));
const IntegrityLogsPage = lazy(() => import("./pages/IntegrityLogs").then((m) => ({ default: m.IntegrityLogsPage })));
const UpcomingInterviewsPage = lazy(() => import("./pages/UpcomingInterviews").then((m) => ({ default: m.UpcomingInterviewsPage })));
const QuestionBankPage = lazy(() => import("./pages/QuestionBank").then((m) => ({ default: m.QuestionBankPage })));
const CrmApp = lazy(() => import("./crm/CrmApp"));
const HrSetupPage = lazy(() => import("./pages/HrSetup").then((m) => ({ default: m.HrSetupPage })));

type View = InterviewView;

type NavExtras = { reportInterviewId?: string; reportReturnTo?: CandidateReportReturnTarget };

type NavDef = { target: View; label: string; icon: LucideIcon; active: (v: string) => boolean };

/** All possible primary nav items. Actual visibility is decided by RBAC below.
 * (hrSetup is excluded too — it opens via the scheduler button, not primary nav.) */
const NAV_DEFS: Record<Exclude<View, "templateForm" | "candidateReport" | "candidateInterviews" | "upcomingInterviews" | "hrSetup">, NavDef> = {
  dashboard: { target: "dashboard", label: "Dashboard", icon: BarChart3, active: (v) => v === "dashboard" || v === "candidateInterviews" || v === "upcomingInterviews" },
  templates: { target: "templates", label: "Templates", icon: LayoutTemplate, active: (v) => v === "templates" || v === "templateForm" },
  candidates: { target: "candidates", label: "Reports", icon: Users, active: (v) => v === "candidates" || v === "candidateReport" },
  ats: { target: "ats", label: "ATS", icon: Sigma, active: (v) => v === "ats" },
  promptLogs: { target: "promptLogs", label: "AI Logs", icon: Terminal, active: (v) => v === "promptLogs" },
  integrityLogs: { target: "integrityLogs", label: "Integrity", icon: Shield, active: (v) => v === "integrityLogs" },
  questionBank: { target: "questionBank", label: "Question Bank", icon: Database, active: (v) => v === "questionBank" },
  crm: { target: "crm", label: "CRM", icon: Briefcase, active: (v) => v === "crm" },
};

/** Ordered platform nav (CRM + Question Bank appended separately, per role). */
const PLATFORM_NAV_ORDER: View[] = ["dashboard", "templates", "candidates", "ats", "promptLogs", "integrityLogs"];

function readInitialView(): {
  view: View | null;
  candidateId: string;
  reportInterviewId: string;
  reportReturnTo: CandidateReportReturnTarget;
} {
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view") || "";
    const cid = params.get("cid") || "";
    const iid = params.get("iid") || "";
    const ret: CandidateReportReturnTarget = params.get("ret") === "dashboard" ? "dashboard" : "candidates";
    if (v === "candidateReport" && cid) {
      return { view: "candidateReport", candidateId: cid, reportInterviewId: iid, reportReturnTo: ret };
    }
    if (v === "candidateInterviews" && cid) {
      return { view: "candidateInterviews", candidateId: cid, reportInterviewId: "", reportReturnTo: "candidates" };
    }
    const known: View[] = ["ats", "templates", "dashboard", "candidates", "promptLogs", "integrityLogs", "upcomingInterviews", "questionBank", "hrSetup", "crm"];
    if (known.includes(v as View)) {
      return { view: v as View, candidateId: "", reportInterviewId: "", reportReturnTo: "candidates" };
    }
  } catch (_) {}
  return { view: null, candidateId: "", reportInterviewId: "", reportReturnTo: "candidates" };
}

function pushNav(view: View, candidateId: string, extras: NavExtras = {}) {
  try {
    const params = new URLSearchParams(window.location.search);
    params.delete("iid");
    params.delete("ret");

    if (view === "candidateReport" && candidateId) {
      params.set("view", "candidateReport");
      params.set("cid", candidateId);
      if (extras.reportInterviewId) params.set("iid", extras.reportInterviewId);
      if (extras.reportReturnTo === "dashboard") params.set("ret", "dashboard");
    } else if (view === "candidateInterviews" && candidateId) {
      params.set("view", "candidateInterviews");
      params.set("cid", candidateId);
    } else {
      params.delete("cid");
      if (view && view !== "templateForm") {
        params.set("view", view);
      } else {
        params.delete("view");
      }
    }
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    window.history.pushState({}, "", url);
  } catch (_) {}
}

function PageFallback() {
  // Token .shimmer skeleton (tokens.css) — degrades to an opacity pulse under
  // prefers-reduced-motion. Layout mirrors a typical page: title, KPIs, panel.
  return (
    <div className="min-h-[42vh] w-full px-4 py-8 sm:px-6 lg:px-8" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="mx-auto max-w-[1600px] space-y-4" aria-hidden>
        <div className="shimmer h-8 w-48 rounded-control" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-28 rounded-card" />
          ))}
        </div>
        <div className="shimmer h-64 rounded-panel" />
      </div>
    </div>
  );
}

function AccessDenied({ onHome }: { onHome: () => void }) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-6">
      <div className="max-w-md rounded-2xl border border-[var(--kx-border)] bg-[var(--kx-surface)] p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-orange-500/25">
          <Shield className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-extrabold text-[var(--kx-text)]">Access restricted</h2>
        <p className="mt-2 text-sm text-[var(--kx-text-muted)]">
          Your role doesn’t have access to this screen. If you think this is a mistake, ask an Admin to review your role assignment.
        </p>
        <button
          onClick={onHome}
          className="btn-depth mt-5 inline-flex items-center gap-2 rounded-control bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Go to my home screen
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const reduceMotion = useReducedMotion();
  // Drives the single global .fx-spotlight layer (rAF-throttled; no-op on
  // touch / reduced motion).
  useSpotlight();
  const initial = useMemo(() => readInitialView(), []);
  const [view, setView] = useState<View>(initial.view ?? "dashboard");
  const [candidateId, setCandidateId] = useState<string>(initial.candidateId);
  const [reportInterviewId, setReportInterviewId] = useState<string>(initial.reportInterviewId);
  const [reportReturnTo, setReportReturnTo] = useState<CandidateReportReturnTarget>(initial.reportReturnTo);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(() => !!getStoredAuthUser()?.is_super_admin);

  // CRM roles drive RBAC. null = still loading; [] = no CRM role (legacy HR user).
  const [roles, setRoles] = useState<string[] | null>(null);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  // Per-user tab-access override (null = no override → full role-based access).
  const [tabAccess, setTabAccess] = useState<string[] | null>(null);

  // Fetch super-admin flag (question bank) and CRM roles (RBAC) once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/auth/me", {
          headers: { Authorization: `Bearer ${getAuthToken()}` },
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setIsSuperAdmin(!!data?.user?.is_super_admin);
        }
      } catch {
        /* ignore */
      }
    })();
    (async () => {
      try {
        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${getAuthToken()}` },
          cache: "no-store",
        });
        if (res.ok) {
          const body = await res.json();
          const r = (body?.data?.roles ?? body?.roles ?? []) as string[];
          if (!cancelled) setRoles(Array.isArray(r) ? r : []);
          const ta = (body?.data?.tab_access ?? body?.tab_access ?? null) as string[] | null;
          if (!cancelled) setTabAccess(Array.isArray(ta) ? ta : null);
        } else {
          // CRM unconfigured / no profile → legacy mode (no gating).
          if (!cancelled) setRoles([]);
        }
      } catch {
        if (!cancelled) setRoles([]);
      } finally {
        if (!cancelled) setRolesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // RBAC engages only when the user has at least one CRM role assigned. Legacy
  // HR users (no CRM role) keep the full, pre-RBAC navigation so nothing breaks.
  const rbacActive = !!roles && roles.length > 0;
  const effRoles = roles ?? [];

  const platformViews: View[] = rbacActive
    ? PLATFORM_NAV_ORDER.filter((v) =>
        tabVisible(tabAccess, ivTabKey(v as InterviewView), canAccessInterviewView(effRoles, v)),
      )
    : PLATFORM_NAV_ORDER;
  const canCrm = rbacActive ? hasCrmAccess(effRoles) : true;
  // Admin / HR / TA can open the HR Setup scheduler to invite candidates for interviews.
  const canSchedule = !rbacActive || effRoles.includes("Admin") || effRoles.includes("HR") || effRoles.includes("TA");
  const openScheduler = () => goView("hrSetup");

  const isViewAllowed = (v: View): boolean => {
    if (!rbacActive) return true;
    if (v === "crm") return canCrm;
    if (v === "questionBank") return isSuperAdmin; // Admin/super-admin only
    return tabVisible(tabAccess, ivTabKey(v as InterviewView), canAccessInterviewView(effRoles, v));
  };

  // Once roles are known, choose/validate the landing view.
  useEffect(() => {
    if (!rolesLoaded) return;
    const landing = rbacActive ? defaultLanding(effRoles) : "dashboard";
    // No explicit (valid) view in the URL → send the user to their home screen.
    if (initial.view == null) {
      setView(landing);
      pushNav(landing, "");
      return;
    }
    // Explicit view present but not permitted for this role → redirect home.
    if (!isViewAllowed(initial.view)) {
      setView(landing);
      pushNav(landing, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesLoaded]);

  // Guard against in-session navigation to a now-disallowed view.
  useEffect(() => {
    if (!rolesLoaded || !rbacActive) return;
    if (!isViewAllowed(view)) {
      const landing = defaultLanding(effRoles);
      setView(landing);
      pushNav(landing, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, rolesLoaded]);

  const navItems: NavDef[] = [
    ...platformViews.map((v) => NAV_DEFS[v as keyof typeof NAV_DEFS]).filter(Boolean),
    ...(isSuperAdmin && isViewAllowed("questionBank") ? [NAV_DEFS.questionBank] : []),
    ...(canCrm ? [NAV_DEFS.crm] : []),
  ];

  const surfaceKey = routeSurfaceKey(view, candidateId);
  const pageMotion = pageSurfaceMotion(surfaceKey, !!reduceMotion);
  const navMotion = navButtonMotion(!!reduceMotion);

  useEffect(() => {
    const onPop = () => {
      const next = readInitialView();
      const resolved = next.view ?? (rbacActive ? defaultLanding(effRoles) : "dashboard");
      setView(isViewAllowed(resolved) ? resolved : (rbacActive ? defaultLanding(effRoles) : "dashboard"));
      setCandidateId(next.candidateId);
      setReportInterviewId(next.reportInterviewId);
      setReportReturnTo(next.reportReturnTo);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesLoaded, roles]);

  const goView = (v: View, cid = "") => {
    if (!isViewAllowed(v)) return;
    setView(v);
    setCandidateId(cid);
    setReportInterviewId("");
    setReportReturnTo("candidates");
    pushNav(v, cid);
  };

  const goCandidateReport = (cid: string, interviewId?: string, ret: CandidateReportReturnTarget = "candidates") => {
    if (!isViewAllowed("candidateReport")) return;
    setView("candidateReport");
    setCandidateId(cid);
    setReportInterviewId(interviewId || "");
    setReportReturnTo(ret);
    pushNav("candidateReport", cid, { reportInterviewId: interviewId, reportReturnTo: ret });
  };

  const openHrFlow = (focus: "template" | "invite") => {
    const origin = window.location.origin;
    const url = `${origin}/?focus=${encodeURIComponent(focus)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Wait for RBAC to resolve before rendering to avoid a flash of disallowed nav.
  if (!rolesLoaded) {
    return (
      <div className="relative isolate min-h-screen bg-surface-0 text-primary">
        <div aria-hidden className="fx-aurora" />
        <PageFallback />
      </div>
    );
  }

  const showViewInBody = isViewAllowed(view) ? view : (rbacActive ? defaultLanding(effRoles) : "dashboard");

  return (
    <div className="relative isolate min-h-screen bg-surface-0 text-primary transition-colors duration-200">
      {/* Aurora ambience — single fixed indigo/violet/cyan mesh behind ALL
          content (tokens.css .fx-aurora; z-index -1 inside this isolated
          root) + the ONE global mouse-follow spotlight (useSpotlight above). */}
      <div aria-hidden className="fx-aurora" />
      <div aria-hidden className="fx-spotlight" />
      <PlatformTopBar
        navItems={navItems}
        view={view}
        onNavigate={(target) => goView(target as View)}
        canSchedule={canSchedule}
        onSchedule={openScheduler}
        canCrm={canCrm}
        roles={effRoles}
        tabAccess={tabAccess}
        rbacActive={rbacActive}
        navMotion={navMotion}
      />

      <Suspense fallback={<PageFallback />}>
        <AnimatePresence mode="wait">
          <motion.div
            key={surfaceKey}
            className="min-h-[calc(100vh-4rem)]"
            variants={pageMotion.variants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageMotion.transition}
          >
            {showViewInBody === "dashboard" ? (
              <HrDashboard
                onCreateTemplate={() => {
                  if (!isViewAllowed("templateForm")) return;
                  setEditingJobId(null);
                  setView("templateForm");
                }}
                onInviteCandidate={() => openHrFlow("invite")}
                onViewCandidateReport={(cid, iid) => goCandidateReport(cid, iid, "dashboard")}
                onViewAllCandidates={() => goView("candidates")}
                onViewAllUpcoming={() => goView("upcomingInterviews")}
              />
            ) : showViewInBody === "candidateReport" && candidateId ? (
              <CandidateReportPage
                candidateId={candidateId}
                initialInterviewId={reportInterviewId}
                returnTo={reportReturnTo}
                onBack={() => goView(reportReturnTo === "dashboard" ? "dashboard" : "candidates")}
              />
            ) : showViewInBody === "candidateInterviews" ? (
              <CandidateInterviewsPage
                candidateId={candidateId}
                onBack={() => goView("dashboard")}
                onOpenCandidateReport={(iid) => goCandidateReport(candidateId, iid, "dashboard")}
              />
            ) : showViewInBody === "templates" ? (
              <TemplatesPage
                onCreateTemplate={() => {
                  setEditingJobId(null);
                  setView("templateForm");
                }}
                onEditTemplate={(jobId) => {
                  setEditingJobId(jobId);
                  setView("templateForm");
                }}
              />
            ) : showViewInBody === "candidates" ? (
              <CandidatesPage onOpenCandidateReport={(cid, iid) => goCandidateReport(cid, iid, "candidates")} />
            ) : showViewInBody === "templateForm" ? (
              <TemplateFormPage jobId={editingJobId} onDone={() => setView("templates")} onOpenHrSetup={() => openHrFlow("template")} />
            ) : showViewInBody === "promptLogs" ? (
              <PromptLogsPage />
            ) : showViewInBody === "integrityLogs" ? (
              <IntegrityLogsPage />
            ) : showViewInBody === "questionBank" ? (
              <QuestionBankPage />
            ) : showViewInBody === "upcomingInterviews" ? (
              <UpcomingInterviewsPage onBack={() => goView("dashboard")} />
            ) : showViewInBody === "hrSetup" ? (
              <HrSetupPage />
            ) : showViewInBody === "crm" ? (
              <CrmApp />
            ) : isViewAllowed("ats") ? (
              <AtsPage />
            ) : (
              <AccessDenied onHome={() => goView(rbacActive ? defaultLanding(effRoles) : "dashboard")} />
            )}
          </motion.div>
        </AnimatePresence>
      </Suspense>
    </div>
  );
}
