# TASKS — Production-readiness program

Legend: `[x]` done & verified by reading real files · `[~]` implemented, **must be
verified by a local build/test run** (sandbox can't run the toolchain) · `[ ]` not started.

Interview candidate flow is **out of scope** for the motion redesign.

## Phase 0 — Audit
- [x] Map architecture (backend monolith + CRM; vanilla + React frontend) → `docs/PHASE0_AUDIT.md`
- [x] List dependencies + versions + health notes
- [x] Record test/lint/build tooling state (backend pytest ✅; frontend tests/lint ❌)
- [x] Written gap analysis
- [x] Create `TASKS.md` + `CHANGELOG.md`
- [~] Run install/typecheck/lint/build/test and record errors → **blocked in sandbox; run locally**

## Phase 1 — Motion UI/UX (CRM + admin + login)
- [ ] Centralize motion tokens (durations, easings, springs) in one module
- [ ] Reduced-motion fallbacks audited app-wide (`prefers-reduced-motion`)
- [ ] Route transitions + shared-element continuity where sensible
- [ ] Micro-interactions on interactive elements (hover/press/focus/toggle/loading/success/error)
- [ ] Staggered list/card entrances
- [ ] Skeleton loaders replace spinners on data screens
- [ ] Scroll-linked / in-view reveals (performant: transform+opacity only)
- [ ] 60fps pass (no layout thrash; GPU-friendly props)

## Phase 2 — Feature completion (from this engagement)
- [~] RBAC: role-based landing + nav hiding + backend enforcement
- [~] Opportunity Sales-Head approval workflow
- [~] Bridge: approved opportunity → Requirement → RMG → TA
- [~] Public apply form + link (name/email/phone/experience/resume)
- [~] RMG no longer sees Opportunities tab
- [ ] Edge/empty/error/loading/offline states audited on all CRM screens
- [ ] Input validation + graceful error surfacing everywhere

## Phase 3 — Code quality & error hunt
- [x] ESLint config added (`.eslintrc.cjs`) — run `npm run lint` locally to reach "clean"
- [ ] Read-review pass: unhandled promises, null access, races, dead code, types
- [ ] Zero TS errors (verify locally)
- [ ] Zero runtime console errors (verify locally in browser)

## Phase 4 — Testing
- [x] vitest + testing-library configured (`vitest.config.ts`, `src/test/setup.ts`, npm scripts)
- [x] Unit tests for logic — `src/lib/rbac.test.ts` (**38/38 passing**, proven via `vitest run`)
- [ ] More unit tests (approval helpers, filter utils, score utils)
- [ ] Component tests for key UI states
- [ ] Playwright e2e scaffold + critical journeys (login→landing per role, approval, apply)
- [ ] Full suite green (locally, after `npm install`)

## Phase 5 — Performance & hardening
- [ ] Bundle/code-split review (manualChunks already present)
- [ ] Lighthouse-style pass (perf/a11y/best-practices/SEO)
- [ ] Secrets/env audit (no keys in code)

## Phase 6 — Final gate (run locally)
- [ ] `npm run build` — zero errors/warnings
- [ ] `tsc` clean · [ ] ESLint clean · [ ] tests green
- [ ] No runtime console errors on any screen
- [ ] Motion works + respects reduced-motion
- [ ] Responsive mobile/tablet/desktop
- [ ] Accessibility checks pass
- [ ] `alembic upgrade head` applied (0003, 0004); backend `pytest` + `verify_karnex_crm.py` green

## Deploy prerequisites
- [ ] `alembic upgrade head` (applies opportunity approval + apply experience)
- [ ] Rebuild frontend (`npm run build` in `frontend/admin-dashboard`)
- [ ] `PUBLIC_BASE_URL` set so apply links resolve for external candidates
