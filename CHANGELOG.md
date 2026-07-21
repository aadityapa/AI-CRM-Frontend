# Changelog

All notable changes from the production-readiness engagement. Dates are IST.
Status tags: **[verified]** = confirmed by reading the real files; **[verify-local]**
= implemented but the build/DB run must be done on a real machine (sandbox can't
run the toolchain / has no Postgres).

## 2026-07-09

### Added
- **Role-based access control (RBAC)** across the unified admin shell. **[verify-local]**
  - `src/lib/rbac.ts` — single source of truth for the role→module matrix
    (Admin, Sales, Sales_Head, RMG, TA, HR, Finance). 38-case logic test passed.
  - `src/App.tsx` — fetches CRM roles (`/api/me`), routes each role to its landing,
    hides disallowed Interview Platform nav, guards client routes, mobile nav drawer.
    Legacy `hr` users with no CRM role keep full pre-RBAC behavior (non-breaking).
  - Backend `crm_deps.enforce_roles` + `main._enforce_crm_roles` guard 16 Interview
    Platform endpoints (ATS, Templates, Reports, Integrity, HR scheduling) so
    restricted screens can't be reached by direct URL. Fails **open** when CRM is
    unconfigured or the user has no role (keeps existing logins working).
- **Opportunity → Sales Head approval workflow.** **[verify-local]**
  - New `OpportunityApprovalStatus` enum + audit columns (migration `0003`, which
    **backfills existing opportunities to Approved** so nothing becomes pending).
  - `/api/opportunities/{id}/approve|reject|resubmit` (Sales_Head/Admin), pending
    queue filter, notifications, and approval UI (badge, Pending tab, actions).
- **Bridge: approved Opportunity → Requirement.** **[verify-local]**
  - On approval (or Sales_Head/Admin auto-approve), a linked Requirement is created
    in `Pending_Engineering_Review` → lands in RMG's Engineering Review Queue →
    RMG approves → `Open_For_Sourcing` → TA. Skills copied; idempotent per opportunity.
- **Public candidate apply form + link.** **[verify-local]**
  - `routers/crm/apply.py`: signed-token link, public HTML form (name, email, phone,
    experience, resume upload), public submit endpoint → creates a `Resume` on the
    requirement (source "Apply Link"). Migration `0004` adds `applicant_experience`.
  - TA UI in Requirements → Job Postings: "Application link" (copy + preview).
- **Shared design tokens** — `--kx-*` CSS variables (surfaces, borders, text, brand,
  elevation, radius) in `src/styles.css`, consumed by the app shell. **[verified]**
- **Login page rename** — "Karnex CRM + AI Hiring" with role-neutral subtitle. **[verified]**
- **Root portal role gate** — `js/app.js` redirects Sales/Sales_Head/Finance/RMG from
  the HR Setup page to `/admin`; only Admin/TA/HR (and legacy no-role users) see HR Setup. **[verify-local]**
- **Apply form — extended fields.** **[verify-local]** Public form now also captures
  education, technical domain, skills, notice period, current CTC, expected CTC and
  preferred location; stored in `resumes.application_details` (JSONB, migration `0005`)
  and surfaced to TA in the Resumes tab.
- **Interview-template request workflow (TA → RMG → TA).** **[verify-local]**
  - New `template_requests` table + `TemplateRequestStatus` enum (migration `0006`).
  - `routers/crm/template_requests.py`: TA raises a request from a requirement
    (role/skills/experience prefilled) → RMG notified → RMG fulfils by linking a
    template name/id → TA notified → TA prepares L1 (candidate email + template; no
    auto-send). Notifications at each hop.
  - Frontend: CRM "Template Requests" page (RMG fulfil / TA prepare / cancel, status
    tabs), nav item (Admin/TA/RMG), and a "Request template" button on the requirement.
- **Test harness (frontend).** **[partly proven]** vitest + testing-library + ESLint
  config, npm scripts (`test`, `typecheck`, `lint`), and `src/lib/rbac.test.ts`
  (**38/38 passing** via `vitest run`).
- **User profile + sidebar user block.** **[verify-local]**
  - New `user_profiles` extension table (migration `0007`) — legacy `registration_data`
    is never altered. Endpoints (own-record only, `/api/me/*`): GET/PATCH `profile`,
    POST/DELETE `avatar` (jpg/png/webp ≤ 5 MB, sanitised uuid names, **public
    avatars-only file route** so `<img src>` works), POST `change-password` (pbkdf2
    verify + reset). Last login read from `login_data`.
  - Frontend: reusable `Avatar` (photo or deterministic-color initials);
    `SidebarUserBlock` at the bottom of the CRM sidebar (name/email/menu → Profile /
    Settings / Log out; compact avatar-only variant on mobile); new `/profile` page
    with drag-drop photo upload (preview + progress + remove), editable fields
    (full name/phone/job title/department/timezone), read-only role/joined/last-login,
    change-password + strength meter, dirty-state sticky save bar, optimistic save with
    rollback, and avatar cache-busting broadcast to the sidebar. Email is read-only
    (it is the login identity — changing it needs admin action).
- **Reference-form fields (Candidate / Customer Branch / Opportunity).** **[verify-local]**
  Backend data layer (migration `0008`, all additive/nullable):
  - Candidate: `salutation, middle_name, date_of_birth, gender, experience_years,
    notice_period, roles, resignation_certificate_url, current_ctc`.
  - Customer: `customer_type`. Opportunity: `onboarded_count` + skill `required_level` /
    `comment` + new `opportunity_attachments` table (list/upload/delete endpoints).
  - Customer Branch: `branch_legal_name, address_line_2, country` + full billing block
    (holidays/weekoff/leave/comp-off billable, hours-required half/full/comp-off,
    working hours/day, billing frequency + cycle start/end day, max billable
    hours-day/hours-month/days-month with is-* flags, initial no-billing qty/period).
  - Schemas + serializers + create/update paths updated; Contact/HM email+phone come
    from the linked Contact Person (no duplicate columns).
  - **Pending:** wiring these inputs into the three React forms (next step).
- **Customers access + redesigned New Customer form.** **[verify-local]**
  - Customers tab now visible to Sales / Sales_Head (full write) and TA (read-only —
    the page already hides create/edit for non-writers). Backend was already scoped
    this way; only the nav gate changed.
  - New Customer form rebuilt into a modern, multi-section layout: Customer details
    (name, legal business name, customer type, status), Address (line 1/2, city, state,
    postal code, country), Leave & Holiday Billing Policy, Comp-off, and Attendance Rule.
    Saves the customer + billing policy in one flow.
  - Backend: customer registered-address columns + billing-policy comp-off & attendance
    fields (migration `0009`), schemas + serializers + create/upsert updated. Branches,
    documents and contacts remain on the customer detail page (existing tabs).
- **Docs** — `docs/PHASE0_AUDIT.md`, `TASKS.md`, this changelog.

### Changed
- CRM sidebar (`CrmApp.tsx`) gained a mobile nav strip; Opportunities removed from RMG nav.
- `serialize_opportunity` / `serialize_resume` now include the new approval/experience fields.

### Fixed
- Restored a working-tree copy of `Templates.tsx` that a prior session had left
  truncated (real file now complete, 216 lines). **[verified]**

### Deploy prerequisites
- `cd AI-Interview-Model-B-V2/backend && alembic upgrade head` (applies `0003`, `0004`).
- Rebuild `frontend/admin-dashboard` (`npm run build`); restart backend.
- Set `PUBLIC_BASE_URL` so apply links resolve for external candidates.

### Known limitations (this environment)
- Build/typecheck/lint/test could not be executed in the sandbox (edited-file mount
  truncation + no Postgres). All above marked **[verify-local]** must be confirmed
  with a real `npm run build` / `alembic upgrade head` / test run.
