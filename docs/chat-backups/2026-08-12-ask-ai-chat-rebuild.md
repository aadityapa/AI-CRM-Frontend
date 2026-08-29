# Cowork session backup — Ask AI (AI+ CRM chat) rebuild

- **Date:** 12 August 2026
- **User:** KARAN (karan.singh@karnex.in)
- **Repos in scope:** `F:\AI-Interview-Model-F-V2` (frontend), `F:\AI-Interview-Model-B-V2` (backend)
- **Branch:** `wip/profiles-users-admin`

---

## 1. Opening request

> **KARAN:** I have AI+ CRM chat is there but now its not visiable now

### Investigation

Located the feature — it is the **Ask AI** assistant, not a separate CRM chat:

| Piece | Path |
| --- | --- |
| Chat panel | `frontend/admin-dashboard/src/components/ask-ai/AskAiPanel.tsx` |
| API helpers | `frontend/admin-dashboard/src/components/ask-ai/askAiApi.ts` |
| Markdown renderer | `frontend/admin-dashboard/src/components/ask-ai/markdownLite.tsx` |
| Trigger button | `frontend/admin-dashboard/src/components/platform-nav/PlatformTopBar.tsx` (~line 292) |
| Mounted at | `PlatformTopBar.tsx` line 382 — `<AskAiPanel open={askAiOpen} … />` |
| Backend routes | `backend/routers/crm/ai_assist.py` — `POST /api/ai/assist`, `GET /api/ai/help-context` |
| Help content loader | `backend/ai_help/loader.py` |

### Findings

1. The Ask AI button is rendered **unconditionally** in the platform top bar — it is not
   role-gated or feature-flagged, and it appears on every view including CRM
   (`App.tsx` renders `CrmApp` beneath `PlatformTopBar`).
2. The **"Ask AI" text label** is `hidden 2xl:inline` — below 1536px viewport width only the
   gradient sparkle icon shows. This was the most likely reason it "looked missing".
3. The code was present in source **and** in the built `dist` bundle
   (`dist/assets/index-CmlDdr2v.js` contains `Ask AI`, `karnex.askAi.chat.v1`, `api/ai/assist`),
   so nothing had been deleted by a commit.
4. Keyboard shortcut: `⌘/` or `Ctrl+/`.

### Decision

> **KARAN (clarification):** "full co work chat" → **Rebuild as full Cowork-style chat**, code only, no browser session.

The existing slide-over was judged too small/limited, so the work became a rebuild rather than a bug fix.

---

## 2. Work delivered

### New file — `src/components/ask-ai/askAiStore.ts`

Local conversation store backing the chat:

- Multi-thread persistence in **localStorage** (`karnex.askAi.threads.v2`)
- Caps: 30 threads, 80 turns per thread
- Active thread id (`karnex.askAi.activeThread.v2`) and panel mode (`karnex.askAi.mode.v2`) persisted
- One-time migration from the legacy single-session key `karnex.askAi.chat.v1` (sessionStorage)
- Helpers: `newThread`, `loadThreads`, `saveThreads`, `deriveTitle`, `relativeDayLabel`
- `relativeDayLabel` buckets history into Today / Yesterday / Previous 7 days / Previous 30 days / Older
- All storage access wrapped in try/catch so private mode or quota errors degrade to in-memory only

### Rewritten — `src/components/ask-ai/AskAiPanel.tsx`

Two layouts sharing one thread model:

- **dock** — 440px right-hand rail, page stays usable behind it (default)
- **full** — full-screen workspace with conversation-history sidebar + centred `max-w-3xl` reading column

Chat features added:

- Full-screen toggle in the header (`Maximize2` / `Minimize2`), mode remembered across sessions
- Conversation history sidebar with per-thread delete, collapsible via `PanelLeftClose` / `PanelLeftOpen`
- New chat button in both header and sidebar
- Copy reply and Retry (regenerate last answer) on hover over assistant messages
- Auto-growing composer, max 200px — Enter to send, Shift+Enter for newline
- User messages as right-aligned bubbles; assistant messages full-width with sparkle avatar
- Suggested prompts rendered as cards in the empty state (2-col grid in full screen)
- Thread auto-titled from the first user message

Behaviour fixes:

- Body scroll lock while full screen is open
- Focus trap extended to cover full-screen mode (previously mobile only)
- Clicking "Go to <page>" now drops back to dock mode so the destination page is actually visible
- Backdrop shown on mobile always, on desktop only in full-screen mode
- z-index raised to `z-[240]` in full screen (`z-[220]` in dock)

### Unchanged

- Props remain `{ open, onClose }` — `PlatformTopBar` and the `⌘/` shortcut needed no edits
- `askAiApi.ts` and `markdownLite.tsx` untouched
- Backend untouched — still read-only `/api/ai/assist` with `enable_tools: false`

---

## 3. Verification

- `npx tsc --noEmit -p tsconfig.json` → **clean, no errors**
- `npx vite build` → **could not run in the Linux sandbox**: `node_modules` holds the Windows
  rollup native binary (`MODULE_NOT_FOUND` on `rollup/dist/native.js`)

### Outstanding action for KARAN

```bash
cd F:\AI-Interview-Model-F-V2\frontend\admin-dashboard
npm run build
```

Then confirm in the browser: click the gradient sparkle button in the top bar (or press `Ctrl+/`),
and use the maximise icon in the panel header to enter full-screen chat.

---

## 4. Notes / possible follow-ups

- If the sparkle button still reads as invisible on your screen, the `hidden 2xl:inline` rule on the
  "Ask AI" label (PlatformTopBar ~line 328) is the thing to relax — e.g. change to `lg:inline`.
- The backend assist endpoint is deliberately read-only (`enable_tools: false`, `confirm_actions: true`).
  Enabling tools would require a separate review of `backend/routers/crm/ai_assist.py`.
- `backend/tests/test_ai_assist.py` covers the assist and help-context endpoints; frontend has no
  test for the panel yet.
