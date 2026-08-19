# CLAUDE.md — Karnex frontend (AI-Interview-Model-F-V2)

Working notes for AI assistants. **Rewritten 18 Aug 2026** from a full mechanical scan of both repos
(route extraction, per-page API-call inventory, gate-hook census, token-layer diff, prefix three-way
diff, typecheck run). Numbers below were measured.

Companion file: `F:\AI-Interview-Model-B-V2\CLAUDE.md` (backend, FastAPI).

> **Corrections to the previous edition** — `MANAGEABLE_TABS` has **28** entries, not 24. The design
> tokens moved to **v4 royal blue** (`--brand-600 #2563eb`); the old "indigo `#4f46e5`" note and both
> `DESIGN-DECISIONS.md` and `DEPTH_SYSTEM.md` are behind. `frontend/admin/` is no longer a committed
> build. `HUB_COVERED` is 4 entries, not 6. `Timesheets.tsx` is 3,854 lines, `Requirements.tsx` 3,478.

---

## 1. Two front-ends in one repo

| App | Path | Served at | Stack |
| --- | --- | --- | --- |
| **Admin dashboard** — HR reporting + the whole Karnex CRM | `frontend/admin-dashboard/` | `/admin/` | React 18 + Vite 5 + TS 5 + Tailwind 3 — **78,585 lines / 200 files** (133 tsx + 60 ts + 7 css) |
| **Candidate/HR runtime** — the live interview | `frontend/index.html` + `frontend/js/` | `/` | vanilla ES modules — **27 JS files / 10,200 lines** + a 7,875-line HTML file |

Both call the backend over **relative paths on the same origin**. There is no configurable API base URL
in app code — origin resolution happens in the Vite proxy (dev) or Vercel rewrites (prod). Both share
the same `localStorage` auth keys: `authUser`, `authToken`, `authTokenExpiryIst`.

**Working tree, 18 Aug 2026:** branch `wip/profiles-users-admin`, head `648afad`, **89 changed/untracked
paths**. Nothing merged to `main`.

---

## 2. Orientation map (admin-dashboard/src)

```
App.tsx              the shell: View union, nav, RBAC gating, query-param navigation (454 L)
main.tsx             StrictMode + ThemeProvider; cross-tab logout; version-based cache bust
api/
  client.ts          ★ authFetch + apiGet with an in-memory GET cache & inflight dedupe
  index.ts           HR/interview domain calls · promptLogs.ts · questionBank.ts
lib/
  rbac.ts            ★ single source of truth for roles, views, tab keys, field access (275 L)
  authSession.ts, adminLogout.ts, motionPresets.ts
components/
  SessionKeeper.tsx  ⚠️ UNTRACKED IN GIT but imported by App.tsx:6 — a fresh clone will not compile
  platform-nav/      PlatformTopBar (⌘K palette, ⌘/ Ask AI), AccountMenu, CommandPalette, fuzzyMatch
  ask-ai/            AskAiPanel (805 L) + askAiStore + askAiApi + markdownLite
  candidate-report/, interview-status/, pdf/
pages/               13 non-CRM HR pages (dashboard, templates, ATS, prompt logs, question bank…)
crm/                 ★ the CRM app — 39 routes, 30 pages, 34 components (see §5)
design-system/tokens/  primitives (tokens.css v4 + typed tokens.ts mirror)
styles/tokens.css    the alias/recipe layer + 33 named utility classes (961 L)
theme/               ThemeProvider, accents.css (8 accents), ThemePicker
```

---

## 3. Navigation — there is no React Router

**Platform level** (`App.tsx`): query string only. `?view=&cid=&iid=&ret=`, driven by `pushNav()`
(`:84-110`) + a `popstate` listener (`:310`). 13 views (`lib/rbac.ts:26-39`):
`dashboard | templates | questionBank | candidates | ats | promptLogs | integrityLogs | templateForm |
candidateInterviews | candidateReport | upcomingInterviews | hrSetup | crm`.
`templateForm` is deliberately **not** URL-addressable (`:100-104` deletes `view` for it).
Bootstrap fetches `GET /auth/me` (for `is_super_admin`) and `GET /api/me` (roles, `tab_access`,
`field_access`, `access`) in parallel and **blocks render on `rolesLoaded`** to avoid a nav flash,
then silently re-fetches `/api/me` every 5 min and on focus (throttled 30 s, JSON-compared, never logs out).

**CRM level** (`crm/router.tsx`): a second query-param router under `?p=`.

- `readCrmPath()` reads `?p`, trims slashes, strips anything after `?`.
- `crmUrl()` **deletes every key in `CRM_FILTER_KEYS = ["project_id","employee_id"]` on every
  navigation** so stale list filters can't leak across pages. A `?k=v` suffix on a path becomes a
  *sibling* param, never part of `p`.
- `crmNavigate(path)` does `pushState` **plus a manually dispatched `PopStateEvent`** — that synthetic
  popstate is the entire notification mechanism; two listeners consume it (`CrmRouter:84`, `CrmApp:580`).
- `CrmLink` renders a real `<a href>` and bails out of `preventDefault` for ctrl/meta/shift/non-left
  clicks, so middle-click and ctrl-click open real tabs.
- `matchRoute` is **exact-segment-count**, so only same-depth siblings can collide.

### CRM route table — `crm/routes.ts:53-93`, 39 routes in declaration order

| Path | Component | Path | Component |
| --- | --- | --- | --- |
| `` | CrmDashboardPage | `timesheets` / `timesheets/:id` | Timesheets.tsx |
| `customers` / `customers/:id` | Customers.tsx | `pos` / `pos/:id` | Finance.tsx |
| `opportunities` | **OpportunitiesWorkspace** | `invoices` | Finance.tsx |
| `opportunities/:id` | Opportunities.tsx | **`invoices/tax-generator`** | TaxInvoiceGenerator |
| `requirements` | RequirementsListRedirect | `invoices/:id/tax-invoice` | invoice/InvoicePage |
| `requirements/:id` | Requirements.tsx | **`invoices/:id`** | Finance.tsx |
| `candidates` / `candidates/:id` | CrmCandidates.tsx | `tds` | Finance.tsx |
| `profiles` / `profiles/:id` | Profiles.tsx | `finance-reports` | FinanceReports |
| `calendar` | Calendar.tsx | `payroll` | Payroll |
| `projects` / `projects/:id` | Projects.tsx | `employees` / `employees/:id` | Employees.tsx |
| `project-employees` / `:id` | ProjectEmployees(.Detail) | `users` | UsersAdmin |
| `my-leave` | MyLeave | `access-templates` | AccessTemplates |
| `branch-policy/:id` | BranchPolicy | `settings` | CrmSettings |
| `leave-applications` | LeaveApplications | `reports` | CrmReports |
| `holidays` | Holidays | `template-requests` / `profile` | TemplateRequests / Profile |

**Ordering audit: CLEAN.** The only literal/parametric pair at equal depth is `invoices/tax-generator`
before `invoices/:id` — correct. **No test enforces this**; adding e.g. `pos/reports` after `pos/:id`
would silently 404.

Note `requirements` (list) redirects into the merged Opportunities workspace, but `requirements/:id`
still renders the full `RequirementDetailPage`.

### Sidebar — `crm/nav.ts`, 17 entries

| path | roles | path | roles |
| --- | --- | --- | --- |
| `` Dashboard | all 7 | `project-employees` | Admin, Sales, Sales_Head, HR, Finance |
| `customers` | Admin, Sales, Sales_Head, TA | `holidays` | Admin, HR |
| `opportunities` | Admin, Sales, Sales_Head, RMG, TA | `pos` / `invoices` | Admin, Finance |
| `candidates` | Admin, TA, Sales, Sales_Head | `employees` | Admin, HR |
| `template-requests` | Admin, TA, RMG | `reports` | all 7 |
| `profiles` | Admin, Sales, Sales_Head, RMG, TA | `users` | Admin, CEO |
| `calendar` | Admin, **CEO**, TA, RMG | `access-templates` | Admin, CEO |
| `projects` | Admin, Sales, Sales_Head, HR, Finance, RMG, TA | `settings` | Admin, CEO |

**`HUB_COVERED` (`CrmApp.tsx:684`) = `{project-employees, holidays, pos, invoices}` — 4 entries.**
Users with Customers access lose those sidebar entries (customer-first is their road); users without it
keep them (the sidebar is their only road). Three deliberate exclusions, documented at `:678-683`:
`opportunities` (also the Requirements workspace), `timesheets` (its own attendance hub),
`projects` (became the project hub).
`opportunities` shows if **either** the `opportunities` or `requirements` tab is allowed (`:697`), and
`crmNavItemActive` highlights it for requirement deep links.

**22 routes have no sidebar entry** — mostly deliberate hub tabs. The outlier is **`tds`**: it is in
`MANAGEABLE_TABS` but reachable only from a StartHere link (`CrmDashboard.tsx:803`), and ⌘K indexes
`CRM_NAV` only (`PlatformTopBar.tsx:144`), so ⌘K does **not** find it. TDS is deep-link-only.

---

## 4. RBAC — `src/lib/rbac.ts` is the contract

Roles (`:23`): `Admin, Sales, Sales_Head, RMG, TA, HR, Finance`. **`CEO` is not in the `CrmRole` union**
but is handled at runtime: `isAdmin(roles) = includes("Admin") || includes("CEO")` (`:73`);
`isSuperAdmin` is an alias (`:78`).

Tab keys are namespaced: `crmTabKey(path)` → `crm:<path>` (empty path → `crm:dashboard`),
`ivTabKey(view)` → `iv:<view>`.

**`MANAGEABLE_TABS` (`:108-146`) = 28 entries** — 6 Interview Platform + 22 CRM.
`iv:` — dashboard, templates, candidates ("Reports"), ats, promptLogs ("AI Logs", `[]`), integrityLogs.
`crm:` — dashboard (**mandatory**), customers, rate-cards, opportunities, candidates,
template-requests, profiles, calendar, projects, project-employees, timesheets, my-leave,
leave-applications, holidays, branch-policy, pos, invoices, tds, employees, reports, users (`[]`),
settings (`[]`).

⚠️ **Five routed tabs are *not* in `MANAGEABLE_TABS`** — `finance-reports`, `payroll`,
`access-templates`, `profile`, `requirements` — yet `CrmReports.tsx:118`, `Timesheets.tsx:499` and
`CrmApp.tsx:700` all call `crmTabVisibleFromMe` for three of them. Those keys can only ever arrive from
a server template, never from the Users-admin modal.

**`TAB_FIELDS` (`:175-204`) — 3 tabs only**: `crm:opportunities` (9 fields), `crm:customers` (6),
`crm:candidates` (7). `fieldAllowed` returns **true for any tab absent from the map**.

`defaultLanding(_roles)` (`:268`) **returns `"crm"` unconditionally** — the argument is ignored.

### `crm/useAccess.ts` — the client mirror of `crm_deps._gate`

`modeSatisfies` with `MODE_RANK = {view:1, edit:2, create:3}`; precedence (`:85-88`) is
superadmin / `access.full` → true; **templated → the template alone decides, roles ignored**;
otherwise `rolePermitted`. Both bare and `crm:`-prefixed keys are accepted.
Public surface: `crmTabVisibleFromMe`, `canAct`, `canEditTab`, `canViewField`, `canEditField`,
and the hooks `useCrmAccess(tab)`, `useCanEditTab(tab)`, `useCanAct(tab, mode, rolePermitted)`.
**Pages pass `useHasRole(...)` as the untemplated fallback.** That is the correct idiom — copy it.

### Every place RBAC fails open (8)

1. **`App.tsx:251` — `rbacActive = roles.length > 0`.** A failed, 403'd or absent `/api/me` leaves
   `roles = []`, so every view is allowed and `canCrm` is hard-coded true. Deliberate (legacy HR users),
   and it mirrors the backend's `enforce_roles()`.
2. **`App.tsx:267` — `questionBank` gates on `/auth/me`'s `is_super_admin`, not `rbac.isSuperAdmin(roles)`.**
   Two definitions of super-admin in one shell.
3. `useAccess.ts` — `visible_tabs == null` short-circuits to full access ("no template = unrestricted").
4. `rbac.ts:211` — `fieldAllowed` returns true when the tab is absent from `field_access`.
5. `rbac.ts:232` — `tabVisible` returns `rolePermitted` when `tabAccess == null`.
6. `CrmApp.tsx:220` — the notifications poll swallows every error.
7. `App.tsx:237` / `CrmApp.tsx:634` — the live access refresh ignores failures; access can only widen,
   never narrow.
8. **`AccessTemplates.tsx`, `TaxInvoiceGenerator.tsx`, `MyLeave.tsx`, `FinanceReports.tsx`,
   `EmployeeHistory.tsx` have no in-page gate at all.**

⚠️ **There is no route-level authorization.** `CrmRouter` (`router.tsx:89-99`) renders any matched
pattern; nav filtering is cosmetic. Typing `?view=crm&p=users` renders `UsersAdminPage`; only its own
`useHasRole()` at `:1123` and the server's 403s stop anything. **Any new privileged screen must assume
it will be reached and rely on the server.**

---

## 5. The CRM app (`src/crm/`)

`CrmApp.tsx` (887 L) is the shell: animated sidebar ↔ 60 px rail (persisted in
`localStorage["crm.sidebar.collapsed"]`), mobile drawer, `NotificationsBell`, a `Suspense`-wrapped
`CrmRouter`, and `GET /api/ui-text` hydration into `statusHelp` (`:589`).
`openNotification` (`:295-311`) validates deep links before navigating (same-origin CRM `p=` params only;
rejects absolute and protocol-relative URLs) — **preserve this verbatim.**

**API layer — `crm/api.ts` (160 L).** `crmGet/crmPost/crmPut/crmPatch/crmDelete` + `qs` + `crmUpload`.
`request()` (`:75-92`): parse the body (falling back to raw text), **throw when `!res.ok` OR when the
body has `success === false` — even on a 200** (`:84`), unwrap `{data, meta, message}` when a `data` key
exists, otherwise return the raw body as `data`. `CrmApiError {status, errors}`.
`formatApiError` (`:52`, module-private) humanizes pydantic 422s: `loc` drops `"body"`, `"details"` and
pure-numeric segments, leaf is Title-Cased, message matched against 12 regex→phrase pairs with `$1`
back-references; **unknown messages pass through untouched**.

**Page inventory** (30 pages in `crm/pages/`, plus `opportunity/` ×5 and `profiles/` ×6).
The heavy ones and what they own:

| File | Ln | Owns | Gating |
| --- | --- | --- | --- |
| `Timesheets.tsx` | 3,854 | Attendance hub. Report tabs (Due · Submit for Approval · Approvals · All) + hub tabs (Payroll · My Leave · Leave Applications, rendered as `embedded` children). Entry grid, `computeBillables` client mirror, paid-vs-LOP split, four report panels, invoice preview, rate editor. | `useHasRole` only |
| `Requirements.tsx` | 3,478 | Requirement workflow + resume/ATS pipeline; `StatusStepper`; role-dependent tabs incl. Sales_Head Approval Queue and RMG Engineering Review Queue; slots/bookings; Applicants + Suggested Candidates. Fans out `Promise.all` over statuses because the API takes one `status`. | `useHasRole` only — **no `useCanAct` anywhere** |
| `Profiles.tsx` | 2,768 | Candidate × opportunity pipeline. Detail tabs: Overview · Interviews · Skill Evaluation · Offers · Activity Log · AI Interview. Renders **only** `detail.allowed_next_statuses`; every transition needs a ≥5-char comment. | mixed — `useCanAct("profiles","edit")` + per-field `fld()` + `useHasRole` |
| `Finance.tsx` | 2,524 | **Five routed components in one file**: POs (`:332`), PO detail (`:1183`), Invoices (`:1651`), Invoice detail (`:1981`), TDS (`:2458`). PO wizard, renewal, GST slabs, payments. | `useCanAct("pos"\|"invoices","edit", useHasRole("Finance"))` |
| `Employees.tsx` | 2,412 | HR directory, per-section edit/save with dirty tracking, education/experience subforms, leave matrix. | `useCanAct("employees")` + **field-level** `canEditField("current_ctc")` |
| `opportunity/NewOpportunityForm.tsx` | 2,359 | Schema-driven wizard. Merged "Commercials & CTC Slab" step, rate-card prefill, branch-policy prefill, attachments. **10 suppressed `exhaustive-deps`.** | `useHasRole` only |
| `Customers.tsx` | 1,966 | The customer hub. Detail tabs: Opportunities · Projects · Project Employees · POs · Invoices · Holidays · Branches · Contacts · Documents · Billing Policy — each `useCanAct(...,"view",…)`-gated, each linking into the *same* detail pages. Exports `CustomerScopedTable`, `hubMoney`. | `useCanAct("customers")` + `isReadOnly` |
| `CrmCandidates.tsx` | 1,705 | Candidate master + outreach + education/experience/skills. Strips locked fields from the payload before save (`:532`). | `useHasRole` + `useCrmAccess("candidates").locked()` |
| `Opportunities.tsx` | 1,599 | Opportunity detail (tabbed: Details from `OPPORTUNITY_SCHEMA` · Applicants · Skill Evaluation · Activity Log). Exports **`SuggestedCandidatesTab`** — also imported by Requirements, so TA and Sales share one matcher. | `useCanAct("opportunities")` + Sales_Head checks |
| `UsersAdmin.tsx` | 1,445 | Users, roles, tab access, access-template assign, email flows, action permissions, portal login control. | `useHasRole()` (admin-only) |
| `CrmSettings.tsx` | 1,345 | Masters · Organisation · Operations (scheduler/backup status) · Settings KV · **Customer Policies matrix**. | `useHasRole()` |
| `Projects.tsx` | 1,300 | The project hub: Projects · Project Employees · Timesheets · POs · Invoices. Detail: Overview · Team · Timesheet · PO & Invoices · Communication Matrix. | 8 × `useCanAct` |
| `ProjectEmployeeDetail.tsx` | 1,211 | PE tabs: General · Leave · Holidays · Timesheet · Invoice; rate history. | `useHasRole` only |
| `CrmDashboard.tsx` | 909 | Role-conditioned widgets + `/api/dashboard/my-work` + `StartHereCard`. | role-conditioned |
| `Holidays.tsx` 923 · `Calendar.tsx` 932 · `ProjectEmployees.tsx` 797 · `RateCards.tsx` 709 · `BranchPolicy.tsx` 683 · `LeaveApplications.tsx` 605 · `EmployeeHistory.tsx` 580 · `Profile.tsx` 464 · `TemplateRequests.tsx` 445 · `AccessTemplates.tsx` 349 · `FinanceReports.tsx` 339 · `Payroll.tsx` 277 · `CrmReports.tsx` 275 · `OpportunitiesWorkspace.tsx` 145 · `MyLeave.tsx` 130 · `TaxInvoiceGenerator.tsx` 95 | | | |

`BranchPolicy.tsx` is the **most thoroughly templated page** — 8 `useCanAct` calls covering its 8 tabs
(Policy & Billing · Opportunities · Projects · Timesheets · Invoices · POs · Employees Working · CTC Slab).
`TemplateRequests.tsx:290` is the only CRM page that calls the **legacy interview API** (`/job/configs`).

**The Opportunity form is declarative.** `opportunity/opportunitySchema.ts` (471 L) holds one
`OPPORTUNITY_SCHEMA: SectionDef[]`; `FormRenderer.tsx` (457 L) is the only renderer;
`opportunityFormState.ts` (319 L) keeps a per-type `detailsByType` bucket so switching type and back
restores values; `ctcSlab.ts` (250 L) is the pure maths.
**`services/opportunity_form_schema.py` and `services/opportunity_ctc.py` are the backend parity twins.**

**Component library — `crm/components/ui.tsx` (593 L)**: `statusColor`/`statusLabel`/`StatusBadge`
(with `STATUS_LABEL_OVERRIDES` renaming display-only, e.g. `L1_Feedback` → "Customer L1 Interview"),
`Modal` (portal, scroll lock, focus trap, **`dirty` prop** — Esc/backdrop/X confirm before discard),
`ConfirmModal` (with the 409 "delete blocked → deactivate instead" secondary action), `Tabs`, `KpiCard`,
`Field`, `inputCls`, `TeachingEmpty`'s siblings. ⚠️ **`ui.tsx` has zero test coverage.**

Other pieces worth knowing before reinventing them: `DataTable.tsx` (22 consumers) ·
`TableCustomizer.tsx` (per-**user** column layout stored server-side at `/api/me/table-preferences/{key}`;
only Profiles uses it) · `RowActions.tsx` + `afterListDelete` (12 pages) · `AiInterviewCell.tsx`
(**the single source of truth for AI L1 outcome** — a recruiter's decision outranks the AI verdict but
the verdict stays visible) · `ScheduleAiInterviewModal.tsx` (extracted from Profiles so Calendar could
use it without pulling a 3,000-line bundle) · `SearchableSelect` (9 consumers) · `FileUpload` (8) ·
`BranchHubTabs.tsx` (the branch hub's 6 tabs) · `TeachingEmpty` (11 pages) · `ScoreIndicator`
(`SCORE_THRESHOLDS = {strong:85, good:70, moderate:55}`).

**`crm/lib/` — small modules with real reasons:**

- `calendarDates.ts` (222) — all date maths in **local wall time**; the backend returns naive local ISO
  and converting to UTC would shift every interview.
- `candidateEmail.ts` — importers synthesise `<name>.<hash>@import.karnex.in` because `candidates.email`
  is UNIQUE NOT NULL. Use `displayEmail`/`realEmail` so placeholders are never shown or mailed.
- `fetchAllMaster.ts` — pages at 100/request because the backend clamps `limit` to 100 and `?limit=200`
  silently truncated the skills dropdown.
- `sanitizeHtml.ts` (111) — allow-list sanitiser for `mammoth` .docx preview. CVs arrive via the
  **public** apply form and the auth token lives in `localStorage` on this origin. ⚠️ Security-critical
  and **untested**.
- `phone.ts` — the only module allowed to import `libphonenumber-js`.
- `timesheetAttendance.ts` — ⚠️ hardcodes `hours ≥ 8 → Present, ≥ 4 → Half_Day`; the backend uses policy
  thresholds. See §8.
- `statusHelp.ts` — `STATUS_HELP` + `setUiTextOverrides`, hydrated from `GET /api/ui-text`.

---

## 6. Design system

Load order is canonical: `main.tsx` → `styles.css` → `styles/tokens.css` → `design-system/tokens/tokens.css`.

**`design-system/tokens/tokens.css` (292 L) — primitives, currently v4 "JobDiva enterprise":**

- **Brand is ROYAL BLUE, not indigo**: `--brand-500 #3b82f6`, **`--brand-600 #2563eb` = primary action**,
  700 `#1d4ed8`, 800 `#1e40af`, 900 `#1e3a8a`, 50 `#eff6ff`.
- **`--violet-*` is now DEEP NAVY** (500 `#1d4ed8` … 800 `#172b66`) — the name is kept for compatibility;
  it is a gradient far-stop only.
- `--accent-*` cyan, used sparingly. Semantics: success `#047857`, warning `#b45309`, danger `#c81e2c`,
  info `#075985` (+ `-soft`), with `.dark` overrides. `*-500` anchors are decorative, **not text-grade**.
- Type: Inter / Space Grotesk / mono; scale **12/14/16/20/24/32**; `--leading-body 1.5`.
- Spacing: strict 4 px grid.
- **Elevation: exactly four** — `flat / raised / overlay / modal` (+ `--backdrop`).
- **Radii: exactly three + pill** — `--radius-input 6`, `--radius-card 10`, `--radius-modal 16`, pill.
- **Motion: exactly two durations + one curve** — `--motion-micro 150ms`, `--motion-panel 250ms`,
  `--ease-out cubic-bezier(0.2, 0, 0, 1)`.

`design-system/tokens/tokens.ts` (153 L) is the typed static hex mirror for recharts (which resolves
colours once) plus a `cssVar()` escape hatch.

**`styles/tokens.css` (961 L)** is the alias/recipe layer and **all 33 named utility classes**:
`.glass` · `.elev-1/2/3` · `.btn-depth` (+ `.btn-gradient`) · `.input-recessed` (+ `.input-error`) ·
`.shimmer` · `.row-hover` · `.nav-pill-gradient` · `.sheen` · `.ai-surface` · `.ai-generating` ·
`.ai-thinking` · `.fx-aurora` (+ `.fx-aurora-hero`, `.moonlight` alias) · `.fx-spotlight` · `.fx-noise` ·
`.fx-grid` · `.fx-gradient-border` (+ `-animated`) · `.fx-glow` (+ `-hover`) · `.fx-lift` ·
`.fx-hairline-b` · `.text-display` · `.kx-chrome-navy` · `.tnum`.
Aliases: `--dur-fast/base → micro`, `--dur-slow/page → panel`, `--ease-spring-ish → --ease-out`
(spring is **retired**), `--r-xl` deprecated → modal 16.
Plus the SCORE SCALE (`--score-strong/good/moderate/weak`, teal/indigo/amber/rose — deliberately **not**
a traffic light; colour is a redundant channel behind arc length + numeral + word).
Five `prefers-reduced-motion` guards. **Keep every animated effect inside one.**

`tailwind.config.cjs` (159 L) maps utilities to those vars. **`rounded-panel` is 10 px, not 16** —
deliberate ("panels are cards"). `ease-spring` is a retired alias.

Theme: `theme/ThemeProvider.tsx`, keys `karnexTheme` / `karnexUiDark` / `karnexAccent`; toggles both
`.dark` and `.kx-dark` on `<html>` and sets `data-accent`. **8 accents** (indigo, blue, teal, emerald,
amber, rose, fuchsia, multi); indigo is the default and sets no attribute. A pre-hydration script in
`index.html` mirrors this to avoid a flash.

⚠️ **Documentation staleness — do not trust `DEPTH_SYSTEM.md`.** It claims radii 8/12/16/24 (actual
6/10/10/16), four durations 100/150/250/400 (actual two: 150/250), `--ease-out cubic-bezier(0.16,1,0.3,1)`
and a live spring curve (both wrong), and `--brand-500 #0d8ecd` blending toward indigo (actual `#3b82f6`
royal blue). `DESIGN-DECISIONS.md` is one major version behind on colour (§2 and §14 document the v3
indigo ramp) but **§5 elevations, §6 radii and §7 durations are accurate**. Read it for the *reasoning*,
check `tokens.css` for the *values*.

`scripts/check-contrast.mjs` exists and exits 1 on WCAG failure. **It is not wired into CI — there is no
`.github/workflows/` directory at all.** Lint, typecheck, contrast and vitest are all manual.

---

## 7. Building, testing, deploying

```bash
cd frontend/admin-dashboard
npm ci
npm run dev            # :5173/admin/, proxies 24 prefixes to VITE_BACKEND_URL || 127.0.0.1:2020
npm run build          # vite build → dist/
npm run typecheck      # tsc --noEmit   ← currently GREEN, zero errors
npm run lint
npm run test:run       # vitest — 10 files, ~92 cases
node scripts/check-contrast.mjs   # WCAG gate; exits 1 on failure. Not in CI.

cd ..\..                # repo root
npm run build          # the full Vercel-equivalent build
```

**Vercel**: `scripts/vercel-build.mjs` copies `dist/` → `frontend/admin/` and then **rewrites
`vercel.json` in place** from its own `apiPrefixes` array (2 rewrites per prefix + 2 SPA rewrites = 50).
`vercel.json` is generated output, not source of truth. Default backend
`https://ai-interview-backend-u6y0.onrender.com`.

Build config: `base: "/admin/"`, `esbuild.drop = ["console","debugger"]` in prod, manual chunks
`vendor-react | vendor-icons | vendor-motion | vendor-charts | vendor-pdf`, `vendor-pdf` excluded from
modulepreload, `chunkSizeWarningLimit: 400`.

### API prefixes — verified three-way

`vite.config.ts::API_PROXY_PREFIXES` (24) and `scripts/vercel-build.mjs::apiPrefixes` (24) are the
**same set** — the vercel entries carry no leading slash (`"api"` vs `"/api"`) and the order differs,
but after normalising they are equal. Every URL the app actually fetches falls under
`/api`, `/job`, `/hr`, `/interview`, `/ats`, `/auth` or `/version`.

🔴 **But two backend prefixes are missing from BOTH lists: `/apply` and `/book`.**
`Requirements.tsx:2848` builds the recruiter-visible booking link as
`` `${window.location.origin}/book/${b.token}` ``; on the Vercel origin there is no rewrite, so the
candidate gets the SPA shell or a 404. The TA apply link (`GET /api/requirements/{id}/apply-link`) is
safe only because the backend generates it from its own `request.base_url`.
**Adding an API prefix means editing three files**: `vite.config.ts::API_PROXY_PREFIXES`,
`scripts/vercel-build.mjs::apiPrefixes`, and the backend router registration.

### Tests — 10 files, ~92 cases

| File | Pins |
| --- | --- |
| `lib/rbac.test.ts` | `defaultLanding` = "crm" for all roles; per-role interview nav; Integrity excludes RMG; AI Logs admin-only |
| `crm/pages/opportunity/ctcSlab.test.ts` | 13 cases — billing bases, `max_billable_hours_month` replacing the calendar derivation, Per-Month not prorated, blank ≠ NaN, Exp Max midpoint, RFI formula, Fixed_Price period |
| `crm/pages/TimesheetApprovals.test.tsx` | 12 cases — no row-level approve, "Review" vs "Open" labels, HR sees no decision buttons, Admin/CEO via `isSuperAdmin`, PO gate before Generate Invoice, rate editing |
| `crm/pages/opportunity/opportunityFormState.test.ts` | shared-key mirroring, `applyBranchContactDetails`, payload coercion |
| `crm/pages/opportunity/opportunitySchema.test.ts` | option lists, section order, CTC Slab present per type, conditional fields |
| `crm/pages/OpportunitiesWorkspace.test.tsx` | one sidebar entry, requirement deep links highlight it, per-role sub-tabs, RMG sees none |
| `crm/pages/ProjectEmployees.test.tsx` | 7 cases on `deriveRateSchedule` (expiry, boundaries, current vs future) |
| `crm/lib/timesheetAttendance.test.ts` | inclusive thresholds, applies only to working non-leave rows |
| `crm/lib/phone.test.ts` | India parsing, display→E.164 on save, contact autofill |
| `crm/pages/pipelineStageLabels.test.ts` | 4 literals. ⚠️ its second test is **tautological** (iterates the same map it asserts against) |

⚠️ **`vitest` cannot run against a Linux mount of a Windows checkout** — `node_modules` was installed on
Windows, so `@rollup/rollup-linux-x64-gnu` is missing and Vite fails at startup. A clean `npm ci` on the
target platform is required first. `tsc --noEmit` runs fine either way and is currently green.

---

## 8. Parity twins — the client engines that mirror the server

**Nothing in either repo cross-checks a client engine against its server counterpart.** Both sides have
tests that pass against their own assumptions. Measured divergences as of 18 Aug 2026:

| Twin | State |
| --- | --- |
| `ctcSlab.ts::calculateBillingBases` ↔ `services/opportunity_ctc.py` | ✅ **agree exactly** on all four user-confirmed scenarios: nothing billable 227 (+12 paid = 239); holidays+weekoff billable with 24 leave and 12 paid = 353; everything billable = 365. Same `min(paid_leaves, leave_deducted)` cap. |
| `ctcSlab.ts` appraisal-cycles power rule | ✅ agree on the pinned figures (5→7 = 130009.09, 6→7 = 143010, 7→10 = 118190.08). ⚠️ **Diverge on fractional bands**: backend `int(target − exp_min) − 1`, frontend `Math.round(...) − 1`. exp_min 5 → target 7.5 gives 1 cycle server-side, 2 client-side (₹90,909 vs ₹82,645). Legacy non-digit `appraisal_cycle` strings ("2.6") also diverge. |
| **`ctcSlab.ts:85-91` branch hours cap** | 🔴 **Client-only.** `max_billable_hours_month × 12` exists in `ctcSlab.ts` and has **no server equivalent**; the server overwrites the slab on both create and update. With cap 180 the form shows 2,160 h / ₹2.16 M and the DB stores 1,816 h / ₹1.816 M — a **19 % silent understatement**. The field is not even in the schema, so it is stripped from the payload. Pinned client-side by `ctcSlab.test.ts:33-60`; the backend suite never mentions it. |
| `Timesheets.tsx::computeBillables` ↔ `services/timesheets.py` | ✅ precedence ladder, comp-off gating and `day_type` authority all match. ⚠️ **Day figure differs**: server returns `ONE` for an unworked billable week-off/holiday; client uses `hours / 8` (1.13 at `min_hours_full_day = 9`). ⚠️ **Attendance derivation differs**: `crm/lib/timesheetAttendance.ts:10-14` hardcodes 8/4-hour thresholds; the server uses policy values. ⚠️ Hour-cap ordering differs (server caps hours but derives the day fraction from uncapped hours). The client also does **not** implement the Harman "weekend work covers LOP" rule or comp-off-adds-to-Monthly — those are invoice-preview-only. |
| `opportunitySchema.ts` ↔ `services/opportunity_form_schema.py` | ⚠️ **Four drifts.** `project_scope` is server-allowed for Work_Package / Fixed_Price / Retainer but **has no UI field** — those types submit no type-specific data. `project_duration_months` has no field, so Fixed_Price annualisation never gets a duration. `sales_stage` is computed by the form but has no schema field, so `stripHiddenFields` drops it and **it is never persisted** (it lives only in the localStorage draft). `max_billable_hours_month` is prefilled and used in the maths but stripped before submit. `test_opportunity_form_schema.py` only introspects the server's own key sets and cannot catch any of this. |
| GST — **three implementations** | 🔴 `crm/taxInvoice/math.ts:100 computeTotals` **hardcodes 18 %** and ignores the customer's GST slab entirely (and `types.ts:67` hardcodes `DEFAULT_INVOICE_NO = "KRSW26-27-65-VS"`). `crm/components/invoice/utils.ts:99 gstSplit` splits a **server-supplied** `taxAmount` and short-circuits to `opts.stored`. The backend `karnex_gst_tax_and_grand` is the third. Two of the three can disagree with the invoice that was actually generated. |
| Status labels | ✅ no dead labels — all 60 colour entries, 11 `STATUS_LABEL_OVERRIDES`, 46 `STATUS_HELP` keys and 8 `PIPELINE_STAGE_LABELS` map to values the backend still emits. ⚠️ The fallback (`ui.tsx:32`) is visually identical to the deliberate GREY branch, so an unmapped status looks intentional. ⚠️ `Shortlisted → "Customer Shortlisted"` also catches `AtsStatus.SHORTLISTED` — an internally-shortlisted resume is mislabelled. Uncoloured backend values worth adding: `EmailStatus.SKIPPED/SENT`, `AttendanceStatus.WEEK_OFF`, `DayType.WORKING/WEEK_OFF`, `TemplateRequestStatus.*`, the live `POType` values, `Priority.HIGH`, all four `OppType`. |

---

## 9. Bugs, gaps and hygiene

### Access / correctness

1. **13 CRM pages have no Access-Template awareness** — they gate on `useHasRole` alone:
   `Calendar`, `CrmDashboard`, `CrmSettings`, `Holidays:78`, `LeaveApplications:90`,
   `OpportunitiesWorkspace`, `Payroll:82`, `ProjectEmployeeDetail:499/675`, `Requirements` (all 11 gates),
   `TemplateRequests:87`, `UsersAdmin:1123`, `NewOpportunityForm:187`, `profiles/ProfilesListPage:69`.
   Per `useAccess.ts`'s own documented precedence, a templated user's grants are simply **ignored** on
   these pages — in both directions. This list is the backlog.
2. **`AccessTemplates.tsx` — the page that edits access — has no gate call of its own.**
3. **`App.tsx:191-200` never reads `field_access` or `access`** — only `roles` and `tab_access`.
   So Access Templates cannot restrict the Interview Platform at all. `CrmApp.tsx:606` reads the full `Me`.
4. **`crm/api.ts:137` — `crmUpload` reads `localStorage.authToken` directly and never routes through
   `authFetch`.** A 401 mid-upload is reported as a generic upload failure; the session is not cleared
   and the reload never fires, so the user keeps clicking a dead button.
5. **`api/client.ts:135/:156` — `apiPut`/`apiPatch` invalidate only `/hr/dashboard`**, while `apiDelete`
   invalidates four prefixes. Editing a template leaves the 45 s `/job/configs` cache stale.
6. **`api/client.ts:43-47` — `authFetch` reloads the whole page on any 401.** `SessionKeeper` mitigates
   *expiry*, but a 401 from a revoked role discards every unsaved form.
7. **86 fully-swallowed catch blocks** (`catch {}`, `.catch(() => {})`). Many silently blank a dropdown
   the user then can't fill — `Employees.tsx:378-380` (departments / designations / managers), `:1839`,
   `:2112`; `Customers.tsx:1759`; `CrmCandidates.tsx:197`; `BranchHubTabs.tsx:132`;
   `CustomerFormModal.tsx:324/327/330/418`; `BranchWizardModal.tsx:594/619/694`;
   `EditProjectWizard.tsx:356/371`. The form then submits with a missing FK and the user sees a 422 for
   a field they were never offered.
8. **`CrmApp.tsx:164/:192` — `seenRef` is an unbounded `Set<number>`**, grown by every polled
   notification id for the life of the tab.
9. **`router.tsx:34-48` — `crmUrl` only deletes `project_id`/`employee_id`.** Platform params
   (`cid`, `iid`, `ret`) survive every CRM navigation, so a copied URL can carry a stale candidate id
   back into `readInitialView` on reload.
10. **`Requirements.tsx:960` fans out `Promise.all` over statuses** — an N-request list load whose
    partial failure mode is a rejected `Promise.all` (one 500 fails the whole tab).
11. **37 `eslint-disable react-hooks/exhaustive-deps`**, 10 in `NewOpportunityForm.tsx` alone. That
    2,359-line form with an 8-effect prefill chain is where stale-closure bugs will surface first.

### Half-finished refactors — finish or delete before building on them

12. **Two wizard chromes.** `crm/components/wizard/index.tsx` (760 L, 10 consumers) and
    `crm/components/WizardChrome.tsx` (493 L, 2 consumers: CustomerFormModal, NewOpportunityForm) export
    the same eight symbol names. A fix to one will not reach the other.
13. **Two `ProfilesListPage`s.** `crm/pages/Profiles.tsx:321` (inside the 2,768-line monolith) is the one
    wired into `routes.ts`; `crm/pages/profiles/ProfilesListPage.tsx:62` (373 L, with the extracted
    `ProfileToolbar` / `ProfileCardGrid` / `ProfileSummaryStrip` / `useProfileFilters` / `profileColumns`)
    is **unrouted**.
14. **Two tax-invoice generators.** `crm/components/invoice/` (server-driven, the live one) and
    `crm/taxInvoice/` (older manual generator with the hardcoded 18 % GST and seller block).

### Accessibility

15. **Six `jsx-a11y` rules downgraded from error to warn** (`.eslintrc.cjs:27-33`) with a note to flip
    them back page by page; nothing tracks progress.
16. **15 `onClick` on non-interactive elements.** Four are keyboard-inaccessible modal backdrops
    (`DeleteInterviewRecordModal:31`, `CandidateInterviews:165`, `HrDashboard:253`, `UpcomingInterviews:120`);
    the rest are `stopPropagation` shields inside clickable rows, which make the *row* keyboard-hostile.
17. Four `<img>` without `alt` (`KarnexBranding:40/48`, `Avatar:62`, `invoice/Declaration:20`).
    `HrDashboard:253` uses a raw `bg-neutral-900/60` backdrop instead of the `bg-backdrop` token.

### Security

18. **`FileUpload.tsx:317` is the only `dangerouslySetInnerHTML` in the codebase**, fed by
    `mammoth.convertToHtml` and passed through `crm/lib/sanitizeHtml.ts`. The arrangement is correct —
    but that makes a **111-line allow-list with zero tests** security-critical.
19. `CrmApp.tsx:295-311 openNotification` validates deep links correctly. Preserve it.

### Repo hygiene

20. 🔴 **`src/components/SessionKeeper.tsx` is untracked but imported and mounted by `App.tsx:6/367`** —
    a fresh clone of the committed tree **will not compile**. Commit it.
21. `frontend/admin-dashboard/dist/` is gitignored but **3 files are still tracked**
    (`dist/index.html` — currently modified — plus two logo SVGs). `dist/index.html` is regenerated by
    every build, so it will keep producing spurious diffs.
22. `frontend/admin/` is now gitignored with **0 tracked files** — the previously-documented committed
    production build has been cleaned up. ✅
23. `_to_delete/` and `docs/chat-backups/` are untracked directories in the tree.
24. **One `TODO` in the whole codebase** (`BranchWizardModal.tsx:82`). Two `@deprecated`
    (`rbac.ts:236`, `Timesheets.tsx:724`).
25. **No CI.** No `.github/workflows/`.
26. Two token systems still coexist (v3/v4 `--brand/--surface/--text` and the legacy `--kx-*`), propped
    up by `html.dark .bg-slate-*` `!important` shims in `styles.css` supporting ~2,100 raw `slate-*`
    classes. Documented as debt in DESIGN-DECISIONS §13 along with ~243 arbitrary `[Npx]` values and
    ~154 hardcoded hex in the PDF/chart files.
27. Bundle weight: `vendor-pdf` ~583 KB, `vendor-charts` ~399 KB; 82 backdrop-blur layers await
    migration to `.glass`.

---

## 10. The legacy interview runtime (`frontend/js/`)

27 files / 10,200 lines. Orchestrator is `app.js` (1,146 L), which publishes **34 functions onto
`window`** (`:997-1034`) because `index.html` uses inline `onclick`. **Only 17 of the 34 are actually
referenced by markup.** `state.js` (47 L) is the single shared mutable object, imported by 8 modules
with no ownership rules.

`index.html` is **7,875 lines / 297 KB** — of which the inline `<style>` block is ~6,600 lines (84 %).
Ten screens, **22 inline `on*` handlers**, an importmap pinning `three@0.160.0`,
`@ricky0123/vad-web@0.0.22` and `onnxruntime-web@1.14.0` to jsDelivr, a pre-hydration dark-mode script,
and a `data-invite-bootstrap="1"` attribute set before parsing to prevent a startup-hero flash.
Cache-busting is manual (`?v=20`) — no build step touches this file.

### Candidate flow, in order

boot → `/version` cache-bust (⚠️ **wipes all localStorage and reloads on change**) → welcome card
(never auto-skipped) → **rules gate before any permission prompt** → device test (mic 3.4 s level sample,
speaker 660 Hz tone, webcam optional, network via `/healthz`) → a defence-in-depth re-check of the
persisted state → invite lookup → optional email + access-key verify (`x-device-id` sent explicitly) →
`POST /candidate/invite/{token}/login` (handles `scheduled_wait` with an `HH:MM:SS` countdown) →
`startInterviewTimer()` → **fullscreen gate** → `GET /next` → `initProctoring` →
`activateInterviewSecurity` + face monitoring → turn loop → `submitInterview()` which awaits
`POST /submit` (3 attempts × 12 s, plus a `keepalive` unload backup) before redirecting to
`/thank-you.html` or `/interview-terminated.html`.

**Turn loop**: render → `POST /candidate/tts` (MediaSource streaming, resolves on `ended` not `play()`,
blob fallback, 6 s watchdog) → open mic (`MediaRecorder`, `audio/webm`, 250 ms chunks) → VAD segments →
`POST /candidate/transcribe` → silence ≥ threshold → `POST /candidate/analyze-answer-completion` →
`POST /answer` (form-encoded: `ans`, `action`, `skip_reason`, `auto_advance_meta`).
**409 `speech_blocked`** resumes listening instead of advancing.

### Speech stack — three cooperating layers

1. **FFT VAD** (`interview_auto_advance.js`, 1,064 L) — 300–3400 Hz band, 1 s calibration taking the
   **75th percentile** of RMS as the noise floor, then `threshold = max(cfg || 0.038, floor × 4.0)`,
   hangover at ×0.65, confirm 300–500 ms, silence clamped 2500–5000 ms. Speech requires
   `rms ≥ threshold && 0.22 ≤ bandRatio ≤ 0.9 && zcr ≤ 0.38`.
   ⚠️ The initial no-response timer only starts **after** calibration, so the effective silent-skip
   deadline is `initial_response_wait_sec + 1 s`.
2. **Silero** (`vad_silero.js`) — `positiveSpeechThreshold 0.8`, negative 0.58, `minSpeechFrames 3`,
   `redemptionFrames 10`. It is the **authority** wherever the two disagree, and a hard veto on auto-skip.
   Init failure degrades silently to FFT-only.
3. **Whisper segments** (`interview_whisper_segments.js`) — only `onSpeechEndAudio` from Silero, only
   above prob 0.75, 16 kHz mono WAV, blobs < 1200 bytes discarded, all calls serialized.

Web Speech (`_startSpeechRecognition`) starts **only when the VAD+Whisper pipeline is off** — effectively
never in the default config.

### Proctoring — two independent strike counters

`interview_security.js` (612 L) owns 11 violation types, `MAX_WARNINGS = 3` / `TERMINATE_AT = 3` on a
**flat total across all types** (per-type counts are tracked but never used for a decision), a global
1500 ms debounce in `reportViolation`, keyboard lockdown (everything swallowed on capture except Tab and
plain typing in an editable target when transcript input is on), and `POST /interview/violation`.
`face_detection.js` scans every 2 s (native `FaceDetector` → MediaPipe fallback), `MIN_FACES = 2`,
debounce 4500 ms — so **two people on camera for ~9 s terminates the interview**.
A *second*, parallel channel goes to `POST /proctor/violation` with collapsed type names, and the server's
`terminated` flag independently triggers submit. **Neither counter knows about the other.**

### Highest-value fixes, in order

| # | Fix |
| --- | --- |
| 1 | **`showScreenRef("result")` shows nothing.** `createShowScreen` (`hr.js:576`) maps only `{hr, candidate}`, so `candidate.js:1906` blanks the screen after an HR-run interview and orphans `#screenResult` and its five download buttons. One line: add `result: "screenResult"`. |
| 2 | **The scheduled-wait retry is dead.** `app.js:810` passes `() => { proceedWithInviteLogin(); }` with no `return`, so `await onDone()` resolves immediately and the documented 5-attempt retry is unreachable. A failure at the scheduled moment freezes the candidate on "Preparing your interview session…". One word: `return`. |
| 3 | **Internal `submitInterview` calls bypass the teardown wrapper.** Timer expiry (`candidate.js:1988`), premature completion (`:1430`) and proctor termination (`:2074`) call the module function, not `window.submitInterview` — so `stopFaceMonitoring()` and `deactivateInterviewSecurity()` never run, and a fullscreen exit during finalize can re-trigger termination. |
| 4 | **Skip double-submit window.** `candidate.js:1566` checks `_answerSubmitInFlight` but the flag is set at `:1629`, with a ≤4 s `await` in between and the button not disabled. |
| 5 | **Two device-id implementations that disagree pre-login.** `app.js:644-668` keys off the URL token; `invite_device.js` keys off the JWT, which doesn't exist yet, so every pre-login `apiFetch` mints and persists a *different* UUID. Works today only because `/verify` and `/login` pass explicit headers. Also `app.js:665` calls `crypto.randomUUID` unguarded. |

Other live issues: `handleJson` (`core.js:7`) calls `res.json()` before checking `res.ok`, so a proxy's
502 HTML surfaces as `Unexpected token '<'` · a mid-interview 401 reloads the page and drops the
candidate (the backend refuses `/auth/refresh` for invite tokens) · `app.js:932` writes unescaped
`job_title` into `innerHTML` (the only unescaped sink in the candidate path; `results.js` escapes
everywhere) · the `pagehide` guard silently finalizes on mobile app-switch · the sidebar clock
`setInterval` is never cleared · `avatar.js` is 7 lines of no-ops and can be deleted · five
`@deprecated` no-ops in `interview_auto_advance.js` are still wired to `window.cancelAutoAdvance` /
`submitAutoAdvanceNow` · five auto-advance config keys are parsed and never read
(`no_response_extra_wait_sec`, `no_response_countdown_sec`, `max_no_response_warnings`,
`minimum_answer_words`, `minimum_speech_duration_sec`) · the prewarm look-ahead described in the comment
at `candidate.js:185` **does not exist** (`prewarmQuestionAudio` is only called from the `tts_invalidate`
branch) · CDN dependencies have no SRI and no local fallback, so an outage drops Silero VAD to FFT-only
heuristics mid-interview with only a `console.warn`.

⚠️ **Multi-worker**: the client never sends a session identifier — only the bearer. The backend holds
sessions in a process-local dict. With `UVICORN_WORKERS > 1` and no sticky sessions, `/next` and
`/answer` round-robin into workers with no session, and the answer path *swallows* the error.

---

## 11. Readiness for new work

**Safe to extend**

- The route table — a new CRM page is a `routes.ts` entry (respect segment-count ordering), an optional
  `nav.ts` entry, an optional `MANAGEABLE_TABS` key. `matchRoute` is 12 lines.
- The envelope contract — `crm/api.ts` is small, single-purpose and consistently used; any new endpoint
  returning `{success, data, message, errors, meta}` works with zero client changes.
- `useAccess.ts` — adding a gate is one `useCanAct(tab, mode, useHasRole(...))` line, and §9-1 is the backlog.
- Design tokens — four elevations, three radii, two durations, one curve, genuinely enforced in
  `tailwind.config.cjs`. Components that stick to `rounded-control/card/panel/modal`,
  `shadow-raised/overlay/modal`, `duration-micro/panel` and the `text-primary/secondary/muted` triple
  theme correctly in both modes and all 8 accents for free.
- Shared primitives — `DataTable`, `ui.tsx`, `RowActions` + `afterListDelete`, `TeachingEmpty`,
  `SearchableSelect`, `FileUpload` are mature and widely proven. Reach for them first.
- `typecheck` is green — the type layer is a real safety net right now.
- The legacy runtime's decorative and presentational modules: `scene.js`, `brandLogo.js`,
  `interview_time_warnings.js`, `hrAccessDetails.js`, `hrSetupUi.js`, `results.js` rendering,
  and the inline CSS (as long as the JS-toggled class hooks survive: `.active`, `.listening`,
  `.ai-speaking`, `.processing`, `.is-visible`, `.is-active`, `.speaking`, `.warmup`,
  `.countdown-active`, `.hidden`, `.interview-mode`, `.cand-media-gate-dismissed`).

**Fragile — touch with care**

- The four mega-pages (`Timesheets` 3,854 · `Requirements` 3,478 · `Profiles` 2,768 · `Finance` 2,524).
  Each holds 2–5 routed components, its own fetch orchestration, and — for Timesheets — a copy of the
  server's billing maths. Only `TimesheetApprovals.test.tsx` covers any of it.
- `NewOpportunityForm.tsx` — 10 suppressed dependency arrays and a prefill chain reading branch policy,
  rate cards, contacts and org settings.
- The parity twins and the three GST engines (§8).
- The two wizard chromes, the two `ProfilesListPage`s, the two invoice generators (§9-12/13/14).
- RBAC's fail-open surface (§4) — the UI is a convenience layer, **not a boundary**.
- `interview_rules.js` fails **open** when its markup is missing — keep `#screenInterviewRules`,
  `#interviewRulesAck`, `#interviewRulesContinueBtn` or consent silently disappears.
- `device_test.js`'s mic-stream handoff (`_verifiedMicStream`) is what stops a second permission prompt
  mid-interview.
- `core.js::apiFetch` — every call in the runtime goes through it.

**Will break the live interview**

- `candidate.js:1403-1811` (`_transitionToNextQuestion` + `submitCandidateAnswer`) — five overlapping
  guards and three re-entry points.
- `candidate.js:1814-1913` (`submitInterview`) — two role-keyed paths, five callers, the redirect.
- `candidate.js:1168-1310` — the `MediaRecorder` lifecycle; `onstop` is the single funnel and its
  resolver is nulled in six places. A missed resolve eats the answer.
- `interview_auto_advance.js:602-814` — the completion check and `_vadLoop`; the thresholds in §10 are
  mutually calibrated.
- `app.js:761-867` — `proceedWithInviteLogin`; the ordering is load-bearing.
- The `window.*` bridge (`app.js:997-1034`) — deleting a markup-referenced global produces a silent
  `ReferenceError` inside an inline `onclick`. Any rename must edit `index.html` in the same commit.
