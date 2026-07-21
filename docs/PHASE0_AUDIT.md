# Phase 0 — Audit & Gap Analysis

**Project:** Karnex CRM + AI Interview Platform
**Date:** 2026-07-09
**Scope of this program:** production-hardening + world-class motion UI/UX for the
CRM/admin React app and login. The **live candidate interview flow is explicitly
out of scope** (working, security/timing-sensitive) per direction.

> ⚠️ **Environment note (important).** This audit and the code changes were made
> through a sandboxed workspace whose file mount serves **truncated copies of any
> file after it is edited** (it caps each edited file at its original byte length),
> and it has **no PostgreSQL** and cannot run the backend. As a result the
> build / typecheck / lint / test loop **cannot be executed from here** — those must
> be run on a real dev machine. Every "status" below distinguishes *verified by
> reading the real files* from *must be run locally*.

---

## 1. Architecture map

### Backend — `AI-Interview-Model-B-V2/` (FastAPI monolith)

| Area | Files | Notes |
|---|---|---|
| Interview platform | `backend/main.py` (~7,400 lines), `auth_db.py`, `ai.py` | Auth (JWT), HR portal, candidate interview, ATS scoring, integrity logs, reports. Raw-SQL + SQLite/Postgres. |
| CRM engine | `crm_db.py`, `crm_deps.py` | Postgres-only (SQLAlchemy 2.0). `crm_deps` = JWT auth + `role_required` RBAC (7 roles) + new `enforce_roles`. |
| CRM data model | `models/` (46 tables) | opportunities, requirements, customers, candidates, profiles, finance, projects, hr, rbac, ai_links, masters. |
| CRM API | `routers/crm/` (21 routers) | `/api/*`, registered by `register_crm_routers(app)`. |
| CRM logic | `services/` | workflows, ATS, tax (GST/TDS), ai_interview_bridge, notify. |
| Migrations | `alembic/versions/` | `0001` schema, `0002` ai links, **`0003` opportunity approval (new)**, **`0004` resume applicant_experience (new)**. |

### Frontend — `AI-Interview-Model-F-V2/`

| Area | Files | Notes |
|---|---|---|
| Interview + login (vanilla) | `frontend/index.html` (235 KB), `frontend/js/**` | Interview engine, HR portal, auth, proctoring. Out of scope for redesign. |
| Admin dashboard (React) | `frontend/admin-dashboard/src/**` — **84 TS/TSX files, ~27.5k LOC** | Vite + React 18 + TS (strict) + Tailwind 3 + Framer Motion 12. Hosts the AI Interview Platform pages **and** the nested CRM (`src/crm/**`). Built to `frontend/admin/`. |

### Unified shell & routing (post-RBAC work)

- `src/App.tsx` — top-level shell; fetches CRM roles via `/api/me`, gates the
  Interview Platform nav, routes each role to its landing, mobile nav drawer.
- `src/lib/rbac.ts` — **single source of truth** for the role→module matrix.
- `src/crm/CrmApp.tsx` — CRM shell (role-based sidebar + mobile nav + notifications).
- `src/crm/router.tsx` / `routes.ts` — hash/path mini-router for CRM pages.
- Auth session in `localStorage` (`authToken`/`authUser`), shared with the vanilla app.

---

## 2. Dependencies

### Frontend (`admin-dashboard/package.json`)

Runtime: `react@18.3`, `react-dom@18.3`, `framer-motion@12.38`, `lucide-react@0.542`,
`recharts@2.15`, `html2canvas@1.4`, `jspdf@2.5`.
Dev: `vite@5.4`, `typescript@5.6`, `tailwindcss@3.4`, `@vitejs/plugin-react@4.3`,
`postcss@8.4`, `autoprefixer@10.4`. **TS `strict: true`.**

Build config (`vite.config.ts`) is solid: `base:/admin/`, manual vendor chunks
(react/icons/motion/charts/pdf), `esbuild.drop` console+debugger in prod,
`chunkSizeWarningLimit: 400`, API proxy for dev.

### Backend (`requirements.txt`)

`fastapi`, `uvicorn`, `pydantic`, `SQLAlchemy>=2.0`, `alembic>=1.13`,
`psycopg2-binary`, `PyJWT`, `openai`, `pypdf`, `python-docx`, `reportlab`,
`supabase`, `pytest>=8`.

### Known version/health notes

- No pinned versions in `requirements.txt` (floating) — reproducibility risk; pin for prod.
- No `react-router` — CRM uses a hand-rolled mini-router (fine, but no code-split per route beyond `React.lazy`, which *is* used).
- No dependency with a known critical CVE spotted by inspection; run `npm audit` / `pip-audit` on your machine to confirm.

---

## 3. Test & tooling state

| Check | State |
|---|---|
| Backend unit tests | ✅ **38 pytest files** in `backend/tests/` (interview engine: scoring, idempotency, boundaries, adaptive Q). |
| Backend E2E | ✅ `scripts/verify_karnex_crm.py` (~60 checks, all 7 roles + full workflows) + `smoke_test.py` + `final_gate_verify.py`. Requires running server + Postgres. |
| Frontend unit/component | ❌ **None.** No vitest/jest/testing-library, no config. |
| Frontend e2e | ❌ **None.** No Playwright/Cypress. |
| Frontend lint | ❌ **No ESLint config.** Only `tsc --strict` acts as the static gate. |
| Typecheck | `tsc` via `vite build` (strict). Not runnable in this sandbox. |

---

## 4. Gap analysis (what's broken / missing / half-built)

### Blockers to a clean "green gate"
1. **No frontend test harness** (Phase 4). Needs vitest + testing-library (unit/component) and a Playwright scaffold (e2e). *Biggest gap.*
2. **No frontend ESLint** (Phase 3/6 "lint clean"). Add ESLint + `eslint-plugin-jsx-a11y` + `eslint-plugin-react-hooks`.
3. **Pending DB migrations**: `alembic upgrade head` must be run to apply `0003` (opportunity approval) and `0004` (apply experience) before those features work.
4. **Build not verified in-sandbox** (mount limitation). Run `npm run build` locally to confirm the RBAC/approval/apply changes compile clean.

### Product/feature gaps (from earlier phases in this engagement — already addressed, pending local verification)
- RBAC gating (frontend + backend), role-based landing — **implemented**.
- Opportunity Sales-Head approval + **bridge** to Requirements (→RMG→TA) — **implemented**.
- Public **apply form + link** (name/email/phone/experience/resume) — **implemented**.
- RMG no longer sees the Opportunities tab — **implemented**.

### Motion/UX gaps (Phase 1 target)
- Motion primitives exist but are **not fully centralized**: `src/lib/motionPresets.ts`, `src/crm/components/motion3d.tsx`, plus ad-hoc `framer-motion` usage across pages. Durations/easings/springs are partly scattered.
- Design **color/spacing tokens** were centralized (`--kx-*` in `styles.css`) during the RBAC work; **motion tokens should be unified the same way**.
- `prefers-reduced-motion` is respected in some components (`useReducedMotion`) but **not audited app-wide**.
- No **skeleton loaders** in most places (spinners/"Loading…" used); mission asks for skeletons.
- Accessibility (focus-visible rings, ARIA on custom controls, contrast, keyboard nav for menus/modals) **not yet audited**.

### Code-quality watch-list (to verify in Phase 3)
- Large `main.py` (295 KB) — many endpoints; RBAC guards added mid-file. Hard to reason about; candidate for later modularization (not required for this program).
- `localStorage` auth token access is guarded with try/catch (good). Verify no unguarded `JSON.parse`.
- Confirm all `framer-motion` `layoutId` uses are unique per mounted tree (duplicate active-pill IDs can cause animation glitches).
- Confirm `useEffect` fetch flows cancel on unmount (App.tsx uses a `cancelled` flag; audit others).

---

## 5. Recommended sequence

1. **Phase 0** (this doc, `TASKS.md`, `CHANGELOG.md`) — ✅ delivered.
2. **Test + build harness** — add vitest/testing-library + ESLint + Playwright scaffold + `test`/`lint`/`typecheck` npm scripts, plus starter tests for `rbac.ts` and the approval logic. Enables *you* to run the green gate.
3. **Motion/UX system** — unify motion tokens, add reduced-motion fallbacks, skeletons, route/stagger/in-view motion on CRM + admin + login.
4. **Code-quality error hunt** — read-review pass; fix bugs/types; wire ESLint clean.
5. **Local green gate** — you run `npm run build`, `tsc`, `eslint`, `vitest`, Playwright, `alembic upgrade head`, backend `pytest` + `verify_karnex_crm.py`.

See `TASKS.md` for the live checklist.
