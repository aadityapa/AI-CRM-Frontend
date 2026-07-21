import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { BarChart3, Briefcase, ClipboardList, Database, LayoutTemplate, Sigma, Users, Terminal, Shield, Moon, Sun, LogOut, Menu, X, CalendarClock } from "lucide-react";
import { KarnexBranding } from "./components/KarnexBranding";
import { useSpotlight } from "./crm/components/motion3d";
import { useTheme } from "./theme/ThemeProvider";
import { getAuthToken, getStoredAuthUser } from "./lib/authSession";
import { performAdminLogout } from "./lib/adminLogout";
import { navButtonMotion, pageSurfaceMotion, routeSurfaceKey } from "./lib/motionPresets";
import {
  canAccessInterviewView,
  defaultLanding,
  hasCrmAccess,
  hasInterviewAccess,
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

type NavDef = { target: View; label: string; icon: LucideIcon; active: (v: View) => boolean };

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
  const { theme, toggleTheme } = useTheme();
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
  const platformAccess = rbacActive ? hasInterviewAccess(effRoles) : true;
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
    setMobileNavOpen(false);
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
      {/* Glass top nav bar (tokens.css .glass) with the v3 gradient hairline. */}
      <header className="glass fx-hairline-b sticky top-0 z-30 rounded-none border-x-0 border-t-0">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          <KarnexBranding size="sm" />

          {navItems.length > 0 && (
            /* Opaque recessed E0 track (no glass-in-glass inside the header). */
            <nav className="hidden md:flex items-center gap-1 bg-surface-0 border border-subtle rounded-modal p-1 shadow-[var(--recess-shadow)] flex-1 justify-center min-w-0">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.active(view);
                return (
                  <motion.button
                    key={item.target}
                    type="button"
                    {...navMotion}
                    onClick={() => goView(item.target)}
                    className={`group relative px-3 lg:px-4 py-2 rounded-control text-sm font-semibold transition-colors duration-base ease-smooth flex items-center gap-2 focus-visible:outline-none focus-visible:shadow-focus-ring ${
                      isActive
                        ? "text-brand-700 dark:text-brand-200"
                        : "text-[var(--kx-text-muted)] hover:text-[var(--kx-text)] hover:bg-surface-1"
                    }`}
                  >
                    {isActive && (
                      /* Sheen pill rides the opaque E0 track, not the glass bar. */
                      <motion.span
                        layoutId="admin-nav-active"
                        aria-hidden
                        className="sheen absolute inset-0 rounded-control border border-subtle bg-brand-100 shadow-e1 dark:bg-brand-900"
                        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 35 }}
                      />
                    )}
                    <Icon
                      className={`relative w-4 h-4 transition-transform duration-base ease-smooth group-hover:scale-110 ${
                        isActive ? "text-brand-600 dark:text-brand-300" : ""
                      }`}
                    />
                    <span className="relative hidden lg:inline">
                      {item.label}
                    </span>
                  </motion.button>
                );
              })}
            </nav>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {navItems.length > 1 && (
              <button
                type="button"
                onClick={() => setMobileNavOpen((o) => !o)}
                className="btn-depth md:hidden inline-flex h-10 w-10 items-center justify-center rounded-control text-[var(--kx-text-muted)]"
                aria-label="Toggle navigation"
                aria-expanded={mobileNavOpen}
              >
                {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}
            {canSchedule && (
              <button
                type="button"
                onClick={openScheduler}
                className="btn-depth inline-flex h-10 items-center gap-2 px-3 rounded-control bg-brand-600 text-white text-sm font-semibold"
                title="Open HR Setup to schedule / invite a candidate for an interview"
              >
                <CalendarClock className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Interview Schedule</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void performAdminLogout()}
              className="btn-depth inline-flex h-10 items-center gap-2 px-3 rounded-control text-sm font-semibold text-primary hover:bg-danger-soft hover:text-danger"
              title="Log out and return to login"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Logout</span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="btn-depth inline-flex h-10 w-10 items-center justify-center rounded-control text-primary"
              title={theme === "dark" ? "Light mode" : "Dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <div className="hidden xl:flex items-center gap-2 text-xs text-[var(--kx-text-muted)]">
              <ClipboardList className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
              <span className="font-semibold">{platformAccess ? "HR/Admin" : "Karnex CRM"}</span>
            </div>
          </div>
        </div>

        {/* Mobile nav drawer */}
        <AnimatePresence>
          {mobileNavOpen && navItems.length > 0 && (
            <motion.nav
              /* GPU-only opacity/transform (animating `height` forced layout
                 on every frame). Absolutely positioned dropdown under the
                 sticky header, so opening it shifts no page content. */
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.2, 0, 0, 1] }}
              className="md:hidden absolute inset-x-0 top-full border-t border-b border-subtle bg-surface-1 shadow-overlay"
            >
              <div className="px-4 py-3 grid grid-cols-2 gap-2">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.active(view);
                  return (
                    <button
                      key={item.target}
                      type="button"
                      onClick={() => goView(item.target)}
                      className={`flex min-h-[44px] items-center gap-2 rounded-control px-3 py-2.5 text-sm font-semibold transition-colors duration-base ease-smooth focus-visible:outline-none focus-visible:shadow-focus-ring ${
                        isActive
                          ? "border border-subtle bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                          : "text-[var(--kx-text-muted)] hover:bg-surface-2"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

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
