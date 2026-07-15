# Pack deletion + moving questions between packs — Design

Date: 2026-07-15
Status: approved

## Goal

Two additions to the pack editor (the "Question Packs" modal):

1. **Delete a custom pack** from the UI, with an inline confirmation, removing its
   cards from live play before the pack disappears.
2. **Move questions between custom packs**, multiple at a time, preserving each
   question's favorite/retired marks.

## Current state

- `deletePack` already exists end-to-end (`app.js` helper, both stores,
  `DELETE /api/packs/<id>` with mark cleanup) but has no UI.
- No move support anywhere: needs a new store method in both `store-server.js`
  and `store-supabase.js`, a new `server.py` route with `test_server.py`
  coverage, and app-side UI + deck reconciliation.
- Marks reference questions by qkey `p<packId>-<questionId>`, so moving a
  question changes its qkey; the backends must rewrite marks.

## 1. Pack deletion UI

- Each **custom** pack header gets a trash-icon button on the far right (after
  the chevron), rendered **only while that pack is expanded**. Base Game,
  Greatest Hits, and Retired sections never get one.
- Clicking it renders an inline confirm strip at the top of the pack body:
  *Delete "«name»" and its N questions? This can't be undone.* with a
  danger-styled **Delete** button and a **Cancel** button. Collapsing the pack
  or any re-render cancels the pending confirm.
- On confirm:
  1. Call `store.deletePack(id)`. On failure, leave everything untouched.
  2. On success, purge the pack's cards (`p<id>-` qkey prefix) from **all** live
     piles: deck, skipped, answered (discard), and `currentCard` — if the
     current card belonged to the pack, auto-draw the next card or show the
     empty state. (Backends already delete the pack's marks.)
  3. Close the pack (clear `openPackId` if it was this pack) and re-render.

## 2. Moving questions (multi-select)

### UI

- Every question row in an expanded custom pack gets a checkbox on the left
  (edit-mode rows keep their current form; no checkbox while editing).
- When ≥1 checkbox is checked, a move bar appears at the top of the pack body:
  **Move N to [destination pack ▾] [Move]**. The dropdown lists all *other*
  custom packs (never the current pack, never Base Game).
- If no other custom pack exists, the bar instead shows a hint: *Create another
  pack to move questions*.
- Selections clear on move success, pack collapse, or re-render from other
  actions.

### Store interface (both stores, identical)

```js
async moveQuestions(fromPackId, toPackId, qids)
// → [{ oldQkey, newQkey, question }] on success, null on failure
// `question` is the question object as it exists in the target pack.
```

- **store-server.js:** `POST /api/packs/<from>/questions/move` with body
  `{ toPackId, qids: [...] }`.
- **store-supabase.js:** question ids are globally unique, so:
  `update questions set pack_id = to where id in (qids) and pack_id = from`,
  then rewrite marks (for each moved qid with a mark row at `p<from>-<qid>`:
  upsert `p<to>-<qid>`, delete the old row). `newQkey = p<to>-<qid>`.

### server.py route

`POST /api/packs/<fromId>/questions/move`, body `{ toPackId, qids }`:

- 404 if either pack id doesn't exist; 400 if `toPackId == fromId`, or `qids`
  is missing/empty/not a list; 404 if any qid isn't in the source pack
  (all-or-nothing: no partial moves).
- Under `PACKS_LOCK`: remove each question from the source pack, append it to
  the target pack, assigning a fresh `_next_id(target.questions)` when the old
  id collides with an existing target id (server ids are per-pack).
- Rewrite marks in `user_data.json`: any `favorites`/`retired` entry equal to
  `p<from>-<qid>` becomes `p<to>-<newQid>`, preserving list membership.
- Response: `{ "moved": [{ "oldQkey", "newQkey", "question" }] }`.

### test_server.py coverage

- Happy path: questions leave source, appear in target, ids reassigned on
  collision, response shape correct.
- Marks rewritten (favorite + retired survive the move under new qkeys).
- 404 unknown source/target pack, 404 qid not in source, 400 move-to-self,
  400 empty/missing qids.

### App-side reconciliation after a successful move

For each `{oldQkey, newQkey, question}`:

- If the old card is in `discard`, `skipped`, or is `currentCard`: rewrite its
  `qkey` (and pack name label) in place so session history stays intact.
- If the old card is in `deck`: remove it; shuffle the new card in **only if
  the destination pack is enabled** (mirrors `syncDeckWithPack` semantics).
- If the card wasn't in play but the destination pack is enabled and the source
  was disabled, shuffle the new card into the deck.
- Then `loadMarks()` (backend rewrote them) and `renderPacks()`; save session.

## 3. CSS (style.css)

New scoped rules for: the header trash button, inline confirm strip (danger
button styling consistent with existing buttons), row checkboxes, and the move
bar. **Every element JS toggles with `.hidden` gets its own scoped `.hidden`
rule** (project gotcha). No new animation; `prefers-reduced-motion` unaffected.
Follow PRODUCT.md tone (no cutesy copy, WCAG AA contrast, real `aria-label`s
on icon-only buttons).

## 4. Non-changes / constraints

- No new files ship, so Dockerfile and the Pages workflow are untouched.
- `app.js` stays backend-agnostic (only talks to `window.store`).
- Zero dependencies, no build step.
- Signed-out web users never see any of this (pack editing already gated).

## Edge cases

- Deleting the currently-open pack closes it.
- Moving all questions out leaves a valid empty pack.
- Move bar hidden while a question row is in edit mode? No — bar visibility
  depends only on checkbox state; editing a row simply has no checkbox.
- Concurrent rarity: server route is all-or-nothing under the global lock.
