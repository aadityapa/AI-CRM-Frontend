# CLAUDE.md — Karnex frontend (AI-Interview-Model-F-V2)

Working notes for AI assistants. Written 12 Aug 2026 from a full read of the tree.
Companion file: `F:\AI-Interview-Model-B-V2\CLAUDE.md` (backend, FastAPI).

---

## 1. Two front-ends in one repo

| App | Path | Served at | Stack |
| --- | --- | --- | --- |
| **Admin dashboard** — HR reporting + the whole Karnex CRM | `frontend/admin-dashboard/` | `/admin/` | React 18 + Vite 5 + TS 5 + Tailwind 3 |
| **Candidate/HR runtime** — the live interview | `frontend/index.html` + `frontend/js/` | `/` | vanilla ES modules, 7,873-line single HTML file |

Both call the backend over **relative paths on the same origin**. There is no configurable API base URL in app code — origin resolution happens in the Vite proxy (dev) or Vercel rewrites (prod). Both share the same `localStorage` auth keys: `authUser`, `authToken`, `authTokenExpiryIst`.

---

## 2. Orientation map (admin-dashboard/src)

```
App.tsx              the shell: View union, nav, RBAC gating, query-param navigation
main.tsx             StrictMode + ThemeProvider; cross-tab logout; version-based cache bust
api/
  client.ts          ★ authFetch + apiGet with an in-memory GET cache & inflight dedupe
  index.ts           HR/interview domain calls
  promptLogs.ts, questionBank.ts
lib/
  rbac.ts            ★ single source of truth for roles, views, tab keys, field access
  authSession.ts, adminLogout.ts, motionPresets.ts
components/
  platform-nav/      PlatformTopBar (⌘K palette, ⌘/ Ask AI), AccountMenu, CommandPalette
  ask-ai/            AskAiPanel + askAiStore + askAiApi + markdownLite
  candidate-report/, interview-status/, pdf/
pages/               non-CRM HR pages (dashboard, templates, ATS, prompt logs, question bank…)
crm/                 ★ the CRM app — 118 files, ~50k lines (see §5)
design-system/tokens/  primitives (tokens.css + typed tokens.ts mirror)
styles/tokens.css    the recipe/alias layer + every named utility class
theme/               ThemeProvider, accents.css, ThemePicker
```

---

## 3. Navigation — there is no React Router

**Platform level** (`App.tsx`): query string only. `?view=&cid=&iid=&ret=`, driven by `pushNav()` + a `popstate` listener. Views: `dashboard | templates | questionBank | candidates | ats | promptLogs | integrityLogs | templateForm | candidateInterviews | candidateReport | upcomingInterviews | hrSetup | crm`.

**CRM level** (`crm/router.tsx`): a second query-param router under `?p=`.
- `readCrmPath()` reads `?p`, `crmNavigate(path)` does `pushState` **plus a manually dispatched `PopStateEvent`** — that synthetic popstate is the entire notification mechanism.
- `crmUrl()` **deletes every key in `CRM_FILTER_KEYS = ["project_id","employee_id"]` on every navigation** so stale list filters can't leak across pages. Query suffixes on a path become *sibling* params, never part of `p`.
- `CrmLink` renders a real `<a href>` so middle-click/ctrl-click still work.
- `matchRoute` is exact-segment-count, so **literal routes must be listed before parametric ones** in `crm/routes.ts` (`invoices/tax-generator` before `invoices/:id`).

---

## 4. RBAC — `src/lib/rbac.ts` is the contract

Roles: `Admin, Sales, Sales_Head, RMG, TA, HR, Finance` (+ `CEO`, treated as admin). `isAdmin` = Admin **or** CEO.

Tab keys are namespaced: `crmTabKey(path)` → `crm:<path>`, `ivTabKey(view)` → `iv:<view>`. `MANAGEABLE_TABS` (24 entries) drives the Users-admin access modal; `TAB_FIELDS` adds field-level control for opportunities/customers/candidates.

Bootstrap: `App.tsx` fetches `GET /auth/me` (for `is_super_admin`) and `GET /api/me` (roles, `tab_access`, `field_access`, `access`) in parallel, then blocks render until `rolesLoaded` to avoid a nav flash. `defaultLanding()` returns **`"crm"` for everyone**.

⚠️ **RBAC fails open in two places, by design.** `rbacActive = roles.length > 0`, so a failed/absent `/api/me` leaves legacy HR users with the full pre-RBAC nav. And `questionBank` gates on the `/auth/me` `is_super_admin` flag rather than `rbac.isSuperAdmin(roles)`.

**Inside the CRM**, gating is `crm/useAccess.ts`: `crmTabVisibleFromMe(me, path, rolePermitted, mandatory)` and the `useCrmAccess(tab)` / `useCanEditTab(tab)` hooks. Every check short-circuits `true` for superadmin, `access.full`, or `visible_tabs == null` (no template assigned = unrestricted).

---

## 5. The CRM app (`src/crm/`)

`CrmApp.tsx` is the shell: animated sidebar ↔ 60px rail (persisted in `localStorage["crm.sidebar.collapsed"]`), mobile drawer, `NotificationsBell` polling `/api/notifications` every 60 s, and a `Suspense`-wrapped `CrmRouter`.

**API layer — `crm/api.ts`.** `crmGet/crmPost/crmPut/crmPatch/crmDelete` wrap `authFetch`, unwrap the backend envelope `{success, data, message, errors, meta}`, and throw `CrmApiError {status, errors}` — including when a **200** carries `success: false`. `formatApiError` flattens FastAPI 422 `detail[]` arrays into one string. `crmUpload` is XHR-based for progress.

**Page inventory** (39 routes). The heavy ones and what they own:

| File | Owns |
| --- | --- |
| `Requirements.tsx` (3,361) | requirement workflow + resume/ATS pipeline; `StatusStepper`; role-dependent tabs; fans out `Promise.all` over statuses because the API takes one `status` |
| `Timesheets.tsx` (3,351) | entry grid + the client mirror of backend billing maths (`computeBillables`, paid-vs-LOP split); four report panels |
| `Profiles.tsx` (2,750) | candidate × opportunity pipeline; renders **only** `detail.allowed_next_statuses`; every transition needs a ≥5-char comment |
| `Employees.tsx` (2,410) | HR directory, per-section edit/save with dirty tracking |
| `Finance.tsx` (2,351) | POs, invoices, TDS, GST slabs, payments |
| `opportunity/NewOpportunityForm.tsx` (1,908) | schema-driven form; see below |
| `CrmCandidates.tsx` (1,617) | candidate master + outreach |
| `Customers.tsx`, `UsersAdmin.tsx`, `Projects.tsx`, `ProjectEmployeeDetail.tsx`, `Calendar.tsx`, `CrmSettings.tsx` | the rest |

**The Opportunity form is declarative.** `opportunity/opportunitySchema.ts` holds one `OPPORTUNITY_SCHEMA: SectionDef[]`; `FormRenderer.tsx` is the only renderer; `opportunityFormState.ts` keeps a per-type `detailsByType` bucket so switching type and back restores values; `ctcSlab.ts` is the pure maths. **`services/opportunity_form_schema.py` on the backend is the parity twin** — change one, change both, and `test_opportunity_form_schema.py` checks it.

**Component library — `crm/components/ui.tsx`** is where the primitives live: `statusColor`/`statusLabel`/`StatusBadge` (with `STATUS_LABEL_OVERRIDES` renaming display-only, e.g. `L1_Feedback` → "Customer L1 Interview"), `Modal` (portal, scroll lock, focus trap, variants), `ConfirmModal` (with the 409 "delete blocked → deactivate instead" secondary action), `Tabs`, `KpiCard`, `useToast()`.

Other pieces worth knowing before reinventing them: `DataTable.tsx` (generic list + `Column<T>`), `TableCustomizer.tsx` (per-**user** column layout stored server-side at `/api/me/table-preferences/{key}`), `RowActions.tsx` + `afterListDelete`, `AiInterviewCell.tsx` (**the single source of truth for AI L1 outcome** — a recruiter's decision outranks the AI verdict but the verdict stays visible), `ScheduleAiInterviewModal.tsx` (extracted from Profiles so Calendar could use it without pulling a 3,000-line bundle), `wizard/index.tsx` (shared wizard chrome).

**`crm/lib/` — small modules with real reasons:**
- `calendarDates.ts` — all date maths in **local wall time**; the backend returns naive local ISO and converting to UTC would shift every interview.
- `candidateEmail.ts` — importers synthesise `<name>.<hash>@import.karnex.in` because `candidates.email` is UNIQUE NOT NULL. Use `displayEmail`/`realEmail` so placeholders are never shown or mailed.
- `fetchAllMaster.ts` — pages at 100/request because the backend clamps `limit` to 100 and `?limit=200` silently truncated the skills dropdown.
- `sanitizeHtml.ts` — allow-list sanitiser for `mammoth` .docx preview. CVs arrive via the **public** apply form and the auth token lives in `localStorage` on this origin.
- `phone.ts` — the only module allowed to import `libphonenumber-js`.

---

## 6. Design system

Load order is canonical: `main.tsx` → `styles.css` → `styles/tokens.css` → `design-system/tokens/tokens.css`.

- `design-system/tokens/tokens.css` — primitives: brand indigo (`--brand-600 #4f46e5` = primary action), violet/cyan accents, neutrals, semantics, 4 elevations, **radii 6/10/16**, 4px spacing scale, **two motion durations** (`--motion-micro 150ms`, `--motion-panel 250ms`).
- `design-system/tokens/tokens.ts` — typed static hex mirror for recharts (which resolves colours once).
- `styles/tokens.css` — the alias/recipe layer and **every named utility class**: `.glass`, `.elev-1/2/3`, `.btn-depth` (+ `.btn-gradient`), `.input-recessed`, `.shimmer`, `.row-hover`, `.nav-pill-gradient`, `.fx-aurora`, `.fx-spotlight`, `.fx-hairline-b`, `.fx-glow`, `.fx-lift`, plus the SCORE SCALE (`--score-strong/good/moderate/weak`, teal/indigo/amber/rose — deliberately **not** a traffic light; colour is a redundant channel behind arc length + numeral + word).
- `tailwind.config.cjs` maps utilities to those vars. **`rounded-panel` is 10px, not 16** — a deliberate change.
- Theme: `theme/ThemeProvider.tsx`, keys `karnexTheme` / `karnexUiDark` / `karnexAccent`; toggles both `.dark` and `.kx-dark` on `<html>` and sets `data-accent`. A pre-hydration script in `index.html` mirrors this to avoid a flash.

Read `DESIGN-DECISIONS.md` before restyling anything. `DEPTH_SYSTEM.md` is **partially stale** (old 8/12/16/24 radii, four motion durations).

Every animated effect sits inside `@media (prefers-reduced-motion: no-preference)` or has a `reduce` override. Keep it that way.

---

## 7. The legacy interview runtime (`frontend/js/`)

Orchestrator is `app.js`, which publishes ~30 functions onto `window` because `index.html` uses inline `onclick`. Key modules: `core.js` (`apiFetch` + `x-device-id` + 401 handling), `candidate.js` (2,545 lines — TTS, STT, timer, proctoring), `interview_engine.js`, `interview_auto_advance.js` (Whisper + GPT answer-completion), `vad_silero.js` (Silero VAD via WASM), `interview_whisper_segments.js` (STT only on VAD-confirmed segments), `interview_security.js` (fullscreen gate, three-strike violations), `face_detection.js`, `device_test.js` (mandatory mic/speaker/camera/internet gate), `results.js`, `hr.js` + `hrSetupUi.js`.

Candidate flow, in order: boot → welcome (never auto-skipped) → **rules gate before any permission prompt** → device test (+ a defence-in-depth re-check) → invite verify → login (handles `scheduled_wait` with a countdown) → fullscreen → `/next` → proctoring after Q1 → turn loop → `submitInterview()` which **awaits `POST /submit` before redirecting**.

---

## 8. Building, testing, deploying

```bash
cd frontend/admin-dashboard
npm ci
npm run dev            # :5173/admin/, proxies 24 prefixes to VITE_BACKEND_URL || 127.0.0.1:2020
npm run build          # vite build → dist/
npm run typecheck      # tsc --noEmit
npm run lint
npm run test:run       # vitest — 10 tests, the pure-logic + RBAC modules
node scripts/check-contrast.mjs   # WCAG gate; exits 1 on failure. Not wired into CI

cd ..\..                # repo root
npm run build          # the full Vercel-equivalent build
```

**Vercel**: `scripts/vercel-build.mjs` copies `dist/` → `frontend/admin/` and then **rewrites `vercel.json` in place** from its own `apiPrefixes` array. `vercel.json` is generated output, not source of truth.

⚠️ **Adding an API prefix means editing three files**: `vite.config.ts::API_PROXY_PREFIXES`, `scripts/vercel-build.mjs::apiPrefixes`, and the backend router registration. Miss the middle one and it works in prod but not in dev; miss the second and vice versa.

Build config notes: `base: "/admin/"`, `esbuild.drop = ["console","debugger"]` in prod, manual chunks `vendor-react | vendor-icons | vendor-motion | vendor-charts | vendor-pdf` with `vendor-pdf` excluded from modulepreload.

---

## 9. Known state, debt and traps

- `frontend/admin/` holds a **committed production build** that `vercel-build.mjs` overwrites — generated output in source control. `admin-dashboard/dist/` is likewise still tracked despite being in `.gitignore`.
- Two token systems coexist: the v3 `--brand/--surface/--text` set and the legacy `--kx-*` set, propped up by `html.dark .bg-slate-*` `!important` shims in `styles.css` supporting ~2,100 raw `slate-*` classes. Documented as debt in DESIGN-DECISIONS §13, along with ~243 arbitrary `[Npx]` values and ~154 hardcoded hex in the PDF/chart files.
- `KARNEX_CRM_USER_GUIDE.md` (backend repo) says HR approves timesheets. The code does not allow it. Trust the code.
- Bundle weight: `vendor-pdf` 583 KB, `vendor-charts` 399 KB; 82 backdrop-blur layers await migration to `.glass`.
- ESLint has ~76 pre-existing errors; six `jsx-a11y` rules are downgraded to `warn` with a note to flip them back page by page.
- Working tree (12 Aug 2026): branch **`wip/profiles-users-admin`**, ~24 files genuinely changed, 7 untracked including `crm/pages/Payroll.tsx`, `components/ask-ai/askAiStore.ts` and two new tests. Nothing merged to `main`.

---

## 10. Recent work in this repo

**Projects is the project hub; Timesheets left the sidebar** (14 Aug 2026) —
`pages/Projects.tsx::ProjectsListPage` gained hub tabs (Projects | Project
Employees | Timesheets | Purchase Orders | Invoices) via React.lazy embeds;
nav.ts swapped the Timesheets entry for Projects (role union) and CrmApp's
HUB_COVERED no longer hides "projects". Customer-hub tabs each carry a
"New …" button: Opportunities opens NewOpportunityForm inline (new
`initialCustomerId` prop pre-selects the customer); Projects / PE / PO /
Invoice / Holiday navigate with `?create=1`, which each target page consumes
once on mount (opens its create dialog, then strips the flag).

**CTC Slab rework — appraisal-cycles power rule** (14 Aug 2026, NEXUS parity) —
`ctcSlab.ts` + backend `services/opportunity_ctc.py` (both engines):
Appraisal Cycle is a NUMBER, auto = Target − Exp Min − 1;
Approved CTC = Engineering Budget ÷ (1+Hike%)^cycles (5→7 = ÷1.1; 6→7 = full
budget; 7→10 = ÷1.21 — pinned by test_appraisal_cycles_power_rule with the
exact 143010/130009.09/118190.08 screenshot figures). Legacy rows without
exp/target fall back to one division. New slab rows default Hike 10 + Mgmt
Cost 30; ladder rows keep Hike 10 (cycles derive to 0 → full budget). The
branch editor is titled "CTC Slab" and shows ONE rate column matched to the
branch's billing type (all five only when no billing type is set).

**Settings → Customer Policies matrix** (14 Aug 2026) — `CrmSettings.tsx::
CustomerPoliciesTab` renders `GET /api/customers/policy-matrix` (one row per
customer: leave accruals + carry/lapse from CustomerLeavePolicy, billability
flags, billing type, hrs/day, paid leaves/yr, branch max-hours cap). A WINDOW
onto the same tables the Opportunity form inherits from — the edit modal
merges with the stored policy then PUTs `/billing-policy` (which now round-
trips billable_leaves_per_year; serialize_policy exposes it too). Leave
accrual editing stays on the customer's Leave Policies.

**Suggested Candidates on opportunity detail** (14 Aug 2026) — new tab between
Applicants and Skill Evaluation: `GET /api/opportunities/{id}/suggested-candidates`
(backend `services/candidate_match.py` — deterministic scoring: mandatory
skills 35 + optional 15 + experience-band 20 + history 25 + contactability 5;
already-applied excluded, Joined/Preboarding flagged "engaged"). Cards show
match %, matched/missing-mandatory skill chips, per-line reasons, last
application, mailto/Resume/LinkedIn links and one-click "Apply here"
(POST /api/candidate-profiles). BULK apply (17 Aug 2026): per-card checkboxes
+ Select-all bar + one confirm modal listing warnings; sequential POSTs to the
same endpoint, per-candidate success/failure (a failure never aborts the batch). No AI call — instant, explainable, identical
for every user.

**Customer page is the hub** (14 Aug 2026) — `pages/Customers.tsx`:
CustomerDetailPage gained customer-filtered tabs — Holidays, Opportunities,
Projects, Purchase Orders, Invoices (`CustomerScopedTable` + per-entity tab
components) — linking into the SAME detail pages (opportunity tabs, project →
Project Employees → Timesheets). Tab visibility mirrors each sidebar page's
role rules + Access Templates (`useCanAct(tab, "view", roleOk)`).
SIDEBAR RULE (`CrmApp.tsx::HUB_COVERED`): users WITH Customers access lose the
duplicated entries (projects, project-employees, holidays, timesheets, pos,
invoices) — customer-first is their road; users WITHOUT Customers access
(Finance, RMG, HR, employees) keep them, since the sidebar is their only road.
"opportunities" is deliberately NOT hidden: that entry is also the
Requirements workspace, which no customer tab replaces. ⌘K still indexes
everything (escape hatch).
`GET /api/invoices` gained a `customer_id` filter (join via Project) for the
Invoices tab.

**Rate Card is branch-wise** (14 Aug 2026, 0077) — `pages/RateCards.tsx` now
exports `BranchRateCardEditor`, opened from a Banknote button on each branch
card in the Customers → Branches tab AND embedded as the "CTC Slab" tab (after
Employees Working) on `BranchPolicy.tsx` — same component/API both places, so
edits in one are live in the other (the standalone sidebar page is gone;
`crm:rate-cards` stays in MANAGEABLE_TABS to gate the API/editor). Bands with
five OPTIONAL rates; NULL-branch rows are the customer-wide fallback.
`NewOpportunityForm::applyRateCardToSlab` prefers the selected branch's rows,
fills EMPTY slab Rate cells (exact band match, else band containing Exp Min;
column = Billing Type, or the single quoted unit), and a WIDE band (e.g. 3–7
yrs) auto-builds the slab ladder: filling year 3 appends rows for 4, 5, 6 —
first row keeps Hike 10% + Appraisal "Annual", generated rows get Hike 0 and
no cycle (no new customer money until their next band). New slab rows default
`hike_pct: 10`.

**Opportunity wizard: one merged Commercials step** (14 Aug 2026) —
`NewOpportunityForm.tsx`: Leave & Holiday Details + Commercial Details +
Candidate CTC Slab render as ONE step ("Commercials & CTC Slab"), RFI Value
last. The SCHEMA still has three sections (field metadata/validation/hydration
untouched); `visibleSections` filters out `commercial`/`ctcSlab` and
`renderStepBody` composes the merged card with sub-headings.
`sectionStatus`/`validateSection`/`runFullValidation` aggregate all three under
the `leaveHoliday` key — keep that in mind when touching step logic.

**Opportunity detail is tabbed** (14 Aug 2026) — `pages/Opportunities.tsx`:
Requirements-style tabs on `opportunities/:id` — Opportunity Details | Applicants
| Skill Evaluation Details | Activity Log. The Details tab renders straight from
`OPPORTUNITY_SCHEMA` (`OpportunityAllDetails`), so a field added to the wizard
shows on the detail page for free; id fields display resolved names. The header
summary itself is a CollapsibleCard ("Opportunity Details", collapsed like
every block under it), and the Activity Log renders field-level "old → new"
diffs from the backend — `Timeline.tsx` comment div is `whitespace-pre-line`
(one diff per line). The form
dropped its "Onboarding Status" section (every new opportunity defaults to
"Sales Validation" — set in `emptyState()` AND in the backend create route) and
"Activity Histories" (the tab covers it).

**Ask AI rebuilt as a full chat workspace** (12 Aug 2026) — `components/ask-ai/`:
- `askAiStore.ts` (new) — multi-thread conversations in localStorage (`karnex.askAi.threads.v2`, 30 threads × 80 turns), auto-titled, grouped by recency, migrating the legacy sessionStorage key `karnex.askAi.chat.v1`.
- `AskAiPanel.tsx` (rewritten, 788 lines) — two layouts on one thread model: **dock** (440px right rail) and **full** (full-screen with history sidebar + centred column), toggled from the header and remembered. Copy/retry on replies, auto-growing composer, body-scroll lock and focus trap in full screen. Props unchanged (`{open, onClose}`), so `PlatformTopBar` and the ⌘/ shortcut needed no edits.
- Backend contract: `GET /api/ai/help-context`, `POST /api/ai/assist`.

Session record: `docs/chat-backups/2026-08-12-ask-ai-chat-rebuild.md`.

**Three operational features** (12 Aug 2026), backend-led — see `B-V2/CLAUDE.md` §5–§6 for the rules:

- **Ask AI query tools.** `askAiApi.ts` now sends `enable_tools: true`; the server runs whitelisted SELECT-only lookups filtered by the caller's roles. `ChatTurn.toolsUsed` and `TOOL_LABELS` drive the "Checked your …" line under a reply, so the user can tell an answer came from their records rather than the model's memory. Still zero writes.
- **PO renewal.** `Finance.tsx::RenewPoModal` + a Renew button on PO detail, and a chain strip showing `renewed_from` / `renewals` on both ends. Start date defaults to the day after the old PO ends. The modal states plainly what is inherited and that an unspent balance does not carry over — the two things people assume wrongly.
- **Scheduler liveness.** `CrmSettings.tsx` Operations tab now flags an **enabled** job with no run in 48 h (`enabled` / `stale` from `/api/scheduler/status`); a job that is switched off never reads red. A new "Background jobs" group on the Organisation tab finally makes the scheduler switches editable — that tab had been pointed at for them all along.
