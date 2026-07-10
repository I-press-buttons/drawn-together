# Answered Questions Sidebar

## Summary

Replace the existing collapsible "Discard pile" footer with an "Answered" panel that shows previously-answered questions, most recent first. On desktop it is a persistent sidebar next to the card area; on mobile it collapses into a bottom drawer (same interaction the discard pile uses today). By default it shows the most recent 10 answered questions; a "Show all" control expands it in place to a scrollable list of every answered question in the session.

## Non-goals

- No backend/store changes. The answered list is derived entirely from the existing in-memory `discard` array (already most-recent-first via `unshift` in `answerCard()`).
- No persistence across page reloads/sessions beyond what already exists (none — `discard` resets on `resetGame()`).
- No change to scoring logic, only to how the score badge is displayed per row (unchanged from today).

## Markup changes (`index.html`)

- Wrap the existing `<header class="top-bar">` and `<main id="mainArea">` in a new `<div class="layout">`.
- Add a new sibling `<aside class="answered-sidebar" id="answeredSidebar">` inside `.layout`, after `.main`:
  ```html
  <aside class="answered-sidebar" id="answeredSidebar">
    <button class="answered-header" id="answeredMobileToggle" aria-expanded="false">
      <span>Answered</span>
      <span class="stat-value" id="answeredCount">0</span>
      <svg class="discard-chevron" id="answeredChevron" ...></svg>
    </button>
    <div class="answered-list" id="answeredList"></div>
    <button class="answered-show-all hidden" id="answeredShowAll">Show all</button>
  </aside>
  ```
- Remove the existing `<footer class="discard-area">` block and its children (`discardToggle`, `discardChevron`, `discardPile`, `discardCount`) entirely.

## Layout & breakpoints (`style.css`)

- New breakpoint at `min-width: 900px` (below the existing 640px modal breakpoint scope, added alongside the 520px/640px breakpoints already in the file):
  - `< 900px` (mobile/narrow): `.answered-sidebar` renders full-width below `.main`, collapsed by default. `.answered-header` acts as the toggle button (reusing the chevron-rotate pattern from today's `.discard-toggle`/`.discard-chevron`). `.answered-list` is hidden until expanded.
  - `>= 900px` (desktop/tablet-wide): `body` (or a new `.layout` wrapper) switches to a row layout placing the game column (top-bar + main) and `.answered-sidebar` side by side. Sidebar is always visible — `.answered-header` is present but non-interactive (no toggle chevron shown), matching how the existing "Base Game" pack row disables its toggle affordance.
- `.answered-list` capped view: no `max-height`/scroll — it only ever renders ≤10 rows, so it sizes to content.
- `.answered-list` expanded ("show all") view: gains `max-height` (e.g. `50vh` desktop / `40vh` mobile drawer) + `overflow-y: auto`, reusing the existing thin-scrollbar styling (`scrollbar-width: thin; scrollbar-color: var(--surface-raised) transparent;`) currently on `.discard-pile`.
- Row styling (`.answered-item`, dot, text, score badge) is a rename/carry-over of today's `.discard-item*` rules — no visual redesign beyond fitting the sidebar's width.

## Behavior (`app.js`)

- Rename `renderDiscardPile()` → `renderAnsweredList()`. Logic:
  - Reads `showAllAnswered` (new module-level boolean, default `false`).
  - `const visible = showAllAnswered ? discard : discard.slice(0, 10);`
  - Renders `visible` into `$answeredList` using the same per-row markup as today (dot + text + score badge, `scoreEnabled`-gated).
  - `$answeredCount.textContent = discard.length` (unchanged from `$discardCount`).
  - `$answeredShowAll` is hidden when `discard.length <= 10`; otherwise shown with label `"Show all (${discard.length})"` when collapsed or `"Show recent"` when `showAllAnswered` is true.
- `$answeredShowAll` click handler toggles `showAllAnswered` and re-renders.
- `$answeredMobileToggle` click handler: only active behavior `< 900px` (drawer open/close, same as today's `$discardToggle` listener — toggles an `.open` class on `.answered-list` + rotates chevron + updates `aria-expanded`). On `>= 900px` the button has no toggle behavior (sidebar is always open); implement by checking `window.matchMedia('(min-width: 900px)').matches` before applying the toggle, or simpler: rely on CSS to force `.answered-list` visible at the desktop breakpoint regardless of the `.open` class, so the JS toggle logic doesn't need to know the viewport at all.
- `resetGame()`: replace `$discardPile.innerHTML = ''` / `.classList.remove('open')` / chevron reset with the `.answered-list` / `.answered-header` equivalents, and also reset `showAllAnswered = false`.
- `answerCard()`: no change — already calls the renamed render function at the same point (`renderDiscardPile()` → `renderAnsweredList()`).
- `toggleScore()`: already calls `renderDiscardPile()` to refresh score badges — update call site to `renderAnsweredList()`.

## Edge cases

- Zero answered questions: show existing empty-state copy ("No questions answered yet") in `.answered-list`, "Show all" button hidden.
- Exactly 10 or fewer answered: "Show all" button hidden/never shown (nothing more to reveal).
- Switching from desktop to mobile width mid-session (resize/rotate): CSS-only breakpoint switch handles this without JS state changes, since the `.open` class semantics are ignored at desktop width per the approach above.
- Favorites round / any `resetGame(customDeck)` call: sidebar clears the same way as a normal reset (state is fully derived from `discard`, which is reset in all `resetGame` call paths).

## Testing / verification plan

Manual verification via the `run` skill in a real browser:
1. Desktop width (≥900px): confirm sidebar is visible immediately with no interaction, answer several questions, confirm most-recent-first order and live count update.
2. Answer 11+ questions, confirm capped list shows only 10, "Show all" appears, expands to a scrollable list of all of them, and "Show recent" collapses back to 10.
3. Resize to <900px: confirm sidebar becomes a collapsed drawer with a working toggle, chevron rotates, same show-all behavior works inside the drawer.
4. Toggle score tracking off/on: confirm score badges disappear/reappear on sidebar rows.
5. "One more round" / reset: confirm sidebar clears and show-all state resets.
6. Dark mode: confirm sidebar styling matches theme (reuses existing CSS variables, no new hardcoded colors).
