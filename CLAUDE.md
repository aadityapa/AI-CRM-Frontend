# CLAUDE.md — Karnex frontend (AI-Interview-Model-F-V2)

Working notes for AI assistants. **Rewritten 18 Aug 2026**, **re-verified 20 Aug 2026** from a full
mechanical scan of both repos (route extraction, per-page API-call inventory, gate-hook census,
token-layer diff, prefix three-way diff, typecheck run). Numbers below were measured.

Companion file: `F:\AI-Interview-Model-B-V2\CLAUDE.md` (backend, FastAPI).

> **Corrections to the previous edition** — `MANAGEABLE_TABS` has **28** entries, not 24. The design
> tokens moved to **v4 royal blue** (`--brand-600 #2563eb`); the old "indigo `#4f46e5`" note and both
> `DESIGN-DECISIONS.md` and `DEPTH_SYSTEM.md` are behind. `frontend/admin/` is no longer a committed
> build. `HUB_COVERED` is 4 entries, not 6.
>
> **Changes since, verified 20 Aug 2026** — `SessionKeeper.tsx` **is now committed**, so a fresh clone
> compiles (old §9-20 closed ✅). `Requirements.tsx` is **3,513** lines, `Opportunities.tsx` **1,800**,
> total **78,898**. `tsc --noEmit` is **still green**. The 39 CRM routes, 17 sidebar entries, 28
> `MANAGEABLE_TABS` keys, 4-entry `HUB_COVERED` and the route-ordering invariant all re-checked and
> unchanged. **The §10 highest-value fix #2 (dead scheduled-wait retry) has been fixed** — see §10.

---

## 1. Two front-ends in one repo

| App | Path | Served at | Stack |
| --- | --- | --- | --- |
| **Admin dashboard** — HR reporting + the whole Karnex CRM | `frontend/admin-dashboard/` | `/admin/` | React 18 + Vite 5 + TS 5 + Tailwind 3 — **78,898 lines / 200 files** (133 tsx + 60 ts + 7 css) |
| **Candidate/HR runtime** — the live interview | `frontend/index.html` + `frontend/js/` | `/` | vanilla ES modules — **27 JS files / 10,200 lines** + a 7,875-line HTML file |

Both call the backend over **relative paths on the same origin**. There is no configurable API base URL
in app code — origin resolution happens in the Vite proxy (dev) or Vercel rewrites (prod). Both share
the same `localStorage` auth keys: `authUser`, `authToken`, `authTokenExpiryIst`.

**Working tree, 20 Aug 2026:** branch `wip/profiles-users-admin`, head **`f807e80`**
("Improve opportunity costing UI, requirements, session keep-alive, and CRM polish").
Nothing merged to `main`.

⚠️ **`git status` reports ~90 modified paths but only 7 have real changes.** The rest is pure CRLF
line-ending churn — `git diff --numstat` shows identical add/delete counts for whole files.
**Always review this repo with `git diff --ignore-all-space`.** A `.gitattributes` with
`* text=auto` would end this permanently; the backend repo has the same problem, worse (170 vs 6).

### In-flight work (uncommitted, 20 Aug 2026) — 7 files, +415/−54

(The 7th is the regenerated `admin-dashboard/dist/index.html`, which is build output — see §9-21.)

| File | What it adds |
| --- | --- |
| `crm/pages/Opportunities.tsx` (+217) | The Suggested Candidates **"Email selected"** flow — multi-select, search/filter, a no-email pre-count, and `POST /api/opportunities/{id}/email-candidates`. Uses `realEmail()` from `crm/lib/candidateEmail.ts` so `@import.karnex.in` placeholders are never mailed. |
| `crm/pages/CrmDashboard.tsx` (+76) | The **TA tracking** widget over the new `GET /api/dashboards/ta-tracking`. |
| `crm/pages/Requirements.tsx` (+89) · `ScheduleAiInterviewModal.tsx` | Surface the backend's new specific "no interview template" 400 instead of a generic failure. |
| `frontend/js/app.js` (+14) · `frontend/index.html` (+64) | Candidate-runtime: the scheduled-wait countdown and startup status now also write `#inviteWelcomeSubtitle`, the hero the candidate actually sees — **and `startInviteCountdown`'s `onDone` was changed from `() => { proceedWithInviteLogin(); }` to `() => proceedWithInviteLogin()`, which fixes §10 highest-value fix #2** (the retry was unreachable because the arrow returned `undefined`). |

**Added 20 Aug 2026 (same working tree)** — the editable candidate email and tab deep-linking:

| File | What it adds |
| --- | --- |
| `crm/pages/Opportunities.tsx` | The per-row **Email** button was a raw `mailto:` link — it handed the recruiter off to whatever the OS had registered (nothing, on the reporting machine) and left no outbox record. It now opens the **same composer as "Email selected"**, scoped to one candidate via `emailTargets` (deliberately *not* the checkbox `selected` set, so a row send can't disturb a bulk selection in progress). Both paths prefill from `GET /api/opportunities/{id}/candidate-email-template`, offer clickable `{{placeholder}}` chips, and preview against the first recipient. The modal opens only **after** the template resolves — opening first and filling in later silently overwrites anything typed in the gap. Bulk sends list every recipient by name (selections survive a filter change, so the count alone is not checkable) and untick who was mailed on success. |
| `crm/pages/Profiles.tsx` | `ProfileDetailPage` gains **`?tab=` deep linking** — `initialProfileTab()` on mount, a `popstate` listener for in-place navigation, `selectTab()` writing back with **`replaceState`** (five tab clicks should not cost five Backs). `PROFILE_TAB_LABELS` is now the single source for both the `<Tabs>` bar and the deep-link allow-list. `load()` also names the profile and distinguishes a 404 from a 500, and clears `detail` on id change so 42 → 99 doesn't render 42's header while 99 loads. |
| `crm/CrmApp.tsx` | `openNotification` forwards **only** `tab`, and truncates the decoded `p` at any `?`/`#` — otherwise a `p` value could smuggle its own query suffix through `crmUrl` and set arbitrary sibling params (`view`, `cid`, `iid`). `decodeURIComponent` is now guarded: a malformed `%` in a stored link used to throw `URIError` inside an async handler, so the click did nothing and the failure was invisible. |
| `crm/router.tsx` | `tab` added to `CRM_FILTER_KEYS`, so it is cleared on every navigation for the same reason the list filters are — it means nothing to the next page. |

Also 20 Aug: `Requirements.tsx` hides the four reference cards (Requirement Details · Budget by
Experience · Skills · Job Description) **on the Applicants tab only** (user decision — that tab is a
candidate list; the other tabs keep them because Resumes needs the JD at hand). The matching backend
change (B-V2 §1) makes every uploaded/applied resume create a Sourcing profile, so the Applicants tab
now shows everyone, not just candidates with a scheduled AI interview.

**The preview in the composer mirrors the server renderer exactly** (one pass, all five tokens,
case- and space-insensitive, unknown tokens left intact). A preview that substitutes a *subset* of
what the server does is worse than none: the recruiter "fixes" a token that was working.

Its backend half is the uncommitted files in `B-V2` (§1 there). The **email path now has 28 tests**
on this repo's server side; the CRM UI and the two dashboards still have none, and the new endpoints
bypass Access Templates — see the B-V2 note before committing.

---

**September 2026 (uncommitted, see B-V2 `CLAUDE.md` dated notes for the server halves):** Settings ▸ Invoice /
Backup / Support Tickets tabs (`crm/pages/CrmSettings.tsx` reads `?tab=`; `pages/settings/BackupTab.tsx`);
`components/support/SupportWidget.tsx` mounted in `App.tsx`; `crm/pages/SupportTickets.tsx` (routes `support-tickets`,
`support-tickets/:id`, no sidebar entry); `crm/components/CustomerGroupedList.tsx` (`CustomerGroupedList`, `ViewToggle`,
`useGroupView` → `localStorage["crm.hub.view"]`) used by Projects · Project Employees · Timesheets · Invoices · Customer
Received Amount; Employees list "Emp ID" column + Profile Workflow `employee_ref`; Profiles/Candidates/Applied
Candidates TA + date + customer filters (`load` deps must list every filter field — a missed dep left the date filter
inert); Timesheets "Apply half-day leave", `lopCoverByRow`, `comp_off_covers_lop` mirror; `CustomerFormModal`
"Loss of Pay in the same month" checkbox; invoice tagline removed from `components/invoice/InvoiceHeader.tsx`.
**14 Sep 2026 — interview times:** the Applied Candidates "Schedule AI L1 Interview" dialog (`Requirements.tsx`,
`scheduleWhen`) now sends `scheduled_at` (datetime-local, IST wall clock, `"T"`→`" "`) — it used to send nothing and
the server stamped the click time. `ScheduleAiInterviewModal` and the manual-round `f2fWhen` inputs already send the
typed wall clock; never `toISOString()` a datetime-local value on these paths (the interview-rounds form in
`Profiles.tsx:3655` does, deliberately — the server converts it back with `ist_naive`).

**16 Sep 2026 — candidate runtime voice + answer capture (see B-V2 `CLAUDE.md` for the server half):** new
`js/question_voice.js` (`speakQuestion(text, {onStart, onStatus})` — server stream → server blob → browser
`speechSynthesis` en-IN; resolves when speech ENDS; `cancelQuestionVoice()`), new `js/speech_transcribe.js` (the one
`/candidate/transcribe` client; throws `TranscribeUnavailableError` on 5xx so callers can tell "service down" from
"silence"), `#candidateVoiceNotice` under the question shows any fallback. `interview_auto_advance.js`: browser
`SpeechRecognition` (en-IN) starts whenever Silero fails to load. `candidate.js`: auto-skip refused while recorded audio
exists and transcription is down; capture snapshot read before `stopAutoAdvanceTurn()`; pre-POST section of
`submitCandidateAnswer` guarded so `_answerSubmitInFlight` cannot wedge; 409 body no longer read twice.
`index.html` `app.js?v=26`.
**16 Sep 2026 (later) — pre-interview polish:** `#screenInviteNotYet` + `showInviteNotYetScreen()` (app.js; countdown, auto re-lookup); `resume` banner in `proceedWithInviteLogin`; `device_test.js` guided mic script (`MIC_STEPS`) + 5 s chime (`_playSpeakerTone`); `js/recording_badge.js` → `#recordingBadge`; Rules/Device Check full-page override CSS block "Pre-interview screens v2" placed AFTER the original rules (order matters — same specificity). `app.js?v=27`.
**16 Sep 2026 (evening) — one-click Send/Skip + resume clock:** `candidate.js` `_pressInFlight` entry lock + `_releasePress()`, `turn` form field on `/answer`, `speech_blocked` 409 → `_startAutoAdvanceForTurn(isWarmup, {autoSkip:false})`; `interview_auto_advance.js` `_autoSkipOffForTurn`; `state.interviewClockSynced` gates the countdown until `time_remaining_sec` arrives. `app.js?v=28`.

**18 Sep 2026 — CEO Revenue report (Reports ▸ Revenue, Admin/CEO only):** `crm/pages/reports/RevenueReport.tsx`
renders `GET /api/reports/revenue?month=YYYY-MM` (all maths server-side; see B-V2 `CLAUDE.md` for the definitions).
Month picker (`<input type="month">` + ‹ ›, `max` = current month, `?month=` honoured on load), four `Kpi` cards with
`Delta` MoM/YoY chips (`text-success` / `text-danger`), recharts `ComposedChart` (bar billed + line collected, palette
from `design-system/tokens`), customer table (share bars, `CrmLink` to `customers/:id`, amber concentration banner
≥ 50 %), ageing table ("90+ days" in danger) + "Who owes us most", Coming up (PO cover < 2 months in danger) /
Efficiency / Leakage panels. `CrmReports.tsx`: `REVENUE_TAB` appended only when `useHasRole()` (Admin/CEO — not
template-widenable), `initialTab()` reads `?tab=` (the dashboard tile links `reports?tab=revenue`), `HOSTED_TABS`
(`financial`, `revenue`) bypass the shared DataTable fetch / CSV export, and a deep link to a tab the user cannot see
resolves to Opportunities (`requestedTab` → `tab`). No new route, nav entry or `MANAGEABLE_TABS` key.
**v2 (same day):** `AlertsStrip` (server `alerts[]`, bad/warn) sits above the KPIs; `TargetsModal` writes
`PUT /api/reports/revenue/targets` three times (this month's override · default monthly · FY) and refetches; target + FY
panels use `Attainment` bars (≥100 green, ≥80 amber, else red); `Gross margin` table (amber note when
`heads_without_ctc`), `Forecast` table (PO cover Yes/No, roll-off names in the cell title), DSO / days-to-pay tiles at
the top of Ageing, `Billing by dimension` (`DimTable` × 3), and the "Excel pack" button streams
`/api/reports/revenue/export.xlsx` through `authFetch` (same blob pattern as BackupTab). `?month=YYYY-MM` deep link is
honoured (the month-close email uses it). Building on the Linux mount: Tailwind's scan hits EMFILE — copy
`src/`, `index.html`, `package.json`, `vite.config.ts`, `tsconfig*.json`, `tailwind.config.cjs`, `postcss.config.cjs`,
`public/` to `/tmp`, symlink `node_modules`, then `vite build --outDir` with the `/tmp/rl` native binaries (§7).

**21 Sep 2026 — positions (headcount) + RMG approval (server half in B-V2 `CLAUDE.md`):**
`crm/pages/Opportunities.tsx` gains a **Positions** column — `PositionsCell` renders "open / total" from
the list endpoint's `positions_open` / `positions_total` (green when nothing is left to source, an amber
"Change" badge when `positions_change_pending`), "—" when the opportunity has no requirement yet.
Deliberately **not sortable**: the value is derived per page. `crm/components/PositionsPanel.tsx` is the
ONE panel, mounted **twice**: under the overview strip on the requirement page (`Requirements.tsx`) and
above the tab strip on the **opportunity detail page** (`Opportunities.tsx`, gated on
`opp.requirement_id`). ⚠️ The opportunity mount is not a convenience — **a Sales login has no route to
the requirement page at all** (the Requirements sub-tab was removed Aug 2026 and `visibleOpportunitySubTabs`
gives Sales only pipeline / sow / applicants), so without it Sales cannot request a change. It shows:
open / filled / total,
"Change positions" for Sales / Sales Head / Admin, an amber pending banner carrying Approve + Reject
(RMG / Admin) and Withdraw (the requester), and a collapsible decision history. The panel **never guesses
from roles** — `GET /api/requirements/{id}/position-requests` returns `can_request` / `can_approve` /
`is_requester` / `min_positions` / `change_blocked` in `meta` and the UI renders that. `PositionChangeModal`
(± stepper clamped to the joined floor, reason ≥ 10 chars) and `PositionDecisionModal` (note required on
reject) POST to the request / approve / reject / cancel endpoints. `PendingPositionChangesPanel` stays in `Requirements.tsx` (list-page only) above
RMG's Engineering Review Queue and links each waiting change to its requirement (deciding happens there —
one place, not two). A failed load renders the reason, never an empty space. ⚠️ The panel's copy says
**opportunity, never "requirement"** — Sales has no Requirements page, so the internal noun must not
leak; the server enforces the same rule (`test_no_user_facing_message_says_requirement`). Positions are
also scoped like the opportunity, not like the requirement: every Sales user opens every deal, so a
colleague's opportunity no longer answers "Requirement not found" (that was the first bug report).
An approved change also writes back to the opportunity, so **Time & Material Details ▸ Positions (Count)
no longer disagrees with the panel** — `onChanged={reloadOpp}` re-fetches `/api/opportunities/{id}`, so
the card updates without a page reload (server half + the RFI-scaling rule: B-V2 `CLAUDE.md`).

**21 Sep 2026 — Revenue report v3 (Reports ▸ Revenue; server half in B-V2 `CLAUDE.md`):**
`crm/pages/reports/RevenueReport.tsx` gains `PeriodSwitcher` (Month · Quarter · Financial year, a
segmented control — not three tabs, because every panel reads the same payload) and `FilterBar`
(customer → project; the project list is scoped to the chosen customer and `pickCustomer` drops a
project belonging to someone else, so the pair can never describe an empty intersection). **The month
input is the ANCHOR at every zoom** (`aria-label` becomes "Anchor month"), ‹ › step by `meta.months`
(1/3/12) so "previous" is always the previous period of the same kind, and "next" is disabled by
comparing today against `period_start`/`period_end` rather than by a month string. `query` is one
memo shared by the fetch AND the Excel pack, so a filtered view can never export unfiltered; the
download is named from `period_key`. Two new panels — **Revenue by project** (billed · share · change ·
heads · cost · margin, linking to `projects/:id` and `customers/:id`) and **Revenue by employee**
(traceable billing · avg per billing head · deployed-with-no-billing count and their cost; a "No
billing" chip on those rows; the `unlinked_billed` warn banner states plainly that manual invoices are
NOT in the table). `Delta` renders a bare "—" when it has no label (a table cell), never "n/a" on its
own. `monthLabelOf()` labels the Targets modal with the ANCHOR month — targets are stored per month, so
the modal must never be titled with the quarter/FY name. `?period=`, `?customer_id=`, `?project_id=`
are honoured on load alongside `?month=`. `trend` title, KPI sub-lines, margin/efficiency/leakage copy
and the concentration banner are all period-aware. No new route, nav entry or `MANAGEABLE_TABS` key.

**21 Sep 2026 (later) — Revenue page redesign + two CSS traps worth knowing:**
the CEO reported the page "glitching". Two of the three faults were real CSS bugs, not taste:
⚠️ **(1) `inputCls` ends in `w-full`.** Appending `w-40` / `w-52` after it does NOT win — both are
single-class selectors, and the generated sheet emits `.w-40`, `.w-52`, THEN `.w-full`, so `w-full`
applies. That is what stretched the month picker and both filter selects edge-to-edge. Anything that
needs its own width must not use `inputCls`; `RevenueReport.tsx` now has a local `CONTROL` constant
with no width. **Check any `${inputCls} w-N` in this repo — they are all lying.**
⚠️ **(2) An alpha modifier on a `var()` token compiles to NOTHING.** `bg-surface-2/60`,
`border-success/30`, `dark:bg-brand-600/20` produce no rule at all, because the theme maps colours to
bare `var(--x)` with no `<alpha-value>` channel. They fail silently — the element simply has no
background. Verified against the built CSS: `.bg-surface-2\/60` does not exist. `BranchWizardModal.tsx`
(`bg-surface-2/40`, `/30`, `/20`) and `AskAiPanel.tsx:138` (`hover:bg-surface-2/60`) are **already
shipping dead classes**. Use tokens at full strength.
Layout: title + period switcher + date stepper + actions + filters now live in ONE `<header>` card
(the old loose flex row wrapped onto three lines at laptop width). `DateStepper` joins ‹ · month · ›
into a single bordered unit so they can never wrap apart. `AlertsStrip` is one card with a "Needs
attention" header, a count, an "N urgent" chip and a **show-more past `ALERTS_VISIBLE`=3** — a stack of
full-width banners was the loudest thing on the page and pushed the KPIs below the fold. `Panel` gained
a bordered header strip + an optional `action` slot and is `h-full` flex so side-by-side panels align.
Tables bleed to the panel edge via `tableWrap`; ⚠️ its `-mb-5` cancels the body padding BELOW the table,
so a panel with a note AFTER the table uses `tableWrapMid` (forecast, ageing, by-employee) or the rows
slide under the paragraph. `thCls` is sticky, and the long project/employee tables scroll inside the
panel (`tableWrapTall`, `max-h-[26rem]`) so the header earns its keep.

**21 Sep 2026 (later still) — full filter lists + Cash flow panel:** `FilterBar` now receives
EVERY customer/project (server change, B-V2 `CLAUDE.md`) and splits them into `<optgroup>`s —
"Billed in this period" / "No billing in this period" — with `(inactive)` appended rather than the row
being dropped. ⚠️ **Never filter an option out of these dropdowns**: the CEO reading two names where he
knows there are dozens reported it as a bug, and "why did this account bill nothing?" is a question the
page must be able to answer. New **Cash flow — next 3 months** panel, placed directly under the alerts
and ABOVE the trend: it is the only panel about the future, and every other one is about a period that
already closed. Four stats (expected in at our pace / people cost out / net position / days paid late),
two "fastest lever" chips (overdue to chase, approved-but-uninvoiced to raise), a month table showing
both the on-terms and at-our-pace columns, and the biggest expected inflows with overdue chips. It is
labelled "as of <today>" because it ignores the selected period by design.

**22 Sep 2026 — closed opportunities leave TA's queue (server half in B-V2 `CLAUDE.md`):**
⚠️ **TA's "Opportunities" sidebar entry does not render the opportunity list.** `OpportunitiesWorkspace`
builds its tab strip from `PIPELINE_TAB_ROLES` / `APPLICANTS_TAB_ROLES` (Admin · Sales · Sales_Head),
so a pure TA gets ZERO tabs and the `!tabs.length` branch renders `RequirementsListPage` instead —
what TA calls an opportunity is really its requirement. That is why closing a deal and hiding its
candidate profiles never removed it from their view; the fix had to move the REQUIREMENT. Worth
knowing before touching either file. `Requirements.tsx`: `TA_FILTER_STATUSES` gains **Closed** and
**Cancelled**, so a TA can answer "where did it go?" — the server keeps them out of the default list
(`TA_LIVE_STATUSES`) and admits them only when the filter names one, so `taMode`'s "All statuses"
still means "everything I work on", not every requirement ever raised. The `taMode` empty state now
says closed deals drop out and how to see them.

**22 Sep 2026 (later) — TA gets the Sales stage tabs + one status everywhere:**
`Requirements.tsx` `TA_STAGE_TABS` mirrors the Opportunities strip (Active · Customer Hold · Sales
Hold · Closed · Rejected · Archived · All) and sends `?opportunity_stage=` (CSV — the "Closed" tab is
three stages in ONE request, unlike `status` which is single and forces the `Promise.all` fan-out).
⚠️ `taMode` is no longer `tabs.length === 0` — a pure TA now HAS tabs, so it is identified by
`tabs === TA_STAGE_TABS`. The status column badges `display_status` (server-derived, B-V2
`CLAUDE.md`): a settled or parked DEAL shows the Sales wording so "Close Lost" never reads as
"Cancelled" one screen over, while a live deal keeps its sourcing status. The status dropdown is now
"All sourcing statuses" — it narrows WITHIN a tab; the tab is the scope, and it is visible.

**22 Sep 2026 — Employees: synced HR fields, a sort control, richer Project History**
(server half + migration 0105 in B-V2 `CLAUDE.md`): `Employees.tsx` list gains a sort `<select>`
(Newest joiner first — the server default, sent as `undefined` so the default lives in ONE place —
Recently updated · Name A–Z). ⚠️ It uses `!w-44`: the `!` is load-bearing because `inputCls` ends in
`w-full` and a plain `w-44` appended after it never wins. The **Project History** tab was a project
name and two dates; it now shows Project + customer, the Opportunity (linked to `opportunities/:id`),
**Position held** (the designation captured AT assignment, not the employee's current one), Headcount
the deal was sourcing for, billing Rate + unit, and an "Ongoing" badge when `end_date` is null. All of
it is server-derived in three batched queries — do not add a per-row fetch here. A local `money()`
helper formats rupees; this file has no `inr` import and `hubMoney` lives in `Customers.tsx`.

**22 Sep 2026 — AI interview: the premature close, session recording, mandatory camera**
(server half + the full root-cause write-up in B-V2 `CLAUDE.md`): `index.html` `app.js?v=29`.
⚠️ **`interview_security.js` was terminating interviews the SERVER would have allowed.**
`TERMINATE_AT` was 3 while the server terminates past `MAX_WARNINGS` (the 4th strike), so the
candidate got "Warning 2 of 3" and then a red "Interview Ended" — no third warning ever existed. With
the 15 Sep strike widening (`window_blur` · `visibility_hidden` · `fullscreen_exit` all strikes) three
ordinary focus events ended an interview a minute in. Now `MAX_WARNINGS + 1`, and it is only the
OFFLINE fallback: `reportViolation` already honours the server's `auto_terminated`, which is the
authority. `showWarning` renders a real third ("Final warning — 3 of 3").
⚠️ **`candidate.js:1353`'s premature-completion retry was dead code** — `idx < total` can never be
true because the server's completed payload sets `index === total`. It now branches on
`completion_reason === "questions_exhausted"` and retries ONCE (`_premCompletionRetried` latch —
without it a pool that genuinely cannot grow would loop). A time/question-limit completion still
submits at once.
⚠️ **`core.js::handleJson` throws on any `{"error"}` body even at HTTP 200**, which is how a
recoverable server message ("No active session", "Interview already completed", the device-binding
403) becomes a dead `Error: …` screen. Known and unchanged here — the server-side statuses are the
fix; do not add a retry that swallows a real 403.
**New `js/session_recorder.js`** — `startSessionRecording(existingStream?)` /
`stopSessionRecording({finalize})` / `isSessionRecording()`. Opens its OWN low-resolution stream
(320x240 @ 6 fps, VP8 52 kbps + mono Opus 12 kbps ≈ 22 MB for 45 min; settings come from
`GET /interview/recording-config` so they tune without a build), emits a chunk every 15 s via
`MediaRecorder`'s `timeslice` and POSTs each one. ⚠️ **Uploads are serialised through one promise
chain that never rejects** — a lost slice is a gap, but rejecting would skip every later chunk. Every
failure inside is swallowed and logged: recording is evidence, the interview is the product.
⚠️ **`stopSessionRecording()` is called from inside `candidate.js::submitInterview`, NOT from the
`window.submitInterview` wrapper in `app.js`** — timer expiry, premature completion and proctor
termination all call the module function directly and skip that wrapper (§10 fix #3), and those are
exactly the interviews whose recording matters. Started at STEP-8 in `app.js` beside
`setRecordingBadge(true)`, fire-and-forget.
`face_detection.js` evidence snapshots: **320px/q0.6 → 240px/q0.5** (~10 KB, a third of the storage)
— the image answers "how many people are in frame", not "what do they look like", and the session
recording is the higher-fidelity record now.
⚠️ **`device_test.js`: the camera is now MANDATORY** — one switch, `CAMERA_REQUIRED = true`.
`WEBCAM_PASS_STATES` is `{"ok"}`, `_markWebcamSkipped` → `_markWebcamUnavailable` (blocking error +
retry instead of a silent pass), the "Skip — no camera" button is hidden from JS (not removed from
`index.html`, so the markup stays valid if the switch is turned off) and `_skipWebcam` refuses with a
reason. Mic script, chime, network check and the `_verifiedMicStream` handoff are untouched.
**`pages/IntegrityLogs.tsx`**: new `RecordingPanel` above the Timeline plus a "recording" chip on the
list row (`has_recording` comes off the schedule row — the list must never touch object storage).
⚠️ **Two fetch paths on purpose**: an S3 `url` is PRESIGNED and must go straight into `<video src>`
(adding our bearer breaks the signature), while the local driver's `/interview/media/…` sits behind
dashboard auth that `<video>` cannot send, so it is fetched to a blob first — `recording.backend`
decides. `available: false` always renders the REASON rather than an empty player.

**23 Sep 2026 — black Candidate Feed once recording started (`app.js?v=30`):** reported from an ASUS
Vivobook — the feed went black the moment the REC badge lit. Cause: `startSessionRecording()` opened the webcam a
SECOND time (320x240 @ 6 fps) while the feed held it at 1280x720; many Windows camera drivers reconfigure the device
for the newest caller and the first consumer freezes or goes black. ⚠️ **The recorder now CLONES the feed's tracks**
(`track.clone()` + `applyConstraints` to downscale the clone) and never calls `getUserMedia` while
`candidate.getProctorStream()` is live; it polls for that stream up to 30 s because `initProctoring` is
fire-and-forget and the feed is usually still opening. Audio is cloned from `device_test.getVerifiedMicStream()`.
Stopping a clone never touches the original. Own `getUserMedia` remains only for the no-camera case.

**23 Sep 2026 — watch an interview LIVE + camera snapshots removed (`app.js?v=32`; server half in B-V2
`CLAUDE.md`):** `pages/IntegrityLogs.tsx` `LiveRecordingPlayer` replaces the "not finalized" message while the
session runs (`recording.live` from the detail endpoint). It polls `GET /interview/recording/{token}/live?after=N`
every `chunk_seconds/2`, fetches each new `…/part/{seq}` through `authFetch` and appends it to a MediaSource
buffer (`video/webm; codecs="vp8,opus"`) — the first slice carries the WebM header, so sequential append is the
stream and the reviewer runs ~one slice (15 s) behind. ⚠️ Parts come through the APP, never presigned: a
cross-origin `fetch()` from S3 would need bucket CORS. Fallback when MSE is missing or rejects a slice: rebuild
ONE Blob from every slice so far and restore the playhead on `loadedmetadata` (never yank the reviewer to the
live edge on a refresh — only on first load). "Jump to live" appears when > 20 s behind. When the manifest says
the session ended (`session_status` not live, or `finalized`), the player waits 3 s for the server to join the
parts and calls `onEnded` → `RowDetail` re-fetches and the ordinary `RecordingPanel` takes over. Row chip
"Watch live" = `recording_status === "recording"` AND a live `session_status` (`LIVE_SESSION_STATUSES`, a mirror
of the server set); the list auto-refreshes every 30 s ONLY while some session is live. Removed: the evidence
lightbox + `EvidenceImage`, `has_evidence` / `evidence_url`, `face_detection.captureEvidence` and the `evidence`
FormData field in `interview_security.reportViolation` — the recording shows what the camera saw at the event's
timestamp.

**23 Sep 2026 — 60-second clock on the warm-up question (`app.js?v=31`):** new `js/warmup_timer.js`
(`startWarmupCountdown(sec, onExpire)` / `stopWarmupCountdown()`), a `#candidateWarmupTimer` badge inserted after the
warm-up note ("Time for this question: 0:58", red under 10 s). The limit is the SERVER's `warmup_time_limit_sec` on the
warm-up payload (`state.warmupTimeLimitSec`, set in `interview_engine.applyRuntimePayload`) — never a client constant.
⚠️ The clock starts in `rec.onstart` (mic open), NOT at question render, so TTS time is never charged to the candidate.
At zero `submitCandidateAnswer(true, …, {trigger: "warmup_time_limit"})` — a SKIP on purpose: `_finalizeSkipTranscriptCapture`
flushes whatever was said and the server converts a skip-with-speech into the stored answer, so the introduction is kept
whenever one was given. Stopped in `_transitionToNextQuestion`, on every press (`_pressInFlight` entry) and in
`submitInterview`. Scored questions are untouched.

**23 Sep 2026 — AI verdict inline on the profile's Interviews tab (server half in B-V2 `CLAUDE.md`):**
`crm/components/AiInterviewOverview.tsx` — score ring (`ScoreIndicator` lg), verdict (`effective_result` wins over the
AI's `result`; HR-decision / Not attempted / Terminated chips), recommendation · fitment, answered/skipped/asked, four
dimension tiles, summary, Strengths / Areas to probe, per-skill bars. Fetches `…/ai-interviews/{id}/summary` on mount,
renders the reason on failure. Mounted inside the AI card of `Profiles.tsx`'s Interviews tab (the AI Interview tab is
unchanged). ⚠️ The "Full report" link only works for roles holding `iv:candidates` (TA/HR/RMG/Admin) — `App.isViewAllowed`
bounces everyone else to the landing page with no message — so the card shows it only to those roles
(`REPORT_PAGE_ROLES`, mirror of `lib/rbac.ts`) and a muted "ask RMG or TA" to the rest.

**23 Sep 2026 — Access Control ▸ Roles + Reset Password (server half in B-V2 `CLAUDE.md`):** `UsersAdmin.tsx`
hub gains a third tab, **Roles** → `crm/pages/RolesAdmin.tsx` (`RolesPanel`): one table of built-in + custom roles from
`GET /api/roles`, `RoleEditorModal` (name · description · active · `TabPermissionMatrix`; Create disabled until ≥1 tab
is granted), `RoleMembersModal` (members with Remove + **Reset password**, an add-a-user search over
`fetchAllMaster("/api/users")`), delete via `ConfirmModal` (409 copy when members remain). `crm/components/
TabPermissionMatrix.tsx` is the extracted View/Edit/Create picker (`TAB_MODULES`/`MODULE_ORDER` moved here;
`AccessTemplates.tsx` still carries its own copy with field overrides — merge when that page is next touched).
`crm/components/ResetPasswordModal.tsx`: Generate (temporary password shown ONCE with Copy) or Set; mounted on role
members and on every Users row (disabled for `me.id`). `RoleChips` renders `custom_roles` as green chips. ⚠️ Nothing in
`lib/rbac.ts` knows about custom roles on purpose — a GM has `roles: ["GM"]`, which passes `hasCrmAccess` (any role),
and every tab/page decision goes through `me.access.visible_tabs` exactly like a templated user.
**Later the same day:** the Users-tab **Access** column is one `<select>` with `<optgroup>`s "Custom roles" /
"Access templates" (`role:ID` / `template:ID` → `POST /api/users/{id}/access-source`), and the **Edit Roles** dialog
now lists custom roles too — `RoleSelector` gained `customRoles / selectedCustom / onCustomChange` (a green "Custom
roles" group after the built-in ones; inactive roles only when already held), and `EditRolesModal` fetches
`/api/roles` once, maps the row's `custom_roles` NAMES to ids, and posts `{roles, custom_roles}` in ONE save.
⚠️ `custom_roles` is sent only when that fetch succeeded — a failed fetch must not strip roles the user already
holds. Create User / Invite still use built-in roles only (`RoleCheckboxes` passes nothing custom).

**23 Sep 2026 — Proforma → Tax invoice flow (server half in B-V2 `CLAUDE.md`):** `crm/components/invoice/
ProformaActions.tsx` holds the whole lifecycle UI — `InvoiceFormatPicker` (the three optional columns, used by BOTH
the GM's raise dialog and Finance's editor and the customer form), `ProformaBanner`, `ConvertProformaModal`
(number prefilled from `/api/invoices/next-number`, date), `ReturnProformaModal` (reason ≥10), `ProformaEditModal`
(direct `PUT` — a Proforma is not issued, so no change request), `PROFORMA_COLOR` (#c2410c, same hex as the
server). `InvoiceTable.tsx` was rewritten around ONE column spec (`serviceColumns`, mirroring B-V2
`tax_invoice.service_columns`): `billing.invoice_format` drops `sac` / `leave` / `per_day`, `desc` absorbs the width.
`InvoiceHeader` prints PROFORMA INVOICE in orange (`styles.headingProforma`); downloads are `ProformaInvoice_…`.
`Finance.tsx`: invoices list gains a **Proforma** tab (`kind=Proforma`; the payment tabs send `kind=Tax`),
`ProformaKindBadge` in both invoice lists, and the detail page shows the banner + Finance's three actions
(Generate original invoice · Return to GM · Correct) while hiding payments / TDS / change requests for a Proforma.
`Timesheets.tsx`: approver gates are `useHasRole("GM")` (Sales, who fills the sheet, gets "Open" never "Review");
the raise dialog's first card is the **invoice format** (pre-filled from `po-options.invoice_format`; the invoice
number field is gone — the server assigns `PI-…` and Finance types the tax number at conversion), it posts
`{po_id, invoice_format, …overrides}` and reads "Reissue Proforma" when `returned_proforma` is set; the row /
detail buttons say Raise Proforma… and a RETURNED Proforma no longer counts as "has invoice" (`InvoiceRef.kind` +
`returned_at`). `TimesheetApprovals.test.tsx` re-pinned (GM approves; HR / Sales / RMG only Open; the POST carries
`invoice_format`, and an unticked column stays off). **Import / Upload**: the timesheet import modal accepts any
allowed file; a non-`.xlsx` shows a month picker and is ATTACHED (`bulk-import?year=&month=`) rather than parsed.
`CustomerFormModal`: "Invoice format (columns printed)" section under the bank picker.

**23 Sep 2026 — Hiring control tower on the Dashboard (server half in B-V2 `CLAUDE.md`):**
`crm/pages/dashboard/HiringControlTower.tsx` renders `GET /api/dashboard/hiring?month=&period=` — the Sales → TA
page the business ran by hand: an 8-tile KPI strip (pipeline positions · opportunities · onboardings · positions
closed with the customer-closed count BESIDE it, never added · active · workable · active customers · days left),
two **pace gauges** (`PaceGauge`, pure SVG half-dial: needle = current pace/week, the tick on the arc = required
pace, sweep coloured by the server's `state`), the positions-vs-onboardings trend (recharts `ComposedChart`, zoom-
aware: 12 months / 8 quarters / 5 FYs), a step-bar funnel (`Funnel`), the active-customers donut + list
(`CustomerDonut`, concentration chip ≥ 50 %) and `StageDelays` (amber/red rails). `PeriodSwitcher` + `DateStepper`
are the Revenue page's controls, default zoom **quarter** (targets are quarterly); `TargetsModal` writes ONE
`PUT /api/dashboard/hiring/targets` (values set, blanks go in `clear`) and is shown to `useHasRole("Sales_Head")`
(Sales Head / Admin / CEO). Mounted in `CrmDashboard.tsx` right after `StartHereCard`, gated by
`useShowsHiringTower()` — every login except a PURE HR / Finance one, so custom roles (GM, Sales Manager) see it
exactly like a templated user; the server gate is the mandatory `dashboard` tab. Reuses `useDeskData` from
`DeskWidgets.tsx`. ⚠️ Controls use the local `CONTROL` class, not `inputCls` (which ends in `w-full`). Every tile is a
`CrmLink` to the list that produced it. Verified: `tsc --noEmit` green, eslint clean, `vite build` green, rendered
in light + dark with mock data (no console errors).

**24 Sep 2026 — Revenue page in the control-tower style + shared atoms (F-V2 only, payload unchanged):**
`crm/components/controlTower.tsx` is the ONE home for the visual vocabulary both towers share — `PERIODS` /
`periodMeta` / `thisMonthKey` / `shiftMonthKey`, `PeriodSwitcher`, `DateStepper`, `Panel` (header strip + `action`
slot), `Tile` (gradient accent bar; a `CrmLink` when `to` is given, a plain card otherwise — a derived figure such as a
margin % has no list to open), `MiniStat`, `ArcGauge` (pure-SVG half dial: sweep = `value`/`max`, `marker` tick,
optional `needle`, `format` for the big figure), `StepBars`, `StateTone` + `STATE_TEXT` / `STATE_CHIP`, `CONTROL` /
`ICON_BTN`, `tooltipStyle`. `HiringControlTower.tsx` now imports all of them (`PaceGauge` is a thin `ArcGauge`
wrapper, `Funnel` renders through `StepBars`); it re-exports `PeriodKind` so nothing else moved. `RevenueReport.tsx`
v4: an **8-tile KPI strip** (billed · collected · outstanding · overdue · gross margin · target attainment · DSO ·
deployed heads — the last four are new tiles over figures the payload already carried), **three dials** replacing the
two Target panels — `PeriodTargetCard` (sweep billed, tick target, run-rate + gap as `MiniStat`s), `FyTargetCard`
(sweep billed-to-date, tick FY target, state follows the PROJECTION), `CollectionsCard` (sweep DSO days, tick at
`DSO_BAD_DAYS`=60, ok ≤ `DSO_WARN_DAYS`=45) — a customer-share `CustomerDonut` (top `DONUT_SLICES`=6 + Others) beside
the customer table, `StepBars` for ageing buckets / forecast months / the three billing dimensions (`DimBars`),
`Warn` for in-panel caveats, and state chips in every panel header (`STATE_CHIP`). Every section, filter, deep link,
the Targets modal and the Excel pack are unchanged. ⚠️ The three dial cards stack their gauge ABOVE the stat grid on
purpose: side-by-side, three cards at laptop width left ~230 px for two `MiniStat` columns and `₹8,00,000` clipped.
⚠️ The cash-flow table sits inside a two-column grid, so it uses a bordered `overflow-x-auto` box, NOT
`tableWrapMid` — the `-mx-5` bleed would push it under the inflows column. `Attainment` bars now use `bg-surface-1`
as the track because they render on a `MiniStat` (`bg-surface-2`). Verified: `tsc --noEmit` green, eslint clean on
the three files, `vite build` green, both pages rendered light + dark with mock data (no console errors).

**25 Sep 2026 — billing unit has no default and can be corrected (server half in B-V2 `CLAUDE.md`):** an hourly
₹1,414.77 saved with the untouched "Monthly" default billed a 168-hour month as ₹1,414.77. `crm/lib/billingUnits.ts`
(`BILLING_UNITS`, `BILLING_UNIT_REQUIRED`, `unitWord`) replaces the three copied unit lists; Map Employee
(`ProjectEmployees.tsx`), the New Project wizard's Map Employees step (`EditProjectWizard.tsx`) and Assign Employee
(`Projects.tsx`) now start EMPTY and require "Rate is priced per". Correcting a saved unit: PE detail ▸ Commercial
Details ▸ Edit rates has a "Rates are priced per" select (PUTs `/api/projects/employees/{pe}/billing-unit` before the
rate rows), and the Raise Proforma dialog's Edit/Add Rate form has "Priced per". `Timesheets.tsx` `RateUnitWarning`
renders the server's `line.rate_unit_warning` (with a link to the PE page) in the breakdown modal, under the Invoice
Details table and in the Raise Proforma rate panel; the breakdown no longer says "from project rate" (it is the
employee's Commercial Details) and the table's rate column is titled by unit ("Rate Per Month" etc.), not "Per Hour / Day".
Also fixed in passing: `deriveRateSchedule` / `RateHistory` built dates with `toISOString()` (UTC), so in IST every
derived rate expiry showed ONE DAY EARLY and 3 `ProjectEmployees.test.tsx` cases failed on an IST box; both now use
`lib/calendarDates.toDateKey` (local). Tests green under `TZ=Asia/Kolkata` and `TZ=UTC`.
**Same day — Import timesheet reads PDFs:** the import modal (`Timesheets.tsx`) treats `.xlsx` AND `.pdf` as
readable ("Upload & import"); a PDF still shows the month picker — it completes bare day numbers and is the fallback
month when nothing can be read (a scan is then attached, server half in B-V2 `CLAUDE.md`). The month default now uses
`toDateKey` (local), not `toISOString()`.
**Later — "Fill from file (Excel / PDF)" on the timesheet page:** beside "Fix week-offs / holidays" on an editable
sheet (`TimesheetDetailPage`), a hidden `accept=".xlsx,.pdf"` input posts to the SAME `bulk-import` endpoint with this
sheet's `project_id / employee_id / year / month`, confirms first when the grid has unsaved edits, toasts the server's
summary plus the first failed rows, and reloads the sheet. Server side unchanged (B-V2 `services/timesheet_import.py`).
**Later — holiday hours:** the timesheet grid's Hours input is now editable on Holiday rows too (`hoursEditable`
includes `isCalendarHoliday` / `day_type === "Holiday"`), and the soft hour-cap applies to every day type. The row stays
a Holiday; `computeBillables` already mirrors the server (billed with Comp Off Billable, else comp-off credit).

**25 Sep 2026 — Screening Desk + internal fast-track + ATS column (server half + migration 0111 in B-V2 `CLAUDE.md`):**
new route `screening-desk` → `crm/pages/ScreeningDesk.tsx`, sidebar entry "Screening Desk" whose visibility is
`canApprove(me, "profile.rmg_screening")` in `CrmApp` (NOT the nav role list — a GM custom role has no built-in role);
the page itself refuses without the approval. Header card (Pending / Shortlisted / Rejected / All pill tabs with server
counts, search debounced 350 ms, customer → opportunity (scoped; a foreign opportunity is dropped), TA, ATS band,
internal/external, applied window, sort), then a two-column body: positions (`PositionGroup`, collapsible, pending chip,
link to `requirements/:id?tab=resumes`) with compact rows (`QueueRow`: internal chip, exp — amber when outside the
band — notice, CTC in lakhs, TA · waiting, ATS ring), and a sticky `DetailPane` (facts grid, Shortlist / Reject via the
existing `rmg-screening` endpoint in `DecisionModal`, fast-track, ATS panel with matched / missing skills + AI summary,
inline `FilePreviewPane` resume). ⚠️ **Auto-ATS:** rows without a score and with a CV are posted to
`/api/screening-desk/score` in `max_score_batch` chunks, ONCE per page load (`attempted` ref) — a failure shows the
server's reason, never a retry loop; scores are patched into the rows in place so the list does not jump. After a
decision the next row is selected and the list reloads. ↑/↓ move through the queue (ignored while typing or a dialog
is open). Controls use `CONTROL` (`inputCls` ends in `w-full`). **`crm/components/FastTrackToSales.tsx`**:
`InternalEmployee`, `InternalChip`, `FastTrackButton` (reason ≥ 10, disabled with the server's `fast_track_block` as
the tooltip) and `FastTrackBanner`, mounted on the profile page under the screening banners; gate
`useCanApprove("profile.fast_track_internal")` (added to `ApprovalAction`). **Candidate Profiles:** new sortable
`ats_score` column (ScoreIndicator sm, "Not scored" for Pending_Scan) in the default layout, header min/max filter
(`ats_min`/`ats_max`, sent by the list and the export). Users with a saved layout get it too — the server "announces"
it. Verified: `tsc --noEmit` green, eslint clean on the new files, `vite build` green, desk rendered light + dark with
mock data (no console errors).

**25 Sep 2026 — ONE candidate status on every screen (server half in B-V2 `CLAUDE.md`):**
`crm/components/CandidateStatusBadge.tsx` — `CandidateStatusBadge({status, stage, withdrawnFrom})` renders the SERVER's
`candidate_status` / `profile_status` (label · tone · hint; `CANDIDATE_STATUS_TONE` is the only place a candidate status
picks colour) and falls back to `StatusBadge(stage)` for an older payload; `useCandidateStatusCatalogue()` fetches
`/api/candidate-profiles/status-options` once per page load (shared promise, retried after a failure) and
`candidateStatusOptions(catalogue, bucket)` gives grouped options for the In pipeline / Closed views. Mounted in the
Candidate Profiles list (Status column + card grid), profile header, Opportunity ▸ Applicants, Requirement ▸ Applicants +
Applied Candidates (replaces the hand-built "L2 Scheduled / L2: Hire" pills), Screening Desk, candidate page, Reports ▸
Candidate Profiles. Candidate Profiles: the toolbar + header Status filter send **`status_key`** (list AND export); the URL
param moved to **`f_state`** so an old `f_status=<stage>` bookmark is ignored, not a 400; the **Stage column is gone**;
`ProfilesListPage` no longer takes a `statuses` prop and the dead `DEFAULT_PROFILE_COLUMNS` / `ACTIVE_STATUSES` copies in
`Profiles.tsx` were removed. `MultiSelectFilter` options take an optional `group` (heading rendered when it changes; wider
panel). `crm/lib/candidateStageBuckets.ts` is the ONE stage-chip set (Opportunity Applicants + Applied Candidates — they
were two diverging copies): All · Sourcing · Internal Rounds (L1 / L2) · With Sales · Submitted to Customer · Customer
Interviews · Candidate Selected · HR & Onboarding. `ui.tsx` stage labels: Shortlisted "Candidate Selected", HR_Screening
"HR Discussion", HR_Interviewing "HR Round", Preboarding "Pre-Onboarding" (the ATS "Shortlisted" badge passes its own
"ATS Shortlisted" label). Requirement page: **"RMG Approve" / "RMG Reject"** (were Engineering …), stepper "RMG Review",
"RMG Review Queue", dashboard "Pending RMG Reviews". Tests: `CandidateStatusBadge.test.tsx` (5); `tsc` green, `vite build`
green.

**26 Sep 2026 — the application is "Karnex Orbit" (`lib/brand.test.ts`, 3; server half in B-V2 `CLAUDE.md`):**
`src/lib/brand.ts` — `APP_NAME` · `APP_NAME_UPPER` — is the ONE product name the dashboard prints (no tagline: the user
asked for the bare name everywhere, so the "Staffing CRM + AI Hiring" line was removed the same day): the tab `<title>`
(`admin-dashboard/index.html`), `KarnexBranding` (logo alt + the "KARNEX ORBIT" line), the CRM header + mobile drawer + spinner + error box in `CrmApp.tsx`, the Ask AI intro
and the support bot's tagline (`BOT_NAME` stays "Karnex Support Agent" — it names the assistant, not the app). The
candidate runtime has no build step, so `frontend/index.html` (tab title, login "Karnex Orbit" sub-brand, landing hero
"Karnex Orbit" alone, the invite-welcome tag, the device-check tag, the interview sidebar brand
block), `thank-you.html`, `interview-terminated.html` and `js/results.js` (Q&A export titles) carry the literal text;
`app.js?v=34`. ⚠️ The logo SVGs still read "KARNEX" (the company) — the product name is text beside them; swap the
files when a Karnex Orbit mark exists. `brand.test.ts` reads every `src/**` source + the four runtime pages through
`import.meta.glob(…, { query: "?raw" })` (no Node typings in tsconfig) and fails on any old product name in visible
text. Verified: `tsc --noEmit` green, `vite build` green.

**26 Sep 2026 — Screening Desk: choose the interview route after a shortlist (server half in B-V2 `CLAUDE.md`):**
`crm/components/InterviewRouteChoice.tsx` is the ONE component for "AI L1 or manual L1?": `InterviewRouteChoice`
renders two buttons — **Schedule AI L1** → the existing `ScheduleAiInterviewModal`, **Go manual — skip AI L1** → the new
shared `GoManualModal` (the note dialog + `POST …/skip-ai-l1 {request_manual_l1: true}`) — and renders NOTHING unless the
server's `interview_route.open` says the choice is still RMG's. ⚠️ `GoManualModal` now backs the profile page's
`SkipAiL1Banner` (`Profiles.tsx`) and the Applied Candidates "Go manual" button (`Requirements.tsx`) as well — three
copies of the same dialog became one; change the wording there only. `ScreeningDesk.tsx`: `DeskRow.interview_route`;
`DetailPane` shows an "Interview route" fact (Not chosen · AI L1 scheduled / — result · Manual L1 requested / scheduled /
— result) and the route card when open. ⚠️ **A Shortlist no longer jumps to the next row**: the row would leave the
Pending tab before the question was asked, so `DetailPane` keeps `shortlistedMsg` and shows the route card (with a
"Decide the route later" escape) until a route is taken; only then does `onDecided` → `afterDecision` reload and
advance. Rejections still advance at once. The desk's Shortlisted tab shows the same card for rows whose route is still
open. `DecisionModal` shortlist copy now says the route is chosen next. Also removed 13 dead imports + `numOrNull` from
`Profiles.tsx`. Verified: `tsc --noEmit` green, eslint no new warnings, `vite build` green.

**26 Sep 2026 — Opportunities workspace follows the GRANTS for a custom role (GM) (`OpportunitiesWorkspace.test.tsx`
now 12; server half in B-V2 `CLAUDE.md`):** reported — the GM's Opportunities tab read "You do not have access to
Opportunities." Every gate in `OpportunitiesWorkspace.tsx` was a built-in role list (`PIPELINE_TAB_ROLES` …), and a GM has
`roles: ["GM"]`, so all three said no. Now `canPipeline = useCanAct("opportunities","view", useHasRole(…PIPELINE_TAB_ROLES))`,
`canRequirements = useCanAct("requirements","view", …)`, `canApplicants = useCanAct("profiles","view", …)` — for a
templated / custom-role user the tab grants decide (the same rule as the sidebar and the server gate); an untemplated
Sales / RMG / TA behaves exactly as before. New `useIsTemplated()` in `useAccess.ts`. ⚠️ The **Requirements** tab
BUTTON (removed 14 Aug 2026 for the role-based strip) comes back ONLY for a grant-driven user who holds both Pipeline
and Requirements — they have no role fall-through to the full-page list, so without it the sourcing list would be
unreachable; Sales / Admin still never see it (pinned). `RequirementsListPage` gives a GM the TA stage strip
(`TA_STAGE_TABS` — no built-in role means no Sales / RMG tabs) and the server now returns every requirement to a
grant-admitted user. `visibleOpportunitySubTabs(roles)` stays the pure ROLE helper. Verified: `tsc --noEmit` green,
eslint clean, vitest 12/12, `vite build` green.

**28 Sep 2026 — search listing: favicon, site name, sitemap (static files; one line in B-V2 `main.py`):** Google still
showed "KARNEX AI HR", a blank globe icon and "karnexgroup.com" as the site name. The `<title>` was already Karnex
Orbit (26 Sep); what was missing: **icons** — `frontend/favicon.ico` (16/32/48, at the root because Google and old
browsers ask for it there), `favicon.svg`, `assets/brand/{favicon-48x48,favicon-96x96,apple-touch-icon,icon-192,
icon-512}.png`, all built by `scripts/make_brand_icons.py` from the master logo `assets/brand/karnex-orbit-logo.png` (the
Karnex Orbit "K + orbit" mark, transparent PNG — replaced the interim "K" monogram the same day): tab favicons are
the logo cropped tight on transparency, home-screen icons (apple-touch / 192 / 512) put it on a navy `#0b1026` rounded
tile because iOS/Android fill transparency; to change the logo, overwrite the master PNG and re-run the script, then
bump the `?v=N` on the icon links (four HTML heads + `site.webmanifest`) — browsers cache favicons for weeks; **`site.webmanifest`** (B-V2 `main.py` registers
`application/manifest+json` for `.webmanifest`); **`robots.txt`** (only `/` is public — `/admin`, the API prefixes,
`/apply`, `/book`, `?invite=` links and the two end-of-interview pages are disallowed) + **`sitemap.xml`** (the home
page only; add a `<url>` when a public page ships). `index.html` head gains description, canonical, icons, manifest,
theme-color, Open Graph and a JSON-LD `WebSite` (`name` "Karnex Orbit" — this is what Google prints as the SITE NAME)
+ `Organization` block; `thank-you.html`, `interview-terminated.html` and `admin-dashboard/index.html` get the icons and
`noindex, nofollow`. Icon links are ROOT-absolute on purpose: both hosts serve `frontend/` at `/` (Vercel
`outputDirectory`, backend StaticFiles mount). The domain `https://karnexgroup.com/` is written into the sitemap,
robots, canonical, OG and JSON-LD — change all five if it moves. Verified: every file served 200 with the right
content type through a StaticFiles mount, JSON-LD / manifest / sitemap parse, `vite build` green.

**28 Sep 2026 — AI Logs ▸ Interview Costs (Admin/CEO; `pages/InterviewCosts.test.tsx` 2; server half in B-V2
`CLAUDE.md`):** `pages/InterviewCosts.tsx` (`InterviewCostsTab`) renders ONE call, `GET /api/ai-costs/interviews`
(`api/aiCosts.ts` — `getInterviewCosts`, `downloadInterviewCostsCsv` via `authFetch` blob): header card with date
presets (Today · 7 days · 30 days · This month · This quarter · This FY · Last 12 months · Last 3 years — each picks a
sensible zoom), custom From/To, a Daily · Weekly · Monthly · Quarterly · Yearly (FY) zoom strip, debounced search,
customer / TA / template / status filters and Export CSV; an 8-tile KPI strip (interview spend ₹ + $ · avg per
interview · interviews · avg duration · AI calls · tokens + audio minutes · **Other AI spend** (ATS, parsing, Ask AI —
shown beside, never inside) · Total AI spend @ the printed ₹/$ rate); a recharts `ComposedChart` trend (stacked chat /
TTS / STT bars in USD + an interviews line); three breakdown panels (`StepBars` by kind with the "not an interview"
list, by customer, by template + TA); and the paged, sortable interview table (candidate → profile AI tab deep link ·
customer / opportunity · template / TA · when + scheduled · status chip · duration + questions · calls + failures ·
tokens · audio · chat/TTS/STT split · cost ₹ + $). Reuses the control-tower atoms (`Tile`, `Panel`, `StepBars`,
`CONTROL`, `ICON_BTN`, `tooltipStyle`) from `crm/components/controlTower.tsx` — a platform page importing CRM atoms is
fine, only `Tile`'s `to` needs the CRM router and it is not used here. `PromptLogsPage` takes `roles` from `App.tsx`
and offers the tab only to `isSuperAdmin(roles)`; the server gate (`role_required()`) is the boundary. Candidate
runtime: `speech_transcribe.transcribeAudioBlob(blob, name, { durationMs })` sends `duration_ms` — `candidate.js`
stamps `_recordingStartedAt` in `rec.onstart`, `interview_whisper_segments.js` derives it from the sample count — so
transcription is costed per real minute; `index.html` `app.js?v=35`. Test note: recharts' `ResponsiveContainer` needs a
`ResizeObserver` stub under jsdom. Verified: `tsc --noEmit` green, eslint no new warnings, vitest 2/2, `vite build` green.

**28 Sep 2026 (later) — the nav tab is "AI Costs"; Logs / Analytics removed (server half in B-V2 `CLAUDE.md`):**
`pages/PromptLogs.tsx` and `api/promptLogs.ts` are DELETED (their `/api/prompt-logs/*` API is gone too), and the two
`prompt-logs` cache regexes left `api/client.ts`. `pages/InterviewCosts.tsx` now exports **`AiCostsPage({roles})`** —
the platform view (heading "AI Costs", `isSuperAdmin` gate rendering `ErrorBox` for anyone else; the server's
`role_required()` is the boundary) wrapping the unchanged `InterviewCostsTab`. ⚠️ The View key stays **`promptLogs`**
(`App.tsx` `NAV_ITEMS`, `lib/rbac.ts` `INTERVIEW_VIEW_ROLES` / `MANAGEABLE_TABS` `iv:promptLogs`) so saved tab grants
and `?view=promptLogs` bookmarks keep resolving — only the LABEL changed to "AI Costs". Footnote now states the three
pricing bases (reported tokens · measured TTS length · reported audio tokens). Settings ▸ Operations gains the
"AI call log retention" switch (`scheduler.prompt_log_retention`). `InterviewCosts.test.tsx` re-pinned (renders the
report; RMG sees the refusal, CEO the page).

**28 Sep 2026 — CEO dashboard tabs + coloured speedometers + "Start here" redesign (`CeoDashboard.test.tsx` 3;
server half in B-V2 `CLAUDE.md`):** `crm/pages/dashboard/CeoDashboard.tsx` — a header card (title · FY label ·
`PeriodSwitcher` defaulting to **Financial year** · `DateStepper` (month = anchor) · refresh) with a four-button tab
strip (Finance · Customer · Sales · People, gradient icon tiles, `role="tab"`), ONE fetch per tab
(`/api/dashboard/ceo?tab=&month=&period=` via `useDeskData`), the chosen tab remembered in
`localStorage["crm.ceo.tab"]`. Per tab: an 8-tile KPI strip (`Tile`, each a `CrmLink` where a list exists), three
dials, charts, one table. **Finance**: FY-target / collection-rate / gross-margin speedometers (at the FY zoom the
target is `targets.fy_target`, else `month_target` — the report's naming), "How the year unfolded" (billed bars ·
collected · people-cost lines, month by month), customer donut, cash-flow next 3 months, ageing `StepBars`, billing by
type, the report's alerts as chips. **Customer**: donut + "billing vs previous" horizontal bars + the drill-down
table (customer row → `ProjectRows` → `EmployeeRows`, `Set<string>` of open keys, Expand all / Collapse, search;
`KindChip` Internal / External / Unknown with the server's reason as the tooltip). **Sales**: the hiring tower's
`PaceCard` ×2 (now EXPORTED from `HiringControlTower.tsx`, with `Funnel`, `StageDelays`, `TrendChart`,
`CustomerDonut`, `PaceGauge`, types `Pace` / `CustomerRow`), an internal-share dial, onboardings stacked by month, the
positions table (fill bar, open, internal / external counts, joined candidates as coloured chips linking to the
profile, age in red past 30 days, Live / All scope), stage delays, by Sales owner. **People**: utilisation and
attrition (`invert`) dials, deployed-vs-bench donut, headcount-by-month (`stackOffset="sign"`, exits negative), the
90-day roll-off list, bench / on-notice / joined / left lists. ⚠️ `period.comparison_label` already reads "vs last FY" —
never prefix it with "vs" again. **`controlTower.tsx`** gains **`Speedometer`** (the CEO asked for colourful pace
dials): 36 arc bands coloured red → amber → green (`gradientAt` over the semantic hex stops, `invert` for a
number that should be LOW), bands past the value dimmed, tick ring, drop-shadowed needle with hub, a `marker` flag with
`markerLabel`, `state` colouring the big figure; `HiringControlTower.PaceGauge` uses it too. Also moved there, one copy
for every tower: `inr`, `inrCompact` (now with the ₹ sign), `pct`, `num`, `Delta` (`invert` prop) — `RevenueReport.tsx`
and the hiring tower import them (their local copies are gone). **`CrmDashboard.tsx`**: Admin / CEO get
`<CeoDashboard />` where the hiring tower was (the Sales tab IS the tower; everyone else keeps the tower); the greeting
is "Good Morning / Afternoon / Evening" (capitalised) and the role chip prefers **CEO** over Admin; **`StartHereCard`**
(now exported) is a journey — a gradient sparkle header, the Ctrl+K / Ctrl+/ hint as kbd chips, an × to dismiss, and
the role's steps as numbered icon cards joined by arrows (`STEP_ICON` by destination, CTC Slab keyed by label;
`STEP_ACCENT` gradients) — same `START_HERE` data, same one-time dismiss. Verified: `tsc --noEmit` green, eslint
clean, vitest 3/3 (+ rbac 38), `vite build` green, all four tabs rendered from REAL service output (a seeded SQLite
book run through `executive_dashboard`) in headless Chromium with no console errors.

**28 Sep 2026 (later) — CEO dashboard v2: bar charts with tick filters, tiles deep-link, desk widgets gone
(`CeoDashboard.test.tsx` 3, re-pinned):** three asks. (1) **Every chart is a bar chart with filters** —
`controlTower.tsx` gains **`FilteredBars`** (`data` + `series[{key,label,color,stackId,defaultOff}]`; a checkbox chip
per series, and with `rowFilter` a checkbox list of every row with All / None; `layout="vertical"` for long names;
`stacked`; nothing computed — untick and the chart redraws with what is ticked). It replaced the composed bar+line
charts AND the donuts: Finance "How the year unfolded" (billed · collected · people cost · margin, month rows) and
"Who we bill" (customer rows); Customer — ONE "Customer billing" panel (billed · previous · collected · outstanding ·
cost · margin, customer rows) replaces the donut + the vs-previous chart; Sales — **"Onboarded — internal vs
external"** with a Monthly · Quarterly · Yearly toggle (`onboarding_trend[zoom]`, default Monthly; stacked internal /
external / unknown + a Total series off by default) and "Positions brought in by month"; People — headcount by month
(joiners · exits · headcount) and Deployed vs bench as `StepBars`. `Donut` and the recharts imports left
`CeoDashboard.tsx`. (2) **Tiles open the page that explains them, at the same period**: `revenueLink(period)` =
`reports?tab=revenue&month=<anchor>&period=<kind>` for every money tile (billed · collected · outstanding · overdue ·
margin · target · DSO, and the alert chips) — the Revenue report reads `?month=&period=` on load; PO cover → `pos`;
Deployed / Bench → `employees?deployment=deployed|bench` (`Employees.tsx` now reads `?deployment=` on mount); Onboarded →
`profiles?f_state=joined` (the derived-status KEY, lowercase). (3) **`CrmDashboard.tsx`**: Admin / CEO see the greeting,
`<CeoDashboard />` (Finance first = revenue on top) and the Start-here card — no other section; the **desk widgets
(Today strip · My work · Coming up · Quick actions · Team) were removed from EVERY role's dashboard** at the user's
request — `MyWorkPanel` deleted, `DeskWidgets.tsx` is now `useDeskData` alone (the `/api/dashboard/today|upcoming|
team|my-work` endpoints still exist for the bell links). Other roles: Start here → hiring tower → their role sections.
Verified: tsc green, eslint clean, vitest 3/3 (+ OpportunitiesWorkspace 12), `vite build` green, all four tabs
re-rendered from real service output in headless Chromium, no console errors.

**28 Sep 2026 (night) — Finance tab reading order (CEO ask):** tiles → **"How the year unfolded"** (the first chart)
→ the three dials (FY target · Collection rate · Gross margin) → the four money panels as `FilteredBars` in a 2-column
grid: **Who we bill** (customer rows; Billed + Share %), **Cash flow — next 3 months** (month rows; Expected in at our
pace · On agreed terms · People cost · Net, with the four `MiniStat`s under it), **Receivables ageing** (bucket rows;
Outstanding + Invoices), **Billing by engagement type** (type rows; Billed · Share % · Invoices). `StepBars` no longer
appear on the Finance tab. Pinned by the heading-order assertion in `CeoDashboard.test.tsx`. Server note: the FY
target's "elapsed months" now stop at TODAY's month (`revenue_report._targets`), so at the FY zoom `fy_months_remaining`
/ `fy_required_monthly` / `fy_projection` are real numbers instead of 0 / — / billed-to-date.

**28 Sep 2026 (late) — Customer · Sales · People tabs rebuilt in the Finance reading order (`CeoDashboard.test.tsx` 4;
server half in B-V2 `CLAUDE.md`):** every tab is now alerts chips → 8 tiles → **"How the year unfolded"** (the first chart)
→ three speedometers → four `FilteredBars` panels in a 2-column grid → the table / the names. "Who we bill" and "Billing by
engagement type" are column bars now (no `layout="vertical"` left on the page). **Customer**: unfolded = billed by month
STACKED by customer (`monthly_series` → one series per top customer, `stackId: "billed"`); dials Concentration (`invert`,
risk flag at 50 %) · Collection rate · Blended margin; panels Customer billing · Receivables by customer (not-yet-due /
overdue stacked) · PO runway by customer (PO balance · monthly burn · months of cover) · People by customer (deployed ·
internal · external · open positions); the drill-down table prints "N mo cover" beside the PO balance (amber under 2).
**Sales**: unfolded = positions brought in beside onboarded internal / external / unknown (stacked), with the Monthly ·
Quarterly · Yearly toggle (`onboarding_trend[zoom]`, `positions_in` now in every bucket); dials Sales pace · Fulfilment
pace · Internal share; panels Positions by customer · Where every position stands (the funnel as bars) · By Sales owner ·
Hiring-stage delays (waiting · over warn · over bad · avg days) — `Funnel` / `StageDelays` / `StepBars` are no longer
imported here. **People**: unfolded = deployed · bench (headcount · joiners · exits off by default); dials Utilisation ·
Attrition · **Bench cost** (share of people cost, `invert`); panels People cost by month (deployed vs bench stacked) ·
Deployed vs bench by designation · Tenure mix · Rolling off in the next 90 days (heads + rate at risk by month, first five
names under it); the four name lists stay. Shared on the page: `StateChip` (the header chip — ⚠️ a regex that rewrote every
`<span …STATE_CHIP…>` into `<StateChip>` also rewrote StateChip's OWN body into a self-call, an infinite render that OOM'd
vitest with "tests 0ms"; bisected by swapping the old `FinanceTab` in), `Segmented` (the one zoom / scope control),
`ZOOM_OPTIONS` / `ZOOM_ROWS`, `Alerts({alerts, to, where})` for every tab. Vitest tip: the mounted checkout crawls and
OOMs — copy `src` + `vitest.config.ts` + `tsconfig*.json` + `package.json` to `/tmp/ft`, symlink `node_modules`, run there
(~70 s a file). Verified: tsc green, eslint clean, vitest 4/4, `vite build` green, backend 1,584 pass, all four tabs
rendered from real service output in headless Chromium with no console errors.

**28 Sep 2026 (later still) — "Deployed on customer sites" (`CeoDashboard.test.tsx` 4, re-pinned; server half in B-V2
`CLAUDE.md`):** second panel on the Customer tab, right under the customer-wise unfolded chart: stacked `FilteredBars` of
heads deployed at the end of each bucket, with TWO `Segmented` controls — **By customer / By location** (`groupBy` picks
`deployed_trend[zoom][i].customers` or `.locations`; the series list comes from `deployed_series[groupBy]`) and
**Monthly / Quarterly / Yearly** (`ZOOM_OPTIONS` — the same toggle as the Sales tab). `key={zoom-groupBy}` remounts the
chart so the series ticks reset when the series set changes; a "Total deployed" series is off by default on its own
stack. Verified: tsc green, eslint clean, vitest 4/4, `vite build` green, rendered from real service output.

**28 Sep 2026 (night) — Revenue page in the Dashboard design, Targets on the Dashboard, FY picker
(`CeoDashboard.test.tsx` 4; server half in B-V2 `CLAUDE.md`):** (1) **`controlTower.tsx`** gains the FY helpers —
`FY_START_MONTH`, `fyOfMonth(key)`, `fyLabel(startYear)`, `fyAnchorMonth(startYear)` (today's month while that FY runs,
else its March) and **`FySelect`** (current FY + `FY_PICKER_YEARS`=6 back, "(current)" suffix). `DateStepper` renders it
INSTEAD of the month input at the FY zoom, so both the CEO dashboard and the Revenue page pick "FY 2025-26" by name;
‹ › still step 12 months. (2) **`crm/components/RevenueTargetsModal.tsx`** replaces the Revenue page's local
`TargetsModal`: four rungs — Monthly (the anchor month's override) · Quarterly (the anchor's FY quarter, spread by the
server) · Yearly (the anchor's FY, per-FY key; a note says when the default is in force) · Default monthly. ⚠️ Only rungs
that CHANGED are written, and the quarter goes first — a blank month field must never erase the share a quarter target
just spread onto that month. `monthLabelOf` moved here. The CEO dashboard header gains a **Targets** button (reads the
Finance tab's `targets`, else fetches `/api/reports/revenue` for the anchor) and `retry()`s after a save. (3)
**`RevenueReport.tsx`** now reads exactly like the Dashboard: alerts → 8 tiles (compact rupees) → **the trend as
`FilteredBars`** (billed · collected · invoices) → the three dials as `Speedometer`s (DSO `invert`) → a 2×2 grid of
`FilteredBars` — Revenue by customer (billed · vs previous · collected), Cash flow next 3 months (bars + the four
`MiniStat`s + the two lever chips; the month table is gone), Receivables ageing, Billing by dimension (ONE panel with an
Engagement type · Customer branch · Sales owner segmented control, `key={dim}` remounts the ticks) → Gross margin by
customer (bars) beside Forecast (bars; the month table folded into a one-line summary) → Placements → **Revenue by
project** and **Revenue by employee**, each a bar chart (`topRows`: the top `MAX_BAR_ROWS`=12 by billed, the rest as
"Others (N)") ABOVE the unchanged full table → Coming up · Efficiency · Leakage. `TrendChart`, `CustomerDonut`, `DimBars`
and the recharts / `ArcGauge` / `StepBars` imports left the file. Harness: `/tmp/fbh` now also mocks
`/api/reports/revenue` + `/placements` from the seeded book (`seed_mock.py` dumps both) and renders the Revenue page at
`?page=revenue`. Verified: tsc green, eslint clean, vitest CeoDashboard 4/4, `vite build` green, backend 82 report tests
pass, both pages rendered from real service output with no console errors.

**28 Sep 2026 (late night) — every role's dashboard in the CEO design (`CrmDashboard.tsx`, `HiringControlTower.tsx`;
server half in B-V2 `CLAUDE.md`):** "I just saw all dashboards except CEO/Admin — make every role as attractive, bar graphs
with a proper view." **Hiring control tower**: the trend is a `FilteredBars` (positions in · onboardings · opportunities ·
fulfilled · closed by customer, row ticks per period), "Where the positions stand" (`funnelRows`), "Active customers"
(`customerRows`, + "Others (N)") and "Hiring stage delays" (`stageRows`: waiting · over warn · over bad · avg days) are
all bars; `TrendChart`, `CustomerDonut`, `Funnel`, `StageDelays` and the recharts imports are gone. **Role sections**
(`CrmDashboard.tsx`) now use the tower atoms — `Tile` (linked, toned) instead of `KpiCard`, `Panel` instead of `Card`,
`FilteredBars` instead of `FunnelBarChart` / `FunnelList` / most tables, and one `Speedometer` per desk: Sales Head —
Quarter by quarter (revenue · joined) + the two funnels; Sales / RMG — **Fill rate** dial + the requirement funnel;
RMG — Sourcing pipeline by position (positions · resumes · in pipeline) + the screening queue + the pipeline table
(`tableWrap`); TA — Recruiter productivity bars + the AI-interview queue, and the scorecard's **Applied → joined** dial
+ per-recruiter funnel bars (`rowFilter` off for `mine`); Finance — **PO utilisation** dial (`invert`, renew at 90 %) +
PO consumption as consumed / balance stacked bars; **HR** (had NO section — the page said "nothing to show") —
`HrPeopleSection`, the CEO `PeopleTab` (now exported with `CeoPeriod` / `CeoPayload`) under its own
`PeriodSwitcher` + `DateStepper`, from `GET /api/dashboard/people`. `funnelData()` is the one funnel → rows helper.
**`FilteredBars`**: a category label longer than `LONG_LABEL`=11 characters angles the x-axis ticks (−25°, 64 px axis,
+40 px chart) so "Pending Engineering Review" no longer collides with its neighbours. Harness: `?role=Sales_Head|RMG|
TA|Finance|HR` renders `CrmDashboardPage` with that single role (`executive` / `ta` are hand-mocked — their SQL is
Postgres-only; the rest come from the seeded book via `seed_mock.py`). Verified: tsc green, eslint clean, vitest
16/16 (CeoDashboard + OpportunitiesWorkspace), `vite build` green, backend 23 pass, five role dashboards rendered
with no console errors.

**16 Sep 2026 — Karnex Support Agent bot:** `components/support/KarnexBot.tsx` + `karnex-bot.css` (classes `kx-bot-*`) replace the pill trigger in `SupportWidget.tsx`: original inline-SVG robot avatar, float/halo/blink animations (reduced-motion aware), hover greeting bubble on the free side ("Hi! I'm your Karnex Support Agent"; `BOT_NAME`/`BOT_TAGLINE` are the one place to rename), pointer-drag anywhere with snap to the nearest edge (`DRAG_THRESHOLD_PX` 6 separates click from drag), dock persisted in `localStorage["support.bot.dock"]` (`{side, bottom}`), and the chat panel opens on the docked side (`panelStyle`). `triggerRef` still points at the bot button so Esc/focus-return is unchanged.

**28 Sep 2026 — landing page: speech bubble + three feature tags around the robot (no build step;
`frontend/index.html` only, `app.js?v=` unchanged):** the robot itself is UNCHANGED — the single
`assets/3d_robot_avatar_cut.png` with its `lpBob` float. A movable head (split PNG layers + pointer tracking) was
built the same day and REVERTED at the user's request; the layer files and `split_robot.py` sit in
`_to_delete/robot-layers/` in case it is ever wanted again. What stayed: `.lp-robot` (`position: relative`, wraps the
img only to anchor the extras), `#lpSay` speech bubble (top-right; five lines in the `LINES` array of the second
landing script — the wording to edit — cycled every 4.6 s from 1.4 s after load, stopped when the section loses
`.active` or the tab hides; reduced-motion shows the first line and stops) and three `.lp-callout` tags
(AI interviews · Proctored · ATS in seconds; staggered fade-in + float; `display: none` under 900 px).
⚠️ `.lp-hero-float` gained `width: min(100%, 520px)` (340 px under 900 px) — harmless with the intrinsic-width
img, load-bearing for any future layered robot (a flex item with only absolutely positioned children collapses to 0).
Verified with Playwright at 1440×900 and 420×860.

**28 Sep 2026 — Screening Desk = the whole RMG / GM day (server half in B-V2 `CLAUDE.md`):** `crm/pages/ScreeningDesk.tsx`
gains the **In review** tab (stage RMG_Review), a one-line **next step** under every queue row (server `next_step`; amber =
your move, muted = with TA / the candidate, red = AI L1 not cleared) and, in the detail pane: a `NextStepBanner`, **Submit to
Sales / Reject** (`VerdictModal` → `status-transition`, comment ≥ 5, "ask TA for the notice period" ticked when it is
missing; disabled with the server's `decision.blocked` reason), the **interview ladder** (`crm/components/InterviewLadder.tsx`:
AI L1 rung — schedule / reschedule / cancel via `ScheduleAiInterviewModal`, copy the candidate link, `AiInterviewOverview`
inline; manual L1 and L2 rungs — **Book** (`BookRoundModal` → `l2-face-to-face`, datetime-local sent as the IST wall clock,
interviewer from an Employees `<datalist>`), **Ask TA to book** (`l2-request`), **Record feedback** (`FeedbackModal` →
`PUT interview-rounds/{id}` with result chips on the server's `round_results` scale + feedback ≥ 5), Edit / reschedule,
optional L3 / L4 (`EditRoundModal` → `POST interview-rounds`); the row's batched `rounds` stand in as a stub until the full
list loads, so a button never waits for a second request), the **skill evaluation grid**
(`crm/components/SkillEvalGrid.tsx` — same `POST skill-evaluation` upsert as the profile tab; "Add the position's N skills"
seeds rows from the requirement's skills with their required levels; auto-open in review), the candidate **History**
(`activity-log`, collapsed), and the resume. Position headers: **"Add JD & skills"** amber chip when `jd_missing`
(`JdSkillsModal`, extracted to `crm/components/JdSkillsModal.tsx`, shared with `Requirements.tsx`) / a pencil otherwise, and
an "N in review" chip. **`RmgApprovalsStrip`** (`crm/components/RmgApprovalsStrip.tsx`) sits under the header when
`meta.approvals.can_approve`: each position waiting for RMG approval with JD / skills chips, **Review & approve**
(`JdSkillsModal mode="approve"` → `engineering-approve` with the JD text, skills and a note; refuses without a JD or a skill)
and **Reject** (reason ≥ 10 → `engineering-reject`). `Profiles.tsx`: `isRmg`, the round-feedback owner and
`canWriteTechnical` now come from `useCanApprove("profile.rmg_screening")` (GM has no built-in role — mirrors the server's
`screens_as_rmg`). Verified: `tsc --noEmit` green, eslint no new errors, `vite build` green, pending / shortlisted / review
tabs + feedback and approve dialogs rendered light + dark with mock data (no console errors).

**28 Sep 2026 — Suggested Candidates: the basis, good-fit / lacks, full history (server half in B-V2 `CLAUDE.md`):**
`crm/pages/Opportunities.tsx` `SuggestedCandidatesTab` reads `meta.basis` from the same endpoint and renders
`BasisCard` first — "Scored against REQ-x · title · RMG JD · N key terms · Band a–b yrs", the mandatory (`*`) and
optional skill chips, the JD terms — and an amber card when the position has NO RMG JD yet ("skills, band and history
only. Ask RMG to add the JD & skills"). Each row: skill chips (`bg-brand-50` — the old `bg-brand-600/10` was a dead
alpha class), green `JD: term` chips for the JD terms found on file, a "scored from ATS" chip when `skills_from_ats`,
then **`FitColumns`** — two boxes, Good fit (`strengths`) and Lacks (`gaps`), one line per area, the recent-rejection
gap in red — and **`HistoryList`**, a collapsed "Previous applications (N)" table (opportunity → `profiles/:id`,
customer with a "this customer" chip, stage reached, outcome badge `HISTORY_TONE`, AI L1 result · score, ATS, applied
date) with a red "N rejected by this customer" count on the toggle. The old `last_application` line remains only as
the fallback for a payload without `history`. The row's content column is `min-w-0 flex-1` so the Apply / Email
column stays on the right now that the body is wider. Search also matches JD terms. Verified: `tsc --noEmit` green,
eslint no new warnings, vitest OpportunitiesWorkspace 12/12, `vite build` green, rendered light + dark + no-JD with
mock data (no console errors).

**28 Sep 2026 (night) — Sourcing → Technical Screening → Technical Interview chips (server half in B-V2 `CLAUDE.md`):**
the three phases share the Sourcing stage, so a stage-only chip could not tell them apart. `crm/lib/candidateStageBuckets.ts`:
`StageBucket.group?` + `bucketQuery(key)` → `{stages, status_group}` — the ONE place a chip becomes query params. Chips now:
All · Sourcing · **Technical Screening** · **Technical Interview (L1 / L2)** (was "Internal Rounds (L1 / L2)") · With Sales ·
Submitted to Customer · Customer Interviews · Candidate Selected · HR & Onboarding. Opportunity ▸ Applicants sends
`pipeline_status` + `status_group`; Requirement ▸ Applied Candidates sends `stage` + `status_group` and keys its pills by
bucket KEY (the old label-keyed `STAGE_PILLS` is gone). The Candidate Profiles Status filter picks up the new statuses from
the catalogue with no code change (grouped under "Technical screening" / "Technical interview & internal rounds").

**28 Sep 2026 (night) — TA's Opportunities page restored (`OpportunitiesWorkspace.test.tsx` now 13):** reported with
screenshots — a TA (Gargee) got the Sales pipeline and landed on the OPPORTUNITY page (Close Won / Close Lost, Applicants)
instead of the REQUIREMENT page she sources from (Applied Candidates, Upload Resume, Scan all pending). Cause: the 26 Sep
GM fix made every gate in `OpportunitiesWorkspace` follow the tab GRANTS for ANY templated user, and her TA template grants
`opportunities`. ⚠️ Rule now: `grantDriven = useIsTemplated() && !useHasRole(...OPPORTUNITIES_NAV_ROLES)` — the role
layout is THE layout for anyone holding a built-in workflow role (Admin · Sales · Sales_Head · RMG · TA); grants decide only
for a user with none (GM). Pinned by "keeps the TA layout for a templated TA whose template grants Opportunities".

**28 Sep 2026 (night) — customer NAMES everywhere, never "Customer #id" (server half in B-V2 `CLAUDE.md`):** three
screens looked a customer's name up through a Customers-tab-gated endpoint and fell back to the id for everyone
without that tab: the requirement detail header (`Requirements.tsx` — now `req.customer_name`, else
`/api/customers/names`), the PO detail page (`Finance.tsx` — payload `customer_name`, else the existing `/names` map;
the Renew dialog gets the same name) and Holidays (`Holidays.tsx` — a `customerNames` map from `/api/customers/names`
under the Active-only picker list, so inactive accounts and HR logins get names too). ⚠️ Rule: resolve a NAME from the
payload or `/api/customers/names` (open to every CRM role) — never `/api/customers` or `/api/customers/{id}`. The
remaining `Customer #${id}` strings in the code are last-resort fallbacks behind a payload name.

**28 Sep 2026 (night, later) — TA's Applied Candidates: Stage + Status, one tab, budget decision (server half in
B-V2 `CLAUDE.md`; `CandidateStatusBadge.test.tsx` now 8):** (1) `RequirementDetailPage` hides the **Applicants** tab
for a TA-only login (`hasTaRole && !hasOtherWorkRole` — RMG / Sales / Sales Head / Admin keep it); every applicant now
lists in Applied Candidates (server change). Upload copy says "Applied Candidates". (2) `ResumesTab`: a TA-only login
(`taView`) drops **Source · RMG Screening · Received** (`TA_HIDDEN_RESUME_COLUMNS` — filtered out of the columns, the
layout AND the column chooser's labels). (3) New **Stage** column (`profile_stage`, in `RESUME_COLUMN_LABELS` + the
server registry) → `CandidateStageBadge`, plus `OverBudgetChip` when `over_budget`; **Status** → `CandidateRoundStatus`
(round name · state chip · date from the row via `ROUND_WHEN_FIELDS`: ai_l1 → `ai_interview_scheduled_at`, manual_l1 →
`l1_manual_when`, manual_l2 → `l2_when`, customer_l1/2 → `cust_l1/2_when`, hr → `hr_when`). Both components live in
`crm/components/CandidateStatusBadge.tsx`; `CandidateStatus` gained `stage?` / `round?`. (4) Stage chips
(`crm/lib/candidateStageBuckets.ts`) are now the server's `STAGES` keys sent as `?phase=` (`bucketPhase(key)`; `All`
sends nothing): All · Sourcing · Technical Screening · Technical Interview · Sales Screening · Customer Screening ·
Customer Interviewing · Candidate Selected · HR Screening · Onboarding · Closed — on Requirement ▸ Applied Candidates
and Opportunity ▸ Applicants alike. (5) `crm/components/TaBudgetDecision.tsx` — `OverBudgetChip`,
`TaBudgetDecisionModal` (Hold / Release · Reject · Not Fit, reason ≥ 5 for the closes, `POST …/ta-decision`),
`TA_HOLD`. The row's **Budget decision** / **On hold — decide** button shows for a TA while the candidate is at
Sourcing / Technical_Screening and is over budget or held. ⚠️ Hooks: never write `useHasRole(a) && !useHasRole(b)` — the
second call is skipped when the first is false (conditional hook); call both, then combine. Verified: tsc green, eslint
no new errors, vitest 21/21, harness render of the Stage / Status cells + the dialog with real server output, no console
errors.

**28 Sep 2026 (late night) — TA / RMG / GM row buttons in one palette, feedback-due panel (`TaDecision.test.ts` 6;
server half in B-V2 `CLAUDE.md`):** ⚠️ an upload now WAITS at Sourcing until TA presses **Technical Screening**
(reverses tonight's "automatic" decision). **`crm/components/flowButtons.ts`** is the ONE colour vocabulary for row
buttons — `FLOW_BTN.primary` (sky, move forward) · `success` (emerald, Shortlist / Release) · `warn` (amber, Hold /
feedback due) · `danger` (rose, Reject) · `ai` / `aiOutline` (violet, the AI L1) · `manual` / `manualOutline` (indigo,
human rounds) · `neutral`; `FLOW_DONE_CHIP`; `roundHasStarted(when)` (unknown time = started). `Requirements.tsx`'s
`smallBtn` / `smallPrimary` / `smallSuccess` / `smallDanger` are now aliases of it (`smallAi`, `autoChip`, `autoIds`, the
TA ATS `shortlist` handler and five dead imports were removed). **`crm/components/TaDecision.tsx`** replaces
`TaBudgetDecision.tsx`: `taDecisionsFor(row)` (PURE — Technical Screening only when never sent and not held; Hold ⇄
Release; Reject; Self Withdraw, which alone survives past the TA stages), `TaFlowButtons`, `TaDecisionModal` (one
dialog per decision, reason required for Reject / Self Withdraw), `OverBudgetChip`, `TA_HOLD`, `TA_STAGES`.
**Applied Candidates ▸ Actions:** TA gets those buttons first on every row with a profile (the old ATS "Shortlist"
and resume "Reject" are gone; "Reject resume" stays only for a row with no candidacy); RMG / GM (`isRmg` now includes
`useCanApprove("profile.rmg_screening")`, so a GM sees the RMG buttons) Shortlist / Reject a Pending row, then choose
**AI L1** (`ChooseAiL1Modal` → `request-ai-l1`) or **Manual L1** (`GoManualModal`); TA's **Schedule AI L1** and **Slot
invite** appear only after `ai_l1_requested` (one button for resume and profile-only rows); `FeedbackButton` (L1 / L2)
is locked until the interview time, then amber "feedback due"; **Request L2** is disabled until the L1 has a verdict
(manual result or AI score). The ZIP results dialog has **Send all for Technical Screening**
(`POST /api/candidate-profiles/send-for-screening`). **ATS Status column removed** (the score ring stays).
`InterviewRouteChoice` (Screening Desk) now CHOOSES — AI L1 → `ChooseAiL1Modal`, no longer `ScheduleAiInterviewModal`;
`InterviewLadder` shows "Chosen — TA is scheduling it", gates its L2 on a finished AI L1 or a recorded manual L1
(`aiDone`), and its feedback button follows the same clock. **`crm/pages/dashboard/FeedbackDuePanel.tsx`** — "Interviews
over — feedback due" under the greeting on EVERY dashboard (`GET /api/dashboard/feedback-due`, the server picks the
login's rounds; renders nothing when none). Settings ▸ Operations gains "Interview feedback reminders". Verified: tsc
green, eslint no new warnings, vitest 14/14 (TaDecision + CandidateStatusBadge), `vite build` green.

**28 Sep 2026 (latest) — Applied Candidates for TA: buttons by stage, every button coloured, rounds pop-up,
chips = Stage column (`TaDecision.test.ts` now 6; server half in B-V2 `CLAUDE.md`):** (1) `taDecisionsFor(row)` reads
the SERVER's derived stage (`profile_status.stage.key`, fallback the stored stage): Technical Screening · Hold / Release ·
Reject only at **Sourcing**, otherwise Self Withdraw alone. (2) Per-row **Run ATS Scan removed** (ATS runs on every add);
the header button is "Score N pending" and shows only when unscored rows exist; `scan` / `scanProfile` / `smallScanning`
/ `AiThinking` import deleted. (3) **`flowButtons.ts` — no white button**: soft tinted fills for `warn` / `danger` /
`aiOutline` / `manualOutline` and the new `view` (sky — View profile, View resume), `edit` (teal), `withdraw` (fuchsia —
Self Withdraw), `neutral` (slate), solid `delete` (rose — Delete). (4) **Status cell** prints the round's time, a
free-text time as typed (`fmtDateTime12(when, when)`), or an amber "Time not set" for a Scheduled round with none.
(5) **Rounds column** = "N of M rounds done" + per-round verdict chips (AI L1 included; colours from
`roundResultTone`), the whole cell a button → **`crm/components/InterviewRoundsModal.tsx`**: every AI L1 link (expands
into `AiInterviewOverview`) and every human round (time, interviewer, verdict chip, feedback text; amber "no feedback"
once the time has passed), oldest first — no trip to the profile. `ROUND_KIND_LABEL` + `roundResultTone` live there.
The **Interview** column (was "AI Interview") shows AI details only on the AI route; the manual route shows a "Manual
route" chip + **Interviews (N)** button into the same pop-up; no route yet → "—"; AI chosen but unbooked → "AI L1 — to
schedule". (6) **Stage chips**: "Candidate Selected" → **"Customer Shortlisted"** (chips, `ui.tsx` Shortlisted label,
Offer gate copy); `candidateStageBuckets.STAGE_TONE` gives each stage ONE colour, used by BOTH the Stage column badge
(`CandidateStageBadge`) and its chip, and every chip carries its count from `meta.phase_counts`. Verified: tsc green,
eslint no new warnings, vitest 14/14 (TaDecision + CandidateStatusBadge), `vite build` green (the new tinted classes
are in the built CSS).

**28 Sep 2026 (last) — "My work today" desk on every dashboard + small interviews pop-up + modal clicks never
navigate (`pages/dashboard/WorkDesk.test.tsx` 2, `components/DataTable.portal.test.tsx` 1; server half in B-V2
`CLAUDE.md`):** (1) **`crm/pages/dashboard/WorkDesk.tsx`** replaces `FeedbackDuePanel.tsx` (deleted) under the greeting
on EVERY dashboard: a header ("N tasks waiting on you" · as of · refresh) + a CEO-style tab strip (gradient icon tile per
tab from `TAB_LOOK`, count chip amber / "All clear" green) over `GET /api/dashboard/desk` — the SERVER picks the tabs
(Feedback due · To schedule · Awaiting your call · To screen · Choose route · Upcoming · My queues). The remembered tab
(`localStorage["crm.desk.tab"]`, try/catch) wins if it still exists, else the first tab with work. A **feedback** item's
button opens `InterviewRoundsModal` IN PLACE (record the verdict without leaving the Dashboard; `onChanged` refetches the
desk); every other item is a `CrmLink` to `item.path`. (2) **`InterviewRoundsModal` is a `medium` pop-up now** — it used
`wide`, which in `Modal` means a FULL-PAGE takeover (that was the "opens a big screen"). Header "N of M done"; each
human round has **Add feedback** (amber, once the interview time has come) / **Edit** (teal) when the kind is in the
server's `interview-rounds/options.writable_rounds` — it opens the SAME `FeedbackModal` the Screening Desk uses (now
EXPORTED from `InterviewLadder.tsx`, label from `ROUND_KIND_LABEL`, `user_role` from `roundUserRole(kind)` — HR round →
HR, customer rounds → Customer, else RMG; HR rounds use `hr_results`), stacked on top; saving reloads the list and calls
`onChanged` so the Applied Candidates row refreshes. New **`crm/lib/interviewRounds.ts`** holds `ROUND_KIND_LABEL`,
`roundUserRole`, `roundResultTone` (moved out of the modal; `Requirements.tsx` imports from there). (3) ⚠️ **"Closing the
pop-up took me outside the page" — the real bug, on every tab with clickable rows**: `Modal` is portalled to `<body>`, but
React bubbles a portal's events through the COMPONENT tree, so any click inside a dialog opened from a table cell (its
Close X, the backdrop, a button) reached the row's `onClick` and navigated to the profile. New `ui.isOwnDomClick(e)`
(`currentTarget.contains(target)`) — `DataTable` rows and `CustomerGroupedList` rows only act on clicks inside their own
DOM; pinned by `DataTable.portal.test.tsx`. **Any new clickable container that can host a dialog must check it too.**
Also: `InvoicesPage` reads `?tab=` (the desk's Proforma queue lands on it); an unused `LayoutList` import left
`CustomerGroupedList`. Verified: tsc green, eslint clean on the touched files (Finance.tsx's `autoFocus` errors are
pre-existing), vitest 3/3 new, `vite build` green.

**28 Sep 2026 (final) — RMG / GM task board on the Screening Desk + Dashboard, "results to review", tab cleanup
(`crm/components/RmgTaskBoard.test.tsx` 2; server half in B-V2 `CLAUDE.md`):** (1) **`crm/components/RmgTaskBoard.tsx`**
renders `GET /api/screening-desk/tasks` as tiles (icon gradient from `TASK_ACCENT`, count, label; `TASK_ICON` maps the
server's icon names). Desk categories (`DESK_TASKS` in `ScreeningDesk.tsx`: feedback · results · screening · route ·
booking · decide · ai_failed) FILTER the queue (`?task=` to the server, which answers with the category's own rows);
page categories (approvals · jd · headcount · templates) open their list under the board, each row a `CrmLink`.
(2) **`ScreeningDesk.tsx` redesigned**: gradient hero ("N pending" + refresh), the task board, then either the active
task chip + "Show every candidate" or the screening tabs, with the filters behind a **Filters** toggle (open when any
filter is set). Deep links `screening-desk?task=<cat>&focus=<profile id>` (`readDeskLink`, re-read on `popstate`)
select and scroll to `#desk-row-<id>`; `reloadAll` refreshes queue + board after every action; `?task=approvals`
scrolls to `#rmg-approvals`. Rows with `new_results` get a green **New result** chip; the detail pane's
**`ResultsReviewBanner`** lists each finished interview (AI L1 / round · verdict · score · when · by · "Open report")
and **Mark reviewed** (`POST /api/screening-desk/results-reviewed`). (3) **`WorkDesk.tsx`**: RMG / GM tabs ARE the
board's categories (server), `lookOf()` dresses unknown keys from `TASK_ICON`/`TASK_ACCENT`, an **Open Screening Desk**
button appears when a screener tab exists, tiles use an auto-fill grid with wrapping labels, a feedback row has
Record feedback (pop-up) AND Open (desk / profile). (4) `router.tsx` `CRM_FILTER_KEYS` += `task`, `focus` (cleared on
every navigation); `CrmApp.openNotification` forwards validated `task` (`[a-z_]{1,32}`) and `focus` (digits) from bell
links. (5) **Requirement page**: the Draft → Sales Head → RMG Review → Sourcing **stepper is removed** (with
`STEPS`/`stepState`); a screener-only login (`useCanApprove("profile.rmg_screening")` and not TA / Sales / Sales Head;
Admin keeps everything) does not get **Applicants** or **Suggested Candidates** and always gets Applied Candidates +
Interview History. Same on the **opportunity page** (`screenerOnly`, both hooks always called). Verified: tsc green,
eslint no new errors, vitest RmgTaskBoard 2 + WorkDesk + OpportunitiesWorkspace + CeoDashboard + DataTable.portal
green, `vite build` green, desk + dashboard rendered light / dark / 400 px with mock data, no console errors.

**28 Sep 2026 (last) — Screening Desk search + every filter on screen (server half in B-V2 `CLAUDE.md`):** the search
box and the main filters are ALWAYS visible under the tabs (no longer hidden behind a toggle): search (name · email ·
phone · position · REQ / OPP number · customer · city) · Customer · **Position** (`options.positions`, scoped to the
chosen customer / opportunity; a foreign one is dropped) · Sort (+ Lowest ATS, Most experienced) · **More filters (n)**
panel: Opportunity · Applied by (TA) · **Whose move** (`next_owner`) · **Interview route** · **Experience vs position**
(`exp_fit`) · ATS score · Candidate type · **Location** (debounced like search) · Applied from / to · **Only candidates
with a new interview result**. Active filters show as removable chips with "Clear all" and the match count
(`FILTER_WORDS` / `FILTER_NAMES` / `filterWord`). The search input is `type="text"` on purpose — `type="search"` draws
a second native ×.

**28 Sep 2026 (night, last) — Dashboard = tiles, My Tasks page, profile page redesign + Next-step buttons, round-time
fix (`WorkDesk.test.tsx` 3, `StageActions.test.ts` 3, `lib/datetime.test.ts` 3; server half in B-V2 `CLAUDE.md`):**
(1) **`WorkDesk.tsx` now exports two views of `/api/dashboard/desk`**: `WorkDesk` (the Dashboard) renders the tabs as
TILES ONLY — each a `CrmLink` to the server's `tab.link` (RMG / GM categories → the Screening Desk on that task, the rest →
`my-tasks?tab=`), header button "Open Screening Desk" / "Open My Tasks"; no item list on the Dashboard any more. New route
**`my-tasks` → `MyTasksPage`** (gradient header, the tiles as a tab strip, `?tab=` read on mount + popstate, items with their
actions; a feedback item still records in the `InterviewRoundsModal` pop-up). `RmgTaskBoard` opens a PAGE category's list
from a deep link (`?task=jd`) — `activeTask` is now the raw task; `picked === undefined` means "follow the link".
(2) **Applied Candidates**: a TA-only login opens with **Applied by = themselves** (`myName` = `me.full_name || username`,
matched to `ta_owner_name`, "(me)" in the list) — not when `?q=` came from a notification (the candidate may be a
colleague's). (3) ⚠️ **Round times**: `lib/datetime.isoToIstInput(v)` is THE way to put a stored interview time into a
`datetime-local` field (aware → Asia/Kolkata wall clock; naive kept). `slice(0,16)` of the UTC instant moved the round 5h30
earlier on every edit — fixed in `InterviewLadder.EditRoundModal` and the profile's `InterviewRoundModal` (which now posts
the typed wall clock, not `toISOString()`). `ScheduleAiInterviewModal.toInputValue` is module-private now (legacy naive
stamps only). `InterviewRoundsModal`: "N of M done" leaves not-held rounds out (same tally as the row), "Feedback due" is
amber. (4) **`crm/components/handoverNote.ts` → `useHandoverNote(profileId, enabled)`** pre-fills the Submit-to-Sales
comment on the Screening Desk (`VerdictModal`), the profile's RMG banner and Applied Candidates (only an EMPTY field is
filled; "Written from the recorded interviews…" hint). (5) **`crm/components/StageActions.tsx`** — `stageActions(current,
allowed, exclude)` (PURE: forward / win / back / reject / withdraw, ordered; the generic "Rejected" dropped when a stage-specific
rejection exists; `BACKWARD_MOVES`, `CLOSING_STATUSES`) + `StageActionBar`. The profile header's **Next step** bar renders
`allowed_next_statuses` as coloured buttons (Sales at Sales Screening: Customer Screening · Sales Rejected · Self Withdraw);
a click opens `TransitionModal` with `initialStatus` (no dropdown). ⚠️ **The "Change Status" button and the separate
"Submit to Customer" button are GONE** (Customer Screening stamps the same date on the server). `panelMoves` keeps moves a
guarded panel already offers off the bar (RMG_Review → Sales / RMG Rejected for screeners; Shortlisted → Customer Approval
for Sales). (6) **Profile header redesigned**: gradient identity band (initials avatar, name, AI chip, contact + white
"View CV" pill, opportunity), `StageJourney` stepper over `CANDIDATE_STAGE_BUCKETS` (closed = the stage it closed in, red),
`RoundProgress`, five accent-barred `HeaderStat` tiles, the Next-step bar. Verified: tsc green, eslint no new warnings,
vitest 16 across the touched files, `vite build` green.

**29 Sep 2026 — hand-overs on the desk, Applied Candidates on the opportunity page for RMG / GM, customer slots
(server half in B-V2 `CLAUDE.md`):** (1) **`crm/components/HandedOverPanel.tsx`** — "Submitted to Sales — last 30 days"
(`GET /api/screening-desk/handed-over`: candidate · status chip · when · by · the recommendation on demand · Open
profile), rendered on the Screening Desk while `?task=decide` is active, reloaded with the task board. (2) `Requirements.tsx`
**exports `ResumesTab`**; `Opportunities.tsx` lazy-loads it (`RequirementResumesTab` — a static import would tie the two
route chunks, since Requirements imports `SuggestedCandidatesTab` from here) inside `ScreenerAppliedTab`, a new
**Applied Candidates** tab for a screener-only login (`screenerOnly && opp.requirement_id`; it fetches
`/api/requirements/{id}`). (3) `TransitionModal` slot copy: "TA is sent these slots … nothing is booked yet"; the label
reads Customer L1 only at Customer Interviewing. (4) Employees sort: "" = **Latest first** (the server default is now
recently updated), "Newest joiner first" = `date_of_joining`. Removed an unused `ArrowRightLeft` import.

**29 Sep 2026 (later) — customer slots in TA's Schedule form, Sales' feedback button (`crm/lib/interviewRounds.test.ts`
3; server half in B-V2 `CLAUDE.md`):** `crm/lib/interviewRounds.ts` gains `CUSTOMER_ROUND_KINDS` / `isCustomerRoundKind`,
`CUSTOMER_ROUND_ROLES` (Sales · Sales_Head · Sales Manager — mirror of the server), `isRoundNotHeld` (now also used by
`InterviewRoundsModal`), `isFeedbackDue` (the server's rule: start + duration, default 60 min, no verdict, held) and the
`CustomerSlotOffer` type + `offeredSlotsSummary`. `Profiles.tsx` `InterviewRoundModal`: in Schedule mode for a customer
round, `CustomerSlotPicker` lists the offer from `options.customer_slots` (only when its kind is this round) — one click
fills date (the IST wall clock, ready for datetime-local), meeting link, panel and a listed duration; a single slot is
picked automatically. Saving already emails the candidate the link + calendar invite. `isSalesUser` / `canWriteCustomer`
now include Sales Manager. The profile page shows a **"Customer feedback due"** banner to Sales / Sales Head / Sales
Manager with one "Add Customer L1/L2 Interview feedback" button per overdue customer round (opens the form in Feedback
mode). Applied Candidates: a sky "Customer offered: <slot> (+N more)" chip beside Schedule Customer L1 / L2
(`slotHint`, `ResumeRow.customer_slots`). Removed an unused `Fragment` import from `Requirements.tsx`.

**29 Sep 2026 — tabs, Back / Forward and scroll survive navigation (`crm/lib/pageState.test.tsx` 5;
`OpportunitiesWorkspace.test.tsx` resets the address + session per test):** reported — open an opportunity, go to another
page, come back: it opened on the first tab; Back / Forward did not step properly. **`crm/lib/pageState.ts`** —
`usePageTab(param, fallback, allowed?)`: the tab lives in the ADDRESS, every click PUSHES a history entry, popstate
re-reads it, and when the address names none the tab last used on that exact CRM path this session is restored
(sessionStorage `crm.tab:<path>#<param>`) and written back with replaceState. ⚠️ The default tab is ALWAYS written too —
an entry without it would fall back to the session memory (the LAST tab, not that entry's). Snap-to-first-visible
effects call `setTab(x, { replace: true })` so they add no history entry. `useSessionState(name, initial)` keeps a
list's page / search per path (`crm.state:`); `useChangeEffect` is the "filter changed → page 1" effect that skips its
mount run (a plain `useEffect` would wipe the restored page). Param names (all in `router.CRM_FILTER_KEYS`, cleared on
navigation): `tab` (main sections), `status` (list status chips), `hub` (Projects hub — its embedded Timesheets /
Invoices own `tab`), `opp_tab` (Opportunities workspace; an explicit `preferTab` still wins at mount), `rtab`
(requirement list inside the workspace), `phase` (Applied Candidates stage chips), `sub` (spare). Never `view`, `p`,
`cid`, `iid`, `ret`. Converted: Opportunity list + detail, workspace, Requirement list + detail + stage chips, Profile
(the old replaceState `selectTab` is gone — tab clicks now PUSH), Customers, Projects (hub + list + detail), Employees
(list + detail), Finance (POs · Invoices · TDS), Timesheets, Leave Applications, Template Requests, Candidates, Branch
Policy, PE detail, CRM Settings, Reports, Finance Reports, Users admin, Screening Desk; page + search on Opportunities,
Requirements, Employees, Customers, Projects, Invoices, Template Requests, Candidates. **Shell (`CrmApp.tsx`)**:
`HistoryButtons` (Back / Forward beside the menu toggle; disabled at the ends where the Navigation API says so) and
scroll memory — offsets remembered per address via a CAPTURE-phase document scroll listener (element scrolls do not
bubble and `<main>` does not exist while the login loads); `router.isPushNavigation()` tells crmNavigate's synthetic
popstate (new page → top) from the browser's Back / Forward (restore, retried every 80 ms for 2.5 s while data loads,
cancelled by the reader's wheel / touch); the scroller is `<main>` when its CSS overflow is auto (desktop), else the
window. `ui.Tabs` now has `role="tablist"` / `role="tab"` + `aria-selected` + `type="button"`. Verified in Chromium:
Settings tab → Reports → Back (tab restored) → Back → Forward; Opportunities "Closed" → an opportunity → Back ("Closed",
Pipeline T&M); Customers scrolled 900 px → Settings (top) → Back (900 px). tsc green, `vite build` green, vitest 180 pass
(the two failures are `brand.test` needing the runtime pages and `opportunitySchema` expecting "Remote" in
`WORK_LOCATION_OPTIONS` — neither touched here).

**29 Sep 2026 (evening) — Sales slots pop-up, three scheduling tabs on My Tasks, Sales' details prefilled
(`WorkDesk.test.tsx` 4; server half + migration 0112 in B-V2 `CLAUDE.md`):** (1) **`crm/components/CustomerSlots.tsx`**
is the ONE home of the customer's slot offer: `offerFor(offer, kind)`, **`SalesSlotsButton`** ("Sales slots (N)" → a
small pop-up: every slot, its link or "No link yet", panel, length, Sales' note, sent-by; optional Schedule button) and
`CustomerSlotPicker` (moved out of `Profiles.tsx`). Applied Candidates shows the button beside Schedule Customer L1 /
L2 (`slotHint`); the "Customer offered" chip and `offeredSlotsSummary` are gone. (2) **`InterviewRoundModal`**: a NEW
customer round takes the first slot, its link, the panel and the length automatically (TA clicks another slot if the
candidate prefers); the **meeting link is required** to schedule a customer round (the server refuses it too).
(3) **My Tasks**: tabs `schedule_customer` (Customer interviews) · `schedule_internal` (L1 / L2 interviews) ·
`schedule_hr` (HR interviews) replace "To schedule" (`TAB_LOOK`). Each item books IN PLACE through
**`crm/components/ScheduleRoundLauncher.tsx`** — customer / HR rounds → `Profiles.InterviewRoundModal` (lazy, Profiles is
a big chunk), `AI_L1` → `ScheduleAiInterviewModal`, `L1_Interview` / `L2_F2F` → the Screening Desk's `BookRoundModal`
(now EXPORTED from `InterviewLadder.tsx`, with its `Options` type; interviewer suggestions fetched from
`interview-rounds/options`) — plus the Sales slots button and Open. (4) The Sales Manager's `/api/me.roles` now carry
Sales + Sales_Head, so every role-based screen treats them as the Sales Head.

**29 Sep 2026 — Upload Resume form redesigned; Education / skills out, Current location + Note in (server half in
B-V2 `CLAUDE.md`):** the TA's "Upload resume" dialog on Requirement ▸ Applied Candidates now lives in
**`crm/components/UploadResumeModal.tsx`** (it was ~250 lines inside `Requirements.tsx`; `SOURCE_PORTALS` moved there too
and `EditResumeModal` imports it). The layout is a drag-and-drop resume zone first (file card with Replace / remove once
picked, "Filled N fields from the resume" chip). Then four section cards with gradient icon tiles and a ✓ when complete:
Who (name · email · phone · source as one-tap chips) · Experience & availability (yrs suffix, in/out-of-band hint
against `experience_min/max`, notice chips) · Compensation (LPA suffix, live "+N% hike asked", red chip when expected >
`budget_ctc_max` — it never blocks) · Location & note (Current location, Preferred location with "Same as current" /
"Job location" chips, Note ≤ 1000 with a counter). A sticky side panel holds the profile-strength ring + checklist, the
position (band · budget · location · must-have skills) and a "what happens next" tip. The footer holds the strength bar,
Cancel and **Upload & apply**, which fills with the XHR upload progress; **Ctrl/⌘+Enter** uploads. A field the parser
filled carries a violet **"from CV"** tag until TA edits it, and parsed values only ever fill EMPTY fields.
⚠️ **Highest education, Technical domain and Key skills are no longer fields** (user ask), but whatever `/api/resumes/parse`
read for them is still sent (`parsedExtras` → `education` / `technical_domain` / `skills`), so ATS, Suggested
Candidates and the candidate record lose nothing. The parser's `location` now pre-fills **Current location**, not
Preferred. New form fields `current_location` and `note`. The Applied Candidates row prints "Lives in …" and an amber
"TA note: …" line (`ResumeRow.application_details.current_location / note`). `dirty` guards Esc / X. Harness:
`src/__story/upl.tsx` + `upl.html` (parse mocked via Playwright route). Verified: tsc green, eslint clean on the new
file, `vite build` green, rendered light / dark / 400 px with no console errors.

**29 Sep 2026 — Finance's billing chain on the Dashboard + the PO renewal panel (server half in B-V2 `CLAUDE.md`):**
(1) `WorkDesk.tsx`: Finance's tiles, first: **Approved timesheets** (COMING UP) → **Proformas to convert** (YOUR MOVE)
→ **Tax invoices issued** (DONE), each linking to My Tasks on that tab. `DeskTab` gains `stage` (the small caption
above the label) and `info`: an info tab never counts in "N tasks waiting on you", and its count chip is brand-blue,
not amber (it reads "None" at zero, not "All clear"). `TAB_LOOK` adds `fin_timesheets` / `fin_proformas` /
`fin_invoices`. (2) **`crm/pages/dashboard/PoExpiryPanel.tsx`** replaces `CrmDashboard`'s `PoExpiryWarnings` one-line
strip. That strip was built on the dead alpha classes `border-warning/40` and `bg-warning-soft/60`, so it rendered
grey. Same endpoint (`/api/purchase-orders/reports/expiry?days=45`). The panel has a header with "All purchase
orders" and a collapse chevron (remembered in `localStorage["crm.dash.poExpiry.open"]`, wrapped in try/catch).
Below that, three `StatTile`s: Ending in 45 days (count + balance still to bill), Already expired (count + balance
left unused), and Next to lapse. The first two switch the list. The list is a searchable table (PO link · customer ·
end date · days chip, red within 7 days or expired · used % bar · balance) showing 6 rows with "Show all N".
Expiring POs sort soonest first; expired POs sort most recently lapsed first. A 403 renders nothing (Sales also
mounts it). Harness: `src/__story/fin.tsx` + `fin.html` (desk + expiry mocked via Playwright routes). Verified: tsc
green, eslint clean, `vite build` green, rendered light / dark / 400 px with no console errors.

**29 Sep 2026 (night) — schedule form redesign, the Customer L2 hand-off, friendly "not found" (`CustomerSlots.test.ts` 3;
server half + migration 0113 in B-V2 `CLAUDE.md`):** (1) **`Profiles.InterviewRoundModal` Schedule mode is rebuilt**: a
round header (name from `ROUND_KIND_LABEL`, locked when opened for a round, "Customer's / Karnex / HR panel" chip), then
three numbered `ScheduleStep`s whose number turns into a tick when complete — **When** (the customer's slots as cards +
"Or another time (IST)" + a Length segmented control), **Meeting link** (icon input, https check, required for customer
rounds), **Panel** (customer name, or employee search + external name) — a note, "More options" (category · user role)
and a summary strip that says exactly what the candidate is emailed, or what is still missing (`scheduleMissing`, the same
rules `submit` enforces). Feedback mode is unchanged. The Schedule / Feedback switch shows only to someone who can do both
(TA gets no one-button bar). Picking a slot takes ITS link and clears a link carried over from another slot. `SCHED_CONTROL`
is the form's own control class (`inputCls` ends in `w-full`). The dead `bg-surface-2/40` on the switch is fixed.
(2) **`CustomerSlots.CustomerSlotPicker`** is now a radio grid of slot cards (calendar tile with weekday + day, time large,
"Customer link included" / "No link — add it below", tick ring); `slotParts(value)` (PURE, exported) splits the stored IST
wall clock without any zone conversion. (3) **`TransitionModal`**: moving to "Customer L1 / L2 Interview" no longer asks
for Feedback — the field becomes "Note for TA (optional)" (it goes to TA with the request); a note is required only for
rejections, backward moves and the closing verdict. (4) **Applied Candidates** offers Schedule Customer L2 at L1_Feedback
OR L2_Feedback. (5) **`ui.ErrorBox`**: a `"<Thing> not found"` message renders as "It may have been removed, or it is not
shared with your role" with ← Go back (every screen at once); "cannot view" joins the role-message patterns. The
requirement page sends a `tab=resumes` deep link to **Applicants** for a role without Applied Candidates (plain Sales) and
`RequirementApplicantsTab` pre-fills its search from `?q=`. Verified: tsc green, eslint 0 errors, vitest (CustomerSlots 3,
WorkDesk 4, interviewRounds 2), `vite build` green, the schedule form rendered at 1280 / 400 px with no console errors.

**29 Sep 2026 (late) — Sales works from My Tasks; the Submit-for-approval pop-up redesigned (`WorkDesk.test.tsx` 5;
server half in B-V2 `CLAUDE.md`):** (1) **`crm/components/SalesDeskActions.tsx`** — `SalesItemActions` renders one Sales
item's buttons: for `sales_submit` / `sales_response` / `sales_decide` the server's `allowed` through `stageActions`
(backward moves and Self Withdraw left to the profile, `deskMoves`); "Submit terms" / "Resubmit terms" (`sales_terms`);
Approve · Send back · Reject (`sales_approval`); "Reply to HR" (`sales_budget`); read-only for `sales_waiting`.
`SalesActionLauncher` opens the matching dialog — `Profiles.TransitionModal` (now EXPORTED, lazy-loaded like
`ScheduleRoundLauncher`), `SubmitForApprovalModal`, `SalesHeadDecisionModal`, `BudgetReplyModal`. `TermsLine` prints the
submitted rate + onboarding under approval / waiting items. `WorkDesk.tsx`: `TAB_LOOK` for the seven `sales_*` tabs,
`DeskItem` layers the Sales fields, My Tasks routes any `sales_*` tab through `SalesItemActions` and refetches after a
move. (2) **`OfferApprovalGate.SubmitForApprovalModal` redesigned** (`medium`, `dirty`): a gradient hero (initials,
name, "Customer shortlisted", opportunity) with the journey Customer shortlisted → **Sales Head approval** → HR
Discussion; a "sent back" banner (`sentBack`); the **rate** with a Hourly · Monthly · Yearly segmented control, a big ₹
input with its unit suffix, chips (≈ ₹ a year · Within budget / Over budget by … · ±% vs expected) and one-click "Use
expected" / "Use budget", plus a **budget check** — bars on one scale for Current CTC · Expected · Budget (band) · this
rate; the **onboarding date** with Next Monday · In 2 weeks · 1st of next month picks and "Monday, 5 Oct 2026 · in 6
days" (amber when in the past); the note with a counter; and a "Sales Head receives" summary. New optional props
`currentCtc`, `approvedBudgetLac` (LAC), `budgetBand`, `opportunityLabel`, `sentBack` — the profile page and My Tasks
pass them; Applied Candidates passes `sentBack`. Same endpoint and payload. Copy fixed everywhere to **HR Discussion**
(was "Pre Onboarding") — the profile banner, `SalesHeadApprovalBanner`; the profile banner reads "Sales Head sent the
terms back — revise and resubmit" / "Resubmit the terms" on `terms_sent_back`. Dead alpha classes `bg-surface-2/50` and
`border-danger/40` in the budget dialogs fixed; `autoFocus` removed from the decision note (a11y lint). Verified: tsc
green, eslint 0 errors, vitest WorkDesk 5/5, `vite build` green, the pop-up rendered at 1280 / 400 px and My Tasks' Sales
tabs with no console errors.

**29 Sep 2026 (night) — Sales Head decision pop-up, schedule form v2, HR desk + HR dashboard (`WorkDesk.test.tsx` now 6;
server half in B-V2 `CLAUDE.md`):** (1) **`OfferApprovalGate.tsx`** now has ONE set of shared pieces both dialogs use —
`CandidateHero` (gradient identity + the "where this sends them" steps), `SectionTitle`, `RateInput` (unit segmented
control + the big rupee input), `convertRate`, `BudgetCheck` (current · expected · budget · rate bars), `OnboardingPicker`
(date + Next Monday / In 2 weeks / 1st of next month + "in N days"). **`SalesHeadDecisionModal` redesigned** (`medium`,
`dirty`): a decision switch (Approve · Send back · Reject, `DECISION_LOOK` — hero colour, steps, button gradient, wording)
so a change of mind needs no second dialog; on Approve the rate in the unit Sales quoted with "Sales quoted …", a "You
changed the rate · Undo" chip, budget chips + bars, the onboarding picker with "Undo — Sales said …"; otherwise the terms as
two read-only cards; note starters per decision (`NOTE_PICKS`, they append); a "what happens next" line. New optional props
`expectedCtc`, `currentCtc`, `approvedBudgetLac`, `budgetBand`, `opportunityLabel` (My Tasks passes them; the banner and
Applied Candidates still work without). Same endpoint + body. (2) **`Profiles.InterviewRoundModal` schedule v2**: no duplicate
banner (`WizFormShell bare`; the Modal title names the round — "Schedule HR Round"); the panel step shows a chosen employee
as a card with **Change**, the search lists "+ Someone not on the list (external)" LAST, and the name box appears only for
an external panellist or a customer round (`panelExternal`); lengths read "30 min · 1 h · 1 h 30" (`durationLabel`).
(3) **My Tasks for HR** (`WorkDesk.tsx`): HR discussion ("Request HR round" posts `l2-request {round:"HR"}` in place) ·
HR interviews (Join link, https only, + "Panel:") · Pre-onboarding · Joining soon · Joined · Leaving (`TAB_LOOK`).
(4) **HR dashboard** (`CeoDashboard.PeopleTab`, shared with the CEO's People tab): `PlacementsPanels` after "How the year
unfolded" — internal vs external stacked bars per bucket, a mix dial + counts (rules as hints), and by customer (no money);
the four name-list panels are replaced by **`PeopleDirectory`** — one panel, tabs On notice · Joined · Placed · On the
bench · Left with counts, a search box, people as avatar cards (name → employee, code · role, a chip: last day in N d /
joined / left / cost per month / Internal–External), 12 at a time with Show more. `PeopleList` removed.
Verified: tsc green, eslint 0 errors on the touched files, vitest WorkDesk + CeoDashboard + CustomerSlots, `vite build` green.

**29 Sep 2026 (night) — interviews pop-up, profile Overview, Submit-to-Sales checklist, right-click "open in new tab"
(server half in B-V2 `CLAUDE.md`):** (1) **`InterviewRoundsModal` redesigned**: summary band (N of M done, progress bar,
Done · Upcoming · Feedback due · Not held chips) + a timeline — one card per interview, icon tile by who runs it
(`FAMILY`: AI violet · Karnex technical indigo · customer sky · HR emerald), verdict chip, meta (time · length ·
interviewer · mode · join link while upcoming), feedback as a quote, "Record / Edit feedback". ⚠️ **Saving feedback
closes the pop-up** (every role): `onChanged(msg)` now carries the server message and the caller toasts it
(WorkDesk, Requirements). (2) **Profile Overview redesigned** into sections (`OverviewSection`): Commercials (big ₹ … L
inputs + hike chip) · Hand-offs (stamped dates as steps) · Locations (customer vs candidate vs preferred, with a
"lives in / willing / relocation likely" chip; **owners — TA / Sales / RMG — can now fill the two candidate locations**,
not only HR) · Onboarding & employee record · Documents & notes · a sticky save bar. An amber "Location details
missing" banner tops the tab. `OverviewTab` is exported (story harness). Dead `bg-surface-2/60` classes fixed there.
(3) **`crm/components/SalesReadinessPanel.tsx`** — "What Sales needs" checklist inside all three Submit-to-Sales
dialogs (Screening Desk `VerdictModal`, profile RMG banner, Applied Candidates); missing items get inline inputs →
`PATCH …/sales-details`; `useHandoverNote` now also returns `checks` / `setChecks` (`SalesCheck` type). Dialogs are
`medium` for the sales verdict. (4) **`crm/components/RowLinkMenu.tsx`** — right-click a list row → Open · Open in new
tab · Open in new window · Copy link (Shift+right-click = the browser's menu); Ctrl/⌘+click and middle-click → new tab.
`DataTable` and `CustomerGroupedList` take **`rowHref(row) → CRM path`** (without `onRowClick` a click navigates there);
every `onRowClick={(r) => crmNavigate(\`x\`)}` list got the matching `rowHref`, `CustomerScopedTable` takes `href`, the
profile card grid has it built in. **New clickable lists: pass `rowHref`.** Verified: tsc green, eslint clean on new files,
vitest DataTable.portal + WorkDesk + OpportunitiesWorkspace 19/19, `vite build` green, pop-up / Overview / checklist /
menu rendered light + dark + 400 px with no console errors.

**29 Sep 2026 (latest) — role chips name what you hold; Sales billing tabs; sectioned My Tasks
(`pages/dashboard/groupBySection.test.ts` 3; server half in B-V2 `CLAUDE.md`):** `CrmApp.displayRoles(me)` /
`roleTitle(me)` read the server's `display_roles` (roles HELD, no implied ones) ranked CEO · Admin · Sales Head ·
custom roles · the rest — the header chips and the greeting chip use them, so a Sales Manager reads "Sales Manager"
(`me.roles` still carries "Sales" for role checks). `Me` gains `display_roles` / `sees_team`. `WorkDesk.groupBySection`
renders any tab whose items carry `section` as grouped lists with a count per group (customers on the Sales billing
tabs; Sent back · Ready to submit · With Sales Head on **"Submit to Sales Head"**, whose waiting rows print
`TermsLine` and no button). `TAB_LOOK` adds `sales_timesheets` / `sales_invoices_pending` / `sales_invoices` /
`sales_collections`; `SalesDeskActions.SALES_BILLING_TABS` keeps them out of `isSalesTab` (plain links).

**29 Sep 2026 (late) — AI report links, AI Costs, HR desk v2, Candidate Profiles directory redesign
(`crm/pages/profiles/profileColumns.test.tsx` 3; server half in B-V2 `CLAUDE.md`):** (1) ⚠️ **`AiInterviewOverview` called
`/candidate-profiles/…/summary` WITHOUT `/api`** — every AI verdict card said "Not Found". Fixed; a cross-check of every
`crm*()` call against the backend's routes found no other. `AiInterviewOverview` now exports **`useCanOpenAiReport()`** and
**`AiReportLink`** (the one "Full AI report" button, or "ask RMG or TA"); `InterviewRoundsModal` shows it on every AI card
and opens the latest finished AI verdict by default; Applied Candidates' "View report" is for every role that can open the
report (was TA only) and opens in a new tab. (2) **Profile header**: the AI L1 chip in `RoundProgress` is a link to the
full AI report (`aiReportLink`), and **"View feedback" opens `InterviewRoundsModal`** (every round, AI verdict open) instead
of switching tabs. (3) **AI Costs**: `summary.estimated_usd` / row `estimated_usd` (types in `api/aiCosts.ts`) — the Interview
spend tile says "incl. ₹x estimated", an "estimated" chip on rows whose audio was estimated, and the footnote explains the
pre-28-Sep estimate; `inr()` prints paise under ₹100 (a ₹0.40 interview read ₹0). (4) **My Tasks for HR**: `TAB_LOOK` for
`hr_leave` · `hr_records` · `hr_bench` · `hr_celebrations`; an HR-only login gets no Upcoming / My queues tiles (server).
(5) **Candidate Profiles directory redesign** (`profiles/ProfilesListPage.tsx`): a gradient header card with the **stage
strip** — `CANDIDATE_STAGE_BUCKETS` chips in `STAGE_TONE` colours with the server's exact counts (`with_phase_counts`,
`meta.phase_counts`; first chip "In pipeline" = all − closed; "Closed" sets `bucket=rejected`), the chosen stage in the URL
as `f_stage` (`useProfileFilters.phase`, sent as `phase`, also on the export). The "In pipeline / Closed" segmented control
left `ProfileToolbar` (the strip replaces it) and `ProfileSummaryStrip.tsx` (page-only counts) is DELETED. New columns
(`profileColumns.tsx`): **Stage** (`phase`, `CandidateStageBadge`), **Next interview** (round · 12-hour date & time · "in 5 h",
amber within 24 h, "no link" when the meeting link is missing), and one **`RoundCell`** column per round (`ROUND_COLUMNS`:
Technical L1 · L2 · L3/L4 · Customer L1 · L2 · HR — verdict chip in `roundResultTone`, date & time, panel, two-line feedback
with the full text on hover; "Upcoming" / "Awaiting feedback" when no verdict). Default layout: candidate · opportunity ·
stage · status · next interview · AI · ATS · the five round columns · exp · opp exp · notice · applied · TA; saved layouts get
them through the server's `announce`. Harness `src/__story/prof.tsx` (+ `prof.html`, mocked fetch). Verified: tsc green,
eslint 0 errors on the touched files, vitest profileColumns 3 + InterviewCosts 2, `vite build` green, directory rendered
light + dark with no console errors.

**29 Sep 2026 (last) — every page on one header, TA's Opportunities, candidate page, calendar, emails, employees,
reports (server half + migration 0114 in B-V2 `CLAUDE.md`; UI only unless noted):** new **`crm/components/PageHeader.tsx`**
— `PageHeader({icon, title, subtitle, eyebrow, accent, stats, actions, children})`, `HERO_ACCENTS` (brand · ocean · teal ·
violet · amber · slate · rose), `HERO_BTN` (glass) and `HERO_BTN_SOLID` (literal `#fff` / `#1d4ed8` — the dark theme remaps
`bg-white` / `brand-*`). It now tops Candidates, Opportunities (TA list), Calendar, Emails, Employees, Reports, Customers,
Projects, Project Employees, Timesheets, POs, Invoices, TDS, Holidays, Leave Applications, My Leave, Payroll, Template
Requests, Access Control, Settings, Support Tickets and Financial Reports. ⚠️ `ProjectEmployeesPage`,
`TimesheetsListPage`, `PurchaseOrdersPage` and `InvoicesPage` gained an optional `embedded` prop (default off): inside the
Projects hub they render a compact row, never a second header. Detail pages got gradient identity bands in the profile
style: candidate (`CrmCandidates.tsx` — summary chips, documents strip, icon tabs, timeline Education / Experience, skill
cloud, Linked Opportunities cards), requirement / "inside an opportunity" (`RequirementDetailPage` — six fact tiles,
`req.customer_name`, never "Customer #N"), employee, customer, project, PO and invoice (a Proforma band is amber).
**TA's Opportunities** (`RequirementsListPage`): the "Requirements" title is gone (the workspace no longer prints its own
title either), stage tabs are a pill strip in the header, rows show id chip · priority · experience · customer +
location · positions · budget · status · target date with an overdue chip. ⚠️ Functional: the **Active** tab now asks for
`SOURCING_STATUSES` (Open · Posted · In progress) on New / Active deals, sent as ONE CSV `status` (the multi-status
`Promise.all` fan-out is gone), and **`crm/lib/useRefetchOnFocus.ts`** re-reads the requirement list / detail and the
opportunity list / detail when the window regains focus (≥ 15 s apart; the detail pages re-read quietly, no spinner) so a
deal Sales closed or held shows in every open login. **Apply to Opportunity** (`ApplyToOpportunityModal`) redesigned —
hero, radio cards with "N of M open" · stage · location, match rings for candidates — and ⚠️ a recruiter-only TA
(`useHasRole("TA") && !useHasRole("Sales","Sales_Head","RMG")`, hooks unconditional) sends `sourcing=true` and sees
"Only opportunities open for sourcing are listed." **Calendar**: toolbar as a joined Prev / Today / Next, colour by who
runs the round (AI purple · technical indigo · customer sky · HR emerald — ⚠️ Tailwind `violet` is remapped to navy here,
use `purple`), a legend with counts, an Agenda panel for the picked day (clicking a day header picks it). **Emails**:
status as a segmented strip, types as one pill strip, inbox rows with avatar / relative time / status chip, card-style
reading pane with the failure reason as a red notice. **Employees**: Email folded under the name and Department under the
designation (the separate columns are gone), deployed / bench chips say "on this page". **Reports**: the tabs are a card
picker (keys, `?tab=`, Revenue gating unchanged). Harnesses: `cand`, `reqs`, `cal`, `emp`, `hub` (`src/__story/*.tsx` +
`*.html` + `*-shot.mjs` in the working copy). Verified: tsc green, eslint no new errors (four pre-existing `autoFocus`),
vitest 51 across the touched pages' tests, `vite build` green, every page rendered light / dark / 400 px without errors.

**29 Sep 2026 (night, last) — filters on every My Tasks tab (`WorkDesk.test.tsx` now 7; server half in B-V2
`CLAUDE.md`):** new `crm/pages/dashboard/taskFilters.tsx` — PURE `facetOptions(items, customer)`, `filterItems(items, f)`,
`statusOf(chip)` ("To submit · month ended 29 d ago" → "To submit", "12 days overdue" → "Overdue"), `monthLabel("2026-09")`
→ "Sep 2026", and `TaskFilterBar`: search (title · subtitle · chip · section · customer · project · month) + Customer ·
Project (scoped to the chosen customer; a foreign project is dropped) · Month (newest first) · Status · Priority (Urgent /
Needs attention / On track, from the item's tone) + "N of M" + Clear. ⚠️ A control renders only when it can narrow the
list (≥ 2 values; statuses only while ≤ 12 distinct), so every role's tab gets exactly the filters its items support —
Sales / Finance billing tabs get customer · project · month · status, candidate tabs customer · month · status, HR
tabs search · month · priority. `MyTasksPage` fetches `/api/dashboard/desk?full=true` (the Dashboard keeps the plain
call), keeps ONE filter per tab (switching back keeps it), filters BEFORE `groupBySection` (the customer headers count
what is shown), and says "Nothing matches these filters · Clear filters" instead of "All clear". `DeskItem` gains
`customer` / `month` / `project`. Controls use `CONTROL` (never `inputCls`). Harness `src/__story/tasks.tsx` (+
`tasks.html`). Verified: tsc green, eslint clean, vitest WorkDesk 7/7, `vite build` green, rendered 1400 px light /
dark and 400 px with no console errors.

**29 Sep 2026 (night, after filters) — Employee Profile tab: one page, core details first
(`crm/lib/employeeFields.test.ts` 4; server half — the hand-off date and half-day Present Days — in B-V2 `CLAUDE.md`):**
user ask with screenshots — "only the required details on the Employee page; make adding details easy, not like this" (a
7-step wizard of read-only boxes, most "—"). `EmployeeProfileWizard`, `EmployeeReviewStep`, `EmployeeDetailsSection`,
`OfficeDetailsSection` and `AttendanceRuleSection` are GONE (and the unused wizard imports / TITLES · GENDERS · BLOOD_GROUPS ·
EMPLOYMENT_TYPES copies). **`crm/lib/employeeFields.ts`** (PURE) is the ONE field list: `EMPLOYEE_CARDS` job · personal ·
attendance, each field `core` (always shown, a blank one is flagged and counted) or optional (shown once filled, else behind
"Add more details"), `mandatory` = the two the server needs (first name, official email); `visibleFields` / `hiddenFields` /
`missingCore` / `coreCount` / `seedValue` / `toApi` / `changedPayload` (a save sends ONLY the fields that changed) /
`displayValue` / `validationError`. `Employees.tsx` Profile tab = `EmployeeProfile`: `ProfileCompleteness` (ring "15 of 16
key details recorded" + one "+ <field>" chip per gap that opens the owning card on that field) → `DetailsCard` Job details |
Personal details (+ CV upload) side by side (xl) → Projects → Addresses ("Add address" when empty) → Leave Balances (leave
types with nothing accrued / taken / left are hidden behind "Show all N leave types"; the carry-forward / LOP tiles only when
non-zero) → **More details** (`MoreSection`, collapsed, mounts on open): Education · Experience (compact empty lines) ·
Attendance rule ("Follows the branch / project policy" when unset) · Separation ("Record resignation"; a RESIGNED person's
separation card moves to the top instead). `DetailsCard` reads as a two-column list with an amber "+ Add" on a blank core
field; edit = the core + filled fields as a form, optional blanks under a dashed "Add more details (N)" box; pickers come from
`useEmployeeMasters` (departments · designations · active people via `fetchAllMaster`). CTC follows the field grant (hidden
without view, disabled without edit). `SectionCard` gained `subtitle` + `editLabel`; `fmtDate` prints "7 Sept 2026". Harness
`src/__story/empd.tsx` (+ `empd.html`, `CrmRouter` on `employees/:id`, mocked fetch). Verified: tsc green, eslint clean,
vitest employeeFields 4/4, `vite build` green, rendered light / dark / 400 px (read, edit, More open) with no console errors.

**29 Sep 2026 (night) — Candidate Profiles: latest change first (server half in B-V2 `CLAUDE.md`):**
`profiles/ProfilesListPage.tsx` `DEFAULT_SORT` is now `last_activity:desc` (was AI score); the "Sorted by" line reads
"Latest change, newest first", and whenever another sort is active (a header click, or a sort saved in the user's layout)
a **Latest first** chip beside it switches back (saved to the layout like any header sort).

**29 Sep 2026 (night, GM desk) — GM billing tiles, off-desk task items, more Screening Desk filters
(`crm/components/RmgTaskBoard.test.tsx` now 4; server half in B-V2 `CLAUDE.md`):** (1) `RmgTaskBoard` knows the GM's four
billing categories (`TASK_ICON` clock · receipt · hourglass · rupee, `TASK_ACCENT` per key) and `info` categories (count in
brand blue, "None" at zero, not counted in "N pending"); they are page categories, so the list opens under the board with a
link per row (Review & approve · Raise / Reissue Proforma → the timesheet, Open Proforma / invoice → the invoice). The
Dashboard's `WorkDesk` needs no change — the server sends the tiles with `stage` / `info`. (2) **A task tile never opens onto
nothing**: `offDeskItems(category)` = a desk category's items whose candidate is not in `desk_ids` (moved on to Sales / the
customer); while that task is active they are listed in an amber "N of “…” are past the desk" box under the board, each with
its own link, and a result row gets **Mark reviewed** (`POST /api/screening-desk/results-reviewed`, then the board reloads).
The queue's empty state says so ("No one in “…” is on the desk — open them from the list above") and the task chip reads
"· N on the desk". `TaskItemList` takes an optional `extra(item)` button. Tile labels wrap to two lines (no `sm:truncate`).
(3) **`ScreeningDesk.tsx` More filters** gains AI L1 outcome · Manual L1 verdict · Expected CTC vs budget · Notice period ·
Experience min–max · Position priority · Waiting since applying (all in the URL-free `Filters`, the query, the active-filter
chips via `FILTER_WORDS` / `FILTER_NAMES`, and the "More filters (n)" count). Harness `src/__story/desk.tsx` (+ `desk.html`).
Verified: tsc green, eslint clean, vitest RmgTaskBoard 4 + WorkDesk 7, `vite build` green, desk rendered (results past the
desk, GM billing list, More filters open) with no console errors.

**29 Sep 2026 (night, very last) — Sales rung tiles (server half in B-V2 `CLAUDE.md`):** `WorkDesk.tsx` `TAB_LOOK` gains
`renewals` · `joining_soon` · `team_stuck` · `team_timesheets` · `team_collections` · `head_pace` · `head_stuck` ·
`head_lost` · `head_collections` · `head_po_renewals` (existing icons only). They are plain-link tabs (no `sales_` prefix),
so My Tasks lists them with their Open buttons and the customer / salesperson sections.

**30 Sep 2026 — pop-ups and form wizards redesigned (user ask: "Schedule manual L1, Edit applicant, Hold / Reject /
Self Withdraw, the Candidate, Customer and Opportunity forms — best of best, the same for every role";
`dialogKit.test.tsx` 2, `ScheduleManualRoundModal.test.ts` 2; server half in B-V2 `CLAUDE.md`):**
(1) **`crm/components/dialogKit.tsx`** is the ONE vocabulary for small workflow dialogs: `DialogHero` (gradient header —
icon tile · eyebrow · title · the person pill · a "where this sends them" strip), `DialogSection` (numbered step card, the
number turns into a tick), `QuickPicks`, `ReasonBox` (counter + one-tap phrases that append), `WhatHappens`,
`DialogActions` (Cancel + tone-gradient confirm, a left hint line, Ctrl/⌘+Enter), `DialogFailure` and **`DecisionDialog`**
(decide · say why · confirm; `onConfirm(note)` posts and THROWS on refusal — the message shows in the dialog and the button
re-enables, so callers no longer pass `onError`). `DIALOG_TONES` are Tailwind palette gradients (brand · indigo · emerald ·
amber · rose · fuchsia · purple · sky · slate). **`ui.Modal` gained `hero`**: a full-bleed header shown INSTEAD of the title
bar, the close button floating on it (`title` still names the dialog for screen readers). ⚠️ `bg-white` is remapped in dark
mode (`styles.css`) — on a gradient use `bg-[#fff]` / `text-[#1e293b]`. (2) **`ScheduleManualRoundModal`** is the ONE
Technical L1 / L2 booking dialog — it replaced the two copies in `Requirements.tsx` / `Profiles.tsx` and the ladder's
`BookRoundModal` (deleted; `ScheduleRoundLauncher` and `InterviewLadder` use the new one): four numbered steps (who · when with
quick times — PURE `quickTimes(now)` · meeting link with the provider named — PURE `meetingProvider` · note), "Still needed: …",
what the candidate / TA are told. The link is required everywhere now; the interviewer is required for an L1 unless the caller
says otherwise (`interviewerRequired`, the ladder's RMG / GM booking leaves it blank = themselves). (3) **Edit applicant** is
`UploadResumeModal.EditApplicantModal` (the old `EditResumeModal` in `Requirements.tsx` is gone): the Upload form's design —
section cards with ticks, source / notice chips, hike + budget chips, Current location, a "From the resume" card (education ·
skills, resume rows only), and a side panel with the profile strength, **What changed** (old → new per field) and the
position; Save stays disabled until something changed. `ctcToRupees` (exported) replaced the inline copy. `ResumeDropZone`,
`Chips` and `NOTICE_CHIPS` are exported and shared with the New Candidate wizard. (4) **Decisions on `DecisionDialog`**:
`TaDecisionModal` (Technical Screening · Hold · Release · Reject · Self Withdraw — `DIALOG` specs with quick reasons and the
consequences), `GoManualModal` / `ChooseAiL1Modal` (`InterviewRouteChoice.tsx`), and the new **`ScreeningDecisionModal`**
(Shortlist / Reject at RMG screening — replaces the Screening Desk's `DecisionModal` AND the Applied Candidates copy). All take
an optional `context` (the position, printed under the name). `RmgVerdictHero` heads the three Submit-to-Sales / Reject verdict
dialogs (Screening Desk `VerdictModal`, Applied Candidates, the profile's RMG banner), whose buttons moved into `DialogActions`
footers; `FeedbackModal` got a hero too (tone by who runs the round) and a `candidateName` prop. (5) **The wizard chrome is
ONE implementation — `crm/components/wizard/index.tsx`; `WizardChrome.tsx` is DELETED** (its section copy moved in;
`sectionHelper(key, title, "customer")` for the customer wording). `WizardTopBar` is a full-bleed gradient header (icon ·
eyebrow · "Step N of M · <step>" · title · subtitle · Save draft / Reset / autosave on glass · a completion ring · a segmented
strip, one segment per step coloured by status) — pass it as `Modal hero=` or `WizardShell topBar=`. **`WizardFrame`** is the
body both hosts share: the rail (`RailSummary` "N of M done" + bar, `WizardStepper` icon tiles — `STEP_ICONS` by step key,
`stepIcon()`; states current · done · needs attention · in progress · not started · locked, a locked step always reads
neutral) beside the scrolling content column; `WizardShell` (candidate, branch, project, PO) and the Modal-hosted Customer /
Opportunity forms all use it. `SectionHeaderBanner` takes `stepKey` (icon) and `step` ("STEP 2 OF 5"); `WizardStepCard` takes
`width` narrow · normal · wide · full; `WizardFooter` takes `nextTitle` / `prevTitle` ("Next: Professional"); new
**`WizardGroup`** (icon tile · title · hint · tick · grid of 1–4 cols) splits a long step into blocks. ⚠️ `.crm-wizard
button.min-w-0` is styled as an INPUT — never put `min-w-0` on a chrome button. `WizardField` / `FormRenderer` icons now sit
at `top-[21px]` (the 42px control), not the middle of control + helper text (they drifted under helper chips); the
Opportunity form's "fill this next" cue is an outline clear of the label, not a ring hugging it. (6) **New / Edit Candidate**:
the resume step is the shared `ResumeDropZone`; Personal = Name (4 across) · Contact · About (gender as chips) · Address
("Permanent = current"); Professional = Experience (yrs suffix, notice chips) · Where & who; Compensation = Pay (Lac suffix,
hike chip) · Resignation (a switch). Same fields, payload and rules; `CandidateFormModal` is exported (story harness).
Removed unused `fmtMoney` (CrmCandidates) and `OPPORTUNITY_TYPES` import (NewOpportunityForm) and the `autoFocus` on the email.
Harness `src/__story/forms.tsx` (+ `forms.html`, `?w=candidate|candidateEdit|customer|opp|schedule|edit|hold|reject|withdraw|
screen`). Verified: tsc green, eslint no errors on the touched files, vitest dialogKit 2 + ScheduleManualRoundModal 2 +
TaDecision 6 + OpportunitiesWorkspace 13, `vite build` green, every view rendered light / dark / 400 px with no console errors.

**30 Sep 2026 — Admin / CEO "My work today" = their own decisions only (server half in B-V2 `CLAUDE.md`):** the
server now sends Admin / CEO just `opp_approvals` + `sales_approval`; `WorkDesk.tsx` `TAB_LOOK` gains `opp_approvals`
(Handshake, blue → indigo). Its items are plain links to the opportunity (no `sales_` prefix, so `isSalesTab` leaves them
alone); the terms tab keeps its in-place Approve / Send back / Reject. No other UI change.

**30 Sep 2026 — "Direct to Sales" button on the Screening Desk (server half in B-V2 `CLAUDE.md`):**
`FastTrackToSales.DirectToSalesButton({profileId, candidateName, context, block, onDone})` — gate
`useCanApprove("profile.rmg_screening")`, a `DecisionDialog` (emerald, Rocket; reason ≥ 10 with one-tap picks; what
happens next) posting `/api/candidate-profiles/{id}/direct-to-sales`; disabled with the server's `direct_to_sales_block`
as the tooltip. Mounted in `ScreeningDesk.DetailPane` beside the existing buttons for every EXTERNAL row not in review
(an internal row keeps the fast-track button; an in-review row has its Submit to Sales verdict). `DeskRow` gains
`direct_to_sales_block`. Harness `forms.html?w=direct`.

**30 Sep 2026 — "Record feedback" on the Screening Desk records in place (UI only):** the Feedback-due list under
the task board linked to the profile. `RmgTaskBoard`: `TaskItemList` gains `primary?(it)` (replaces the row's link
when it returns a node); the `feedback` category's rows — past-the-desk AND the opened list — get an amber **Record
feedback** button that opens `InterviewRoundsModal` with the new **`feedbackFirst`** prop: once the rounds load, the
first writable round waiting for a verdict (`phaseOf === "due"`) opens straight into `FeedbackModal`, the timeline
staying behind for context; saving closes everything and reloads the board. **`InterviewLadder.FeedbackModal`**
redesigned on the dialog kit: facts strip (when · interviewer · length — `round` may now carry
`scheduled_at / raw_when / interviewer / duration_minutes`), larger result chips, `ReasonBox` with `FEEDBACK_PICKS`
one-tap phrases, `WhatHappens`, a footer hint naming what is still missing, "Update feedback" when editing. Same
endpoint. Harness `forms.html?w=feedback`. Verified: tsc green, eslint clean, vitest RmgTaskBoard 4 + WorkDesk 7,
`vite build` green, rendered 1440 / 400 px with no console errors.

**30 Sep 2026 — HR-only "Offered CTC" on the profile (`crm/lib/hrOffer.test.ts` 1; server half + migration 0116
in B-V2 `CLAUDE.md`):** user rule — at Pre-Onboarding HR records the CTC offered after the HR round, and nobody else
sees the field. Built first as its own tab (`HrOfferTab.tsx`), then **replaced the same day at the user's request by ONE
card in Overview ▸ Commercials**, right after Expected CTC (Current · Expected · **Offered CTC** · CTC Approval; the tab,
the header tile and `HrOfferTab.tsx` + its test are deleted). **`crm/lib/hrOffer.ts`**: the `HrOffer` type and
`hrOfferVisible(detail)` (PURE) = `detail.hr_offer` present — the server sends it to HR / Admin / CEO only, so every
other login never has the key and the card cannot render — AND `HR_OFFER_STAGES` (HR Discussion · HR Round ·
Pre-Onboarding · Joined). The emerald card is editable in the server's window (`editable`; `edit_block` is the hint
otherwise) and the ordinary **Save changes** button writes it through `PUT …/hr-offer` only when the figure changed
(a blank never erases it). `ReasonBox` gained `disabled` (hides its picks) in passing.

**30 Sep 2026 — Applied Candidates: the "RMG Screening" and "Source" columns are gone for every role (user
request):** the Stage + Status columns say the first; the second (`source_portal`, the portal the CV came from) is
still captured on the Upload / Edit applicant forms, just not listed. Removed from `Requirements.tsx` `ResumesTab`
(the columns, `RESUME_COLUMN_LABELS`, `TA_HIDDEN_RESUME_COLUMNS` — now only `received_date`) and from the server's
`TABLE_REGISTRY["requirement_resumes"]` (saved layouts drop them via `_clean`; `profile_stage` is announced after
`applied_by`). The `RmgScreeningBadge` stays on the requirement's Applicants tab and the row buttons still read
`rmg_screening_status`.

**30 Sep 2026 — Applied Candidates: status chips, Archive tab, waiting chip, "with <panel>" opens the interviews
pop-up (`CandidateStatusBadge.test.tsx` now 11; server half in B-V2 `CLAUDE.md`):** `ResumesTab` (`Requirements.tsx`)
— (1) the chip strip is **status-based**: All + one chip per derived status the current list holds, in the catalogue's
order (`useCandidateStatusCatalogue`), coloured by `CANDIDATE_STATUS_TONE`, each with its count from
`meta.status_counts[bucket]`; sent as `?status_key=`, URL param `status` (`usePageTab`). `CANDIDATE_STAGE_BUCKETS` /
`bucketPhase` left this file. (2) **The Stage column is gone** (`RESUME_COLUMN_LABELS`, the column, the server
registry); its `OverBudgetChip` moved into the Status cell. (3) **Applied Candidates | Archive** segmented switch above
the chips (`AppliedBucket`, URL param `sub`, `?bucket=archive` to the server): a rejected / withdrawn candidacy leaves
the live list — `pickBucket` drops a status chip the other list may not hold. (4) **`CandidateRoundStatus`** gains
`onOpen` (the round's name becomes a dotted link → `InterviewRoundsModal`, the existing timeline pop-up),
`waitingDays` / `waitingSince` (the **`WaitingChip`** — "Waiting N d" / "Today", `waitingTone`: amber ≥
`WAITING_WARN_DAYS`=3, red ≥ `WAITING_BAD_DAYS`=7; suppressed in Archive — nobody waits on a closed candidacy) and
"with <panel>" from **`ROUND_WHO_FIELDS`** (`l1_manual_interviewer` …; the AI L1 reads "with AI interviewer").
Harness `src/__story/applied.tsx` (+ `applied.html`, `catalogue.json` dumped from the server's `catalogue()`) renders the
tab with mocked rows at `?sub=archive` / `?status=<key>`. Verified: tsc green, eslint 0 errors, vitest 11 + TaDecision 6,
`vite build` green, live / archive / chip / dark / 400 px + the pop-up rendered with no console errors.

**30 Sep 2026 (later) — every status chip + Stage back, the PO picker, Sales' invoice tabs by customer / employee, the JD
as a file (`PoPicker.test.ts` 3, `groupBySection.test.ts` now 5; server half in B-V2 `CLAUDE.md`):** (1) **Applied
Candidates** (`Requirements.tsx`): the chip strip lists EVERY status of the bucket from the catalogue (`s.active` on the
live list, `s.closed` on Archive), zero counts included, and the **Stage column is back** beside Status (`profile_stage`,
`CandidateStageBadge`) — user decision reversing the morning's hide. (2) **`crm/components/PoPicker.tsx`** replaces the
`<select>` in `Timesheets.PoSelectModal`: scope pills **<Employee>'s POs** (tagged to them or billed for them before —
server `employee_match` / `tagged_to_employee` / `billed_before`) · Funding this project · All customer POs, opening on the
first non-empty (`poScopes`); search, Live / Expired / Live + expired (default all — an expired PO of the employee must
stay visible), sort (Best match = suggested → tagged → billed before → live → newest; Newest; Largest balance; Ending
soonest — `filterPos`, PURE); radio cards with the balance bar (red ≥ 90 % used), dates, Suggested / Raised for / Billed N
times / Funds this project / Expired chips; a cancelled PO is disabled; an amber notice + link to the PO page when nobody
raised one for the employee. (3) **My Tasks** (`taskFilters.tsx` / `WorkDesk.tsx`): items carry `employee`; the filter bar
gains an **Employee** select and a **By customer / By employee** switch (`TaskFilter.groupBy`, `groupKeyOf`;
`groupBySection(items, groupBy)` — an invoice with no timesheet groups under "No employee named"); `TAB_LOOK` +
`SALES_BILLING_TABS` gain `sales_proformas` (Receipt). (4) **`JdSkillsModal`**: a "JD file (PDF / Word)" drop zone beside
the JD text (`crmUpload …/attachments {kind: rmg_jd}`, ≤ 15 MB, .pdf/.doc/.docx/.txt) with the files on record (open ·
remove); the server's `extracted_text` fills an EMPTY JD box (a written one is kept), `onSaved(null)` refreshes the page;
approve mode counts an uploaded file as the JD (`jdFileOnRecord`). Harness `src/__story/po.tsx` (+ `po.html`, `?w=jd`).
Verified: tsc green, eslint 0 errors, vitest 8/8 new, `vite build` green, picker / JD dialog / Applied Candidates rendered
light + dark with no console errors; backend 176 pass on the touched suites.

**30 Sep 2026 (last) — ATS after a JD is added + manual Archive (server half in B-V2 `CLAUDE.md`):**
`ScreeningDesk.tsx`: a row with a CV and no score whose position has no JD / skills (or whose scan failed) shows an amber
strip in the detail pane's ATS section with **Add JD (Word / PDF) & skills** — the same `JdSkillsModal` as the position
header (`jdReqOf(position)` is the one mapping). `afterJdSaved` clears `attempted` + `scoreErrors`, reloads at once and again
after 6 s (the server re-scores in the background). Applied Candidates (`Requirements.tsx` `ResumesTab`): a closed row
offers RMG / GM (`isRmg`) an **Archive** button (`archivable`) and, on the Archive tab, **Restore** (`archived`) →
`POST /api/candidate-profiles/{id}/archive`; nothing is archived on its own, so the live chip strip lists EVERY status
(rejected ones included) and a closed row shows no waiting chip. `tsc --noEmit` green.

**30 Sep 2026 (latest) — Raise Proforma + Edit JD & skills redesigned on the dialog kit; the stale JD dialog copy is
gone (`TimesheetApprovals.test.tsx` re-pinned, 18; server half in B-V2 `CLAUDE.md`):** screenshot reports — the
requirement page's "Edit JD & skills" had NO file drop zone for a TA. ⚠️ Cause: `Requirements.tsx` still carried a
private `JdSkillsModal` from before the 28 Sep extraction — the shared `crm/components/JdSkillsModal.tsx` (with the
drop zone) was only reached from the Screening Desk. The copy is deleted; the page imports the shared one, and
`canEditJdSkills` admits `isTA` (the server's `JD_EDIT_ROLES` now includes TA, so the upload no longer 403s).
**`JdSkillsModal` v2** (`xl`, indigo; emerald in approve mode): `DialogHero` (position pill · status chip · the
"JD & skills → ATS scores resumes → AI L1 asks on them → TA sources" strip) → step 1 **The job description** — the
drop zone FIRST (full-width, the file's text is read into the box), the files on record as chips, then the JD text with
a character count and a "read from <file>" tag (`readFrom`, cleared on edit) and a "very short JD" warning under
`JD_THIN_CHARS`=120 → step 2 **Skills TA sources against** — one card per skill with a Mandatory ⇄ Optional toggle
chip (star), a named level select (`LEVELS` 1 Aware … 5 Expert) and remove; an empty dashed "add the first one" card →
step 3 Requirement description (optional) → step 4 Note for TA (approve only); a sticky aside — **What the ATS will
have** (JD text · JD file · skills, from PURE `jdReadiness()`) + `WhatHappens`; `DialogActions` footer whose hint names
what is still missing ("Still needed: the JD · at least one skill" blocks Approve; Save only needs a change), Ctrl/⌘+Enter.
**`PoSelectModal` v2** (`Timesheets.tsx`, now EXPORTED; `xl`, amber): `DialogHero` (employee pill with project ·
customer from the new `po-options.project_name / customer_name`, month chip, "Timesheet approved → Proforma raised →
Finance checks → Tax invoice") → the returned-by-Finance banner → step 1 **Invoice format for this customer** → step 2
**Rate this month bills at — <month>** (big figure, "In force since" chip, Edit / Add rate in the header, the inline rate
form on an amber card) → step 3 **Purchase order it draws from** (`PoPicker`, the suggested / mismatch notices, the
picked PO as a `PoStat` grid: value · used · balance · period · raised for · this project) → a sticky aside **This
invoice will be raised as** (Qty / Rate inputs, LOP + no-billing chips, the sub-total large, **PO balance now → after
this invoice** — red when it goes negative, the edited / frozen / drifted notes) + `WhatHappens`; `DialogActions` footer
(the 400-style refusal above it, hint "Pick the purchase order…" / "This PO cannot cover the invoice — ₹x short" /
"Qty / rate edited"), Ctrl/⌘+Enter (off while the rate form is open). Same endpoints and payload; the tests now pick
POs through the picker's radio cards (`pickPo`). Harness `po.html?w=raise` (+ `&ret=1`) / `?w=jd` (+ `&approve=1`).
Verified: tsc green, eslint 0 errors, vitest TimesheetApprovals 18 + dialogKit 2, `vite build` green, both dialogs
rendered light / dark / 400 px with no console errors.

**30 Sep 2026 (evening) — Feedback due by position / day, TA's Pending activities, the JD off Applied Candidates,
Shortlist-with-route buttons (`FeedbackDuePanel.test.ts` 2, `groupBySection.test.ts` now 6; server half in B-V2
`CLAUDE.md`):** four screenshot asks. (1) **`crm/components/FeedbackDuePanel.tsx`** — the Screening Desk's Feedback-due
tile no longer prints "37 of Feedback due are past the desk": `RmgTaskBoard` renders this panel for the `feedback`
category over EVERY item (on the desk or with Sales) — **By position / By day** toggle (PURE `groupFeedback`: by position
= largest group first, oldest inside; by day = newest day first), search + Round + Position selects (PURE
`filterFeedback`), a per-group "N due · oldest <when>" chip and **Record feedback** in place (`InterviewRoundsModal`
`feedbackFirst`). `ScreeningDesk.tsx`: `feedbackView = task === "feedback"` hides the desk's own search / filters and the
queue + detail grid (they return when a candidate is focused from a deep link); the task chip reads "Feedback due · N".
`TaskItem` gained the optional `section / round_kind / interviewer / overdue_hours`. (2) **TA's My Tasks**: the server's
new `ta_pending` tab ("Pending activities", `TAB_LOOK` ListTodo violet) lists every interview to schedule + every
candidate awaiting the TA's call, grouped by POSITION (`section`); `taskFilters` gains **Activity** (`activity`) and
**Round** (`round_kind`, labelled via `ROUND_KIND_LABEL`) facets on every tab that carries them; the items keep their
in-place Schedule / Technical Screening actions (`round_kind` decides). (3) **Applied Candidates**: the "JD used for
scoring" block (JD text + file) is GONE for every login — the Details tab is where the JD lives (`rmgJdPreview` /
`rmgJdFiles` removed from `ResumesTab`). (4) **Screening Desk detail pane**: "Shortlist for next round" is replaced by
**Shortlist for AI round** (`FLOW_BTN.ai`) · **Shortlist for manual L1 round** (`FLOW_BTN.manual`) · **Direct to Sales**
(`FLOW_BTN.success`) · **Reject** (`FLOW_BTN.danger`), in that order. `ScreeningDecisionModal` takes `route?: "ai" |
"manual"` (`ShortlistRoute`): the same `rmg-screening` POST, then `request-ai-l1` / `skip-ai-l1 {request_manual_l1}` on the
same click, with route-specific wording, flow strip and consequences; the desk's `decision` state is `{kind, route}` and a
routed shortlist advances the row at once (the route card / "Decide the route later" still backs a bare shortlist from
Applied Candidates). Harness `desk.html?task=feedback` / `?row=1`, `tasks.html?ta=1`. Verified: tsc green, eslint 0
errors, vitest 6 + 2 + RmgTaskBoard 4 + WorkDesk 7, `vite build` green, both desks rendered light / dark with no console
errors; backend 72 pass on the touched suites.

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
  SessionKeeper.tsx  session keep-alive; committed as of f807e80 (was untracked — clones now compile)
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

🟠 **And the reverse, found 20 Aug 2026: `crm:calendar` is offered here but does not exist on the
server.** `services/access_registry.TABS` has 21 keys and `calendar` is not one of them. Since
`access_templates._strip_removed_keys` deliberately drops registry-unknown keys so old templates stay
saveable, granting Calendar in the Users-admin modal returns **success and saves nothing** — no 400,
no warning, no log line. The 22 CRM keys here vs 21 there is the whole discrepancy. See B-V2 §10 · P6.

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
| `Requirements.tsx` | 3,513 | Requirement workflow + resume/ATS pipeline; `StatusStepper`; role-dependent tabs incl. Sales_Head Approval Queue and RMG Engineering Review Queue; slots/bookings; Applicants + Suggested Candidates. Fans out `Promise.all` over statuses because the API takes one `status`. | `useHasRole` only — **no `useCanAct` anywhere** |
| `Profiles.tsx` | 2,768 | Candidate × opportunity pipeline. Detail tabs: Overview · Interviews · Skill Evaluation · Offers · Activity Log · AI Interview. Renders **only** `detail.allowed_next_statuses`; every transition needs a ≥5-char comment. | mixed — `useCanAct("profiles","edit")` + per-field `fld()` + `useHasRole` |
| `Finance.tsx` | 2,524 | **Five routed components in one file**: POs (`:332`), PO detail (`:1183`), Invoices (`:1651`), Invoice detail (`:1981`), TDS (`:2458`). PO wizard, renewal, GST slabs, payments. | `useCanAct("pos"\|"invoices","edit", useHasRole("Finance"))` |
| `Employees.tsx` | 2,412 | HR directory, per-section edit/save with dirty tracking, education/experience subforms, leave matrix. | `useCanAct("employees")` + **field-level** `canEditField("current_ctc")` |
| `opportunity/NewOpportunityForm.tsx` | 2,359 | Schema-driven wizard. Merged "Commercials & CTC Slab" step, rate-card prefill, branch-policy prefill, attachments. **10 suppressed `exhaustive-deps`.** | `useHasRole` only |
| `Customers.tsx` | 1,966 | The customer hub. Detail tabs: Opportunities · Projects · Project Employees · POs · Invoices · Holidays · Branches · Contacts · Documents · Billing Policy — each `useCanAct(...,"view",…)`-gated, each linking into the *same* detail pages. Exports `CustomerScopedTable`, `hubMoney`. | `useCanAct("customers")` + `isReadOnly` |
| `CrmCandidates.tsx` | 1,705 | Candidate master + outreach + education/experience/skills. Strips locked fields from the payload before save (`:532`). | `useHasRole` + `useCrmAccess("candidates").locked()` |
| `Opportunities.tsx` | 1,800 | Opportunity detail (tabbed: Details from `OPPORTUNITY_SCHEMA` · Applicants · Skill Evaluation · Activity Log). Exports **`SuggestedCandidatesTab`** — also imported by Requirements, so TA and Sales share one matcher. | `useCanAct("opportunities")` + Sales_Head checks |
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
npm run test:run       # vitest — 10 files, 87 it() blocks
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

### Tests — 10 files, 87 `it()` blocks (more at runtime; several use `it.each`)

| File | Pins |
| --- | --- |
| `lib/rbac.test.ts` | `defaultLanding` = "crm" for all roles; per-role interview nav; Integrity excludes RMG; AI Logs admin-only |
| `crm/pages/opportunity/ctcSlab.test.ts` | 12 blocks / **19 at runtime** — billing bases, `max_billable_hours_month` replacing the calendar derivation, Per-Month not prorated, blank ≠ NaN, Exp Max midpoint, RFI formula, Fixed_Price period |
| `crm/pages/TimesheetApprovals.test.tsx` | **13 cases** — no row-level approve, "Review" vs "Open" labels, HR sees no decision buttons, Admin/CEO via `isSuperAdmin`, PO gate before Generate Invoice, rate editing |
| `crm/pages/opportunity/opportunityFormState.test.ts` | shared-key mirroring, `applyBranchContactDetails`, payload coercion |
| `crm/pages/opportunity/opportunitySchema.test.ts` | option lists, section order, CTC Slab present per type, conditional fields |
| `crm/pages/OpportunitiesWorkspace.test.tsx` | one sidebar entry, requirement deep links highlight it, per-role sub-tabs, RMG sees none |
| `crm/pages/ProjectEmployees.test.tsx` | 7 cases on `deriveRateSchedule` (expiry, boundaries, current vs future) |
| `crm/lib/timesheetAttendance.test.ts` | inclusive thresholds, applies only to working non-leave rows |
| `crm/lib/phone.test.ts` | India parsing, display→E.164 on save, contact autofill |
| `crm/pages/pipelineStageLabels.test.ts` | 4 literals. ⚠️ its second test is **tautological** (iterates the same map it asserts against) |

⚠️ **`vitest` does not run out of the box against a Linux mount of a Windows checkout** —
`node_modules` was installed on Windows, so the two native binaries Vite needs are the wrong platform.
It fails first on `@rollup/rollup-linux-x64-gnu`, then on `@esbuild/linux-x64`. Both can be supplied
without touching the checkout (verified 20 Aug 2026):

```bash
mkdir -p /tmp/rl && cd /tmp/rl
npm i @rollup/rollup-linux-x64-gnu @esbuild/linux-x64@0.21.5   # match esbuild's version exactly
cd <repo>/frontend/admin-dashboard
NODE_PATH=/tmp/rl/node_modules \
ESBUILD_BINARY_PATH=/tmp/rl/node_modules/@esbuild/linux-x64/bin/esbuild \
  node node_modules/vitest/vitest.mjs run --pool=forks
```

That gets the suite running — `TimesheetApprovals` (13) and `ctcSlab` (19) both pass — but the
remaining files crawl, because every module resolution is a round trip over the mounted Windows
filesystem. **For a real run, do `npm ci` on the target platform.** `tsc --noEmit` runs fine either
way over the mount and is **currently green (verified 20 Aug 2026)**.

---

## 8. Parity twins — the client engines that mirror the server

**Nothing in either repo cross-checks a client engine against its server counterpart.** Both sides have
tests that pass against their own assumptions. Measured divergences as of 18 Aug 2026 — **the two
engine-level ones (the hours cap and the appraisal-cycle rounding) were re-confirmed unfixed on
20 Aug 2026; the arithmetic scenarios were not re-run**:

| Twin | State |
| --- | --- |
| `ctcSlab.ts::calculateBillingBases` ↔ `services/opportunity_ctc.py` | ✅ **agree exactly** on all four user-confirmed scenarios: nothing billable 227 (+12 paid = 239); holidays+weekoff billable with 24 leave and 12 paid = 353; everything billable = 365. Same `min(paid_leaves, leave_deducted)` cap. |
| `ctcSlab.ts` appraisal-cycles power rule | ✅ agree on the pinned figures (5→7 = 130009.09, 6→7 = 143010, 7→10 = 118190.08). ⚠️ **Diverge on fractional bands**: backend `int(target − exp_min) − 1`, frontend `Math.round(...) − 1`. exp_min 5 → target 7.5 gives 1 cycle server-side, 2 client-side (₹90,909 vs ₹82,645). Legacy non-digit `appraisal_cycle` strings ("2.6") also diverge. |
| **`ctcSlab.ts:85-91` branch hours cap** | 🔴 **Client-only.** `max_billable_hours_month × 12` exists in `ctcSlab.ts` and has **no server equivalent**; the server overwrites the slab on both create and update. With cap 180 the form shows 2,160 h / ₹2.16 M and the DB stores 1,816 h / ₹1.816 M — the stored value is **≈16 % below what the user was shown** (equivalently, the form is 19 % above the DB). The field is not even in the schema, so it is stripped from the payload. Pinned client-side by `ctcSlab.test.ts:33-60`; the backend suite never mentions it. |
| `Timesheets.tsx::computeBillables` ↔ `services/timesheets.py` | ✅ precedence ladder, comp-off gating and `day_type` authority all match. ⚠️ **Day figure differs**: server returns `ONE` for an unworked billable week-off/holiday; client uses `hours / 8` (1.13 at `min_hours_full_day = 9`). ⚠️ **Attendance derivation differs**: `crm/lib/timesheetAttendance.ts:10-14` hardcodes 8/4-hour thresholds; the server uses policy values. ⚠️ Hour-cap ordering differs (server caps hours but derives the day fraction from uncapped hours). The client also does **not** implement the Harman "weekend work covers LOP" rule or comp-off-adds-to-Monthly — those are invoice-preview-only. |
| `opportunitySchema.ts` ↔ `services/opportunity_form_schema.py` | ⚠️ **Four drifts.** `project_scope` is server-allowed for Work_Package / Fixed_Price / Retainer but **has no UI field** — those types submit no type-specific data. `project_duration_months` has no field, so Fixed_Price annualisation never gets a duration. `sales_stage` is computed by the form but has no schema field, so `stripHiddenFields` drops it and **it is never persisted** (it lives only in the localStorage draft). `max_billable_hours_month` is prefilled and used in the maths but stripped before submit. `test_opportunity_form_schema.py` only introspects the server's own key sets and cannot catch any of this. |
| GST — **three implementations** | 🔴 `crm/taxInvoice/math.ts:100 computeTotals` **hardcodes 18 %** and ignores the customer's GST slab entirely (and `types.ts:67` hardcodes `DEFAULT_INVOICE_NO = "KRSW26-27-65-VS"`). `crm/components/invoice/utils.ts:99 gstSplit` splits a **server-supplied** `taxAmount` and short-circuits to `opts.stored`. The backend `karnex_gst_tax_and_grand` is the third. Two of the three can disagree with the invoice that was actually generated. |
| Status labels | ✅ no dead labels — all 60 colour entries, 11 `STATUS_LABEL_OVERRIDES`, 46 `STATUS_HELP` keys and 8 `PIPELINE_STAGE_LABELS` map to values the backend still emits. ⚠️ The fallback (`ui.tsx:32`) is visually identical to the deliberate GREY branch, so an unmapped status looks intentional. ⚠️ `Shortlisted → "Customer Shortlisted"` also catches `AtsStatus.SHORTLISTED` — an internally-shortlisted resume is mislabelled. Uncoloured backend values worth adding: `EmailStatus.SKIPPED/SENT`, `AttendanceStatus.WEEK_OFF`, `DayType.WORKING/WEEK_OFF`, `TemplateRequestStatus.*`, the live `POType` values, `Priority.HIGH`, all four `OppType`. |

---

## 9. Bugs, gaps and hygiene

> **Re-verified 20 Aug 2026.** Everything below is still live except **#20 (SessionKeeper) and #22
> (`frontend/admin/`), both now closed**. Spot-checked and confirmed unchanged at their stated file:line: the 8 fail-open RBAC
> paths in §4, `defaultLanding` still ignoring its argument, `HUB_COVERED` still 4 entries,
> `rbacActive = roles.length > 0`, and the 3 still-tracked `dist/` files. `/apply` and `/book` are
> **still missing from both prefix lists** (§7 · P0) — the highest-severity item on this side.

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
11. **36 `eslint-disable react-hooks/exhaustive-deps`**, 10 in `NewOpportunityForm.tsx` alone. That
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

20. ✅ **CLOSED (commit `f807e80`).** `src/components/SessionKeeper.tsx` was untracked while imported and
    mounted by `App.tsx`, so a fresh clone would not compile. It is now committed and `tsc --noEmit`
    is green from the committed tree.
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

Re-verified 20 Aug 2026: **#1, #3, #4 and #5 are all still open exactly as described. #2 is fixed.**

| # | Fix |
| --- | --- |
| 1 | **`showScreenRef("result")` shows nothing.** `createShowScreen` (`hr.js:576`) maps only `{hr, candidate}`, so `candidate.js:1906` blanks the screen after an HR-run interview and orphans `#screenResult` and its five download buttons. One line: add `result: "screenResult"`. |
| 2 | ✅ **FIXED (uncommitted, 20 Aug 2026).** *Was:* the scheduled-wait retry was dead — `app.js:810` passed `() => { proceedWithInviteLogin(); }` with no `return`, so `await onDone()` resolved immediately and the documented 5-attempt retry was unreachable; a failure at the scheduled moment froze the candidate on "Preparing your interview session…". Now `() => proceedWithInviteLogin()`. Still uncommitted — **do not lose this in a checkout**. |
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

- The four mega-pages (`Timesheets` 3,854 · `Requirements` 3,513 · `Profiles` 2,768 · `Finance` 2,524).
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
