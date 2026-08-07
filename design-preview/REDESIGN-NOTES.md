# Candidate Profiles redesign — before / after

Directory page shipped. Profile detail header is the remaining piece.

---

## What changed, and why

### 1 · The score is now the primary signal

**Before** — `ai_interview` was one of sixteen equal-weight columns, rendered as
a small badge. The number that answers "is this a yes?" had the same visual
weight as a phone number.

**After** — a `ScoreIndicator`: ring + numeral + word, and the table arrives
sorted by it. Three non-colour channels carry the value, so it survives
greyscale and colour blindness.

That last point is measured, not assumed. My first palette claimed to be
CVD-safe; simulating protanopia showed teal and amber collapsing to a luminance
gap of 0.004. I then found you **cannot** have four hues that are both ≥3:1 on a
near-white surface and separable under protanopia — clearing 3:1 compresses the
range that separation needs. So the design changed rather than the claim: the
ring's **arc length** carries the value, backed by the numeral and the word.
Dark mode has the headroom, so its ring set *is* genuinely separable (gap 0.069).

### 2 · Sorting went from five interactions to one

**Before** — no column had `sortable` set. Sorting meant: open the customiser
modal → add a sort rule → pick a field → pick a direction → save.

**After** — click a header. The existing multi-level sort and the customiser are
untouched for anyone who wants to stack four keys.

**This needed a backend change to be true.** `ai_interview` was not in the
server's `_SORTABLE` map, so a score sort would have been *silently dropped* —
the table would have claimed an order it did not have. The score lives on
`ai_interview_links`, one row per session, so it is now a correlated scalar
subquery picking the latest completed session, matching how the list serialiser
already chooses which session to display.

### 3 · Sixteen default columns became nine

Candidate · Opportunity · AI score · Status · Round · Experience · Notice ·
Applied · TA owner.

The other seventeen are one click away and every one still exists. The point was
never fewer columns — it was a scan path. Sixteen columns of identical weight
means the eye has nowhere to land and each row gets read in full.

### 4 · Row selection and bulk actions

`DataTable` had no selection mechanism at all. Added as **opt-in** props, so
every other table in the CRM renders byte-identically. Header checkbox shows an
indeterminate dash for partial selection; Escape clears; selection resets on
filter change so you cannot act on rows you can no longer see.

### 5 · Filters live in the URL

Bucket, status, opportunity, search and page were `useState` — a refresh threw
the view away and nothing was shareable. Now query params, with `replaceState`
while typing so Back does not walk through every keystroke.

### 6 · States are written, not defaulted

"No candidates match these filters. Try widening the status or opportunity, or
clear the filters" instead of "No records found". Skeletons match the final
row and card dimensions, so nothing shifts on load.

---

## Honest limitations

**Metric tiles describe the current page, not the database.** There is no
aggregate endpoint, and inventing one would let the tiles and the table
disagree. "Total" uses the server's real count; the other three say "on this
page" in their context line. A `/api/dashboard/profiles-summary` endpoint would
fix this properly.

**Bulk actions are a stub.** The bar appears and counts correctly, but there is
no bulk endpoint — firing N sequential requests would be a slow lie dressed as
a feature. It currently reports that honestly. Needs
`POST /api/candidate-profiles/bulk` taking ids + an action.

**Not verified in a browser.** No headless Chrome in this environment. Keyboard
order, focus trapping and the breakpoints are built to spec and confirmed by
reading, not by tabbing. An axe pass is still owed.

---

## Verified

- **Contrast**: 22 text pairings, all ≥4.5:1 (lowest 4.86). Ring strokes ≥3:1
  on their own surface (lowest 3.80).
- **Score sort compiles** to a real correlated subquery against
  `ai_interview_links`, and `_parse_sort` accepts it while still ignoring junk.
- **Backend**: 378 tests pass; the 6 failures are pre-existing or
  sandbox-environmental (no writable DB here) — confirmed by stashing.
- **App boots**: 333 endpoints, 266 CRM routes.
- **TypeScript**: clean.
- **No file over 366 lines** in the new page.

## Files

| New | Lines |
|---|---:|
| `crm/components/ScoreIndicator.tsx` | 133 |
| `crm/components/MetricTile.tsx` | 83 |
| `crm/components/FilterChips.tsx` | 69 |
| `crm/components/BulkActionBar.tsx` | 74 |
| `crm/pages/profiles/ProfilesListPage.tsx` | 366 |
| `crm/pages/profiles/profileColumns.tsx` | 322 |
| `crm/pages/profiles/ProfileToolbar.tsx` | 126 |
| `crm/pages/profiles/ProfileCardGrid.tsx` | 124 |
| `crm/pages/profiles/useProfileFilters.ts` | 111 |
| `crm/pages/profiles/ProfileSummaryStrip.tsx` | 84 |

| Modified | Change |
|---|---|
| `styles/tokens.css` | score scale + tabular numerals (append only) |
| `tailwind.config.cjs` | `colors.score.*` mapping |
| `crm/components/DataTable.tsx` | opt-in selection |
| `crm/pages/Profiles.tsx` | list body → 16-line adapter (348 lines removed) |
| `backend/routers/crm/candidate_profiles.py` | `_LATEST_AI_SCORE` sort |
| `backend/routers/crm/table_preferences.py` | `ai_interview`, `notice_period` sortable |
