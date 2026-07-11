# Answered Questions Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the collapsible "Discard pile" footer with an "Answered" panel — a persistent right-hand sidebar on desktop (≥900px) and a bottom drawer on mobile — showing the 10 most-recently-answered questions with a "Show all" control that expands to a scrollable full list.

**Architecture:** Pure presentation change over the existing in-memory `discard` array (already most-recent-first). `index.html` gains a `.layout` wrapper splitting the page into `.game-column` (existing top-bar + main) and a new `.answered-sidebar`. `style.css` adds a `900px` breakpoint that switches `.layout` from a column to a row. `app.js` renames the `discard*` render/DOM-ref/event-handler code to `answered*` equivalents and adds capped-list + show-all-expand behavior.

**Tech Stack:** Vanilla HTML/CSS/JS, no build step, no bundler, no frontend test framework in this repo. Verification is manual, in a running browser, via `python3 server.py` (see README.md for local run instructions).

## Global Constraints

- No new dependencies, no build tooling introduced.
- No changes to `store-server.js`, `store-supabase.js`, `config.js`, `config.web.js`, or `server.py` — confirmed via grep that none of them reference the `discard*` IDs/classes being renamed.
- Preserve all existing keyboard shortcuts and existing element IDs not related to the discard pile (`$drawBtn`, `$answeredBtn`, etc. — note `answeredBtn` is the pre-existing "Answered" card action button and is a different element from the new sidebar; do not confuse the two).
- Reuse existing CSS custom properties (`--surface`, `--ink-dim`, `--ink-muted`, `--radius-sm`, `--ease-out-quart`, etc.) — no new hardcoded colors.
- Follow the existing per-component `.foo.hidden { display: none; }` convention (this repo has no generic `.hidden` utility class).

---

### Task 1: Sidebar scaffolding — markup, layout CSS, capped list rendering

**Files:**
- Modify: `index.html:26-124`
- Modify: `style.css` (insert new `/* ── Layout ── */` block before `.top-bar` at line 105; replace the `/* ── Discard Drawer ── */` block at lines 438-532)
- Modify: `app.js` (DOM refs ~455-458, Game State ~22-29, `resetGame` ~514-518, `renderDiscardPile`→`renderAnsweredList` ~674-690, its call sites in `answerCard` and `toggleScore`, `updateUI` ~694, the `$discardToggle` listener ~797-801)
- Test: manual browser verification (no automated frontend test suite exists in this repo)

**Interfaces:**
- Produces: `renderAnsweredList()` (replaces `renderDiscardPile()`), DOM refs `$answeredMobileToggle`, `$answeredChevron`, `$answeredList`, `$answeredCount`, `$answeredShowAll` — Task 2 extends `renderAnsweredList()` and reuses these refs.

- [ ] **Step 1: Replace the top-bar/main/discard-footer HTML with the layout + sidebar structure**

In `index.html`, replace the block from `<!-- Top Bar -->` (line 26) through the closing `</footer>` of the discard pile (line 124) with:

```html
  <div class="layout">
    <div class="game-column">

      <!-- Top Bar -->
      <header class="top-bar">
        <h1 class="title">Drawn Together</h1>
        <div class="top-actions">
          <div class="stat" id="scoreDisplay">
            <span>Score</span>
            <span class="stat-value" id="scoreValue">0</span>
          </div>
          <label class="toggle-label" title="Toggle score tracking">
            <input type="checkbox" class="toggle-checkbox" id="scoreToggle" checked>
            <span class="toggle-track" id="scoreTrack">
              <span class="toggle-thumb"></span>
            </span>
          </label>
          <button class="theme-btn" id="editBtn" title="Edit questions" aria-label="Edit questions">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1.125rem;height:1.125rem">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </button>
          <button class="theme-btn" id="themeToggle" title="Toggle theme" aria-label="Switch to dark mode">
            <!-- Sun icon (shown in dark mode → switch to light) -->
            <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5"/>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
            <!-- Moon icon (shown in light mode → switch to dark) -->
            <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          </button>
        </div>
      </header>

      <!-- Main Game Area -->
      <main class="main" id="mainArea">
        <!-- Empty / Draw State -->
        <div class="empty-state" id="emptyState">
          <div class="deck-illustration" aria-hidden="true">
            <div class="deck-card"></div>
            <div class="deck-card"></div>
            <div class="deck-card"></div>
          </div>
          <p class="remaining-badge" id="remainingBadge">
            <strong id="remainingCount">108</strong> questions in the deck
          </p>
          <button class="btn btn-primary" id="drawBtn" autofocus>
            Draw a Card
          </button>
        </div>

        <!-- Active Card -->
        <div class="card-stage hidden" id="cardStage">
          <div class="card" id="activeCard">
            <div class="card-rarity">
              <span class="rarity-dot" id="rarityDot"></span>
              <span class="rarity-label" id="rarityLabel"></span>
              <span class="card-marks">
                <button class="card-mark-btn" id="favBtn" aria-pressed="false" aria-label="Save to greatest hits" title="Save to greatest hits">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21C7 16.5 3 13.2 3 8.9 3 6.2 5.2 4 7.9 4c1.6 0 3.1.8 4.1 2.1C13 4.8 14.5 4 16.1 4 18.8 4 21 6.2 21 8.9c0 4.3-4 7.6-9 12.1z"/></svg>
                </button>
                <button class="card-mark-btn" id="retireBtn" aria-label="Never show this question again" title="Never show again">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                </button>
              </span>
            </div>
            <p class="card-question" id="cardQuestion"></p>
            <p class="card-category" id="cardCategory"></p>
            <div class="card-actions">
              <button class="btn btn-ghost btn-skip" id="skipBtn">Skip</button>
              <button class="btn btn-answered" id="answeredBtn">Answered</button>
            </div>
          </div>
        </div>

        <!-- Game Over -->
        <div class="game-over hidden" id="gameOver">
          <div class="game-over-icon">🕯️</div>
          <h2 class="game-over-heading">Deck's empty</h2>
          <p class="game-over-sub" id="gameOverSub">
            You made it through every question.<br>Here's to many more conversations.
          </p>
          <div class="final-scores" id="finalScores"></div>
          <p class="game-over-sub" id="gameOverExtra"></p>
          <button class="btn btn-primary" id="resetBtn">One more round</button>
        </div>
      </main>

    </div>

    <!-- Answered Sidebar -->
    <aside class="answered-sidebar" id="answeredSidebar">
      <button class="answered-header" id="answeredMobileToggle" aria-expanded="false">
        <span>Answered</span>
        <span class="stat-value" id="answeredCount">0</span>
        <svg class="answered-chevron" id="answeredChevron" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M3 5l4 4 4-4"/>
        </svg>
      </button>
      <div class="answered-list" id="answeredList" role="region" aria-label="Answered questions"></div>
      <button class="answered-show-all hidden" id="answeredShowAll" type="button">Show all</button>
    </aside>
  </div>
```

Note: the `<button class="btn btn-answered" id="answeredBtn">Answered</button>` inside `.card-actions` is pre-existing and unrelated to the new sidebar — leave it exactly as-is.

- [ ] **Step 2: Add the `.layout`/`.game-column` structural CSS and the 900px breakpoint**

In `style.css`, insert this new block immediately before the `.top-bar` rule (the line reading `.top-bar {`):

```css
  /* ── Layout ── */
  .layout {
    width: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .game-column {
    width: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  @media (min-width: 900px) {
    .layout {
      flex-direction: row;
      align-items: flex-start;
      justify-content: center;
      gap: 1.5rem;
      max-width: 1100px;
      margin: 0 auto;
    }
    .game-column {
      width: auto;
      flex: 1 1 auto;
    }
  }

```

- [ ] **Step 3: Replace the discard-drawer CSS with the answered-sidebar CSS**

In `style.css`, replace the entire `/* ── Discard Drawer ── */` block — from that comment (currently line 438) through the closing brace of `.discard-empty { ... }` (currently line 532) — with:

```css
  /* ── Answered Sidebar ── */
  .answered-sidebar {
    width: 100%;
    max-width: min(92vw, clamp(480px, 46vw, 720px));
    flex-shrink: 0;
    padding: 0.5rem 0 1rem;
    position: relative;
    z-index: 1;
  }

  .answered-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    background: none;
    border: none;
    color: var(--ink-muted);
    font-family: var(--font-body);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    padding: 0.625rem;
    transition: color 0.2s;
    -webkit-tap-highlight-color: transparent;
  }
  .answered-header:hover { color: var(--ink-dim); }
  .answered-header:focus-visible {
    outline: 2px solid var(--ink-dim);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .answered-chevron {
    width: 14px;
    height: 14px;
    transition: transform 0.3s var(--ease-out-quart);
  }
  .answered-chevron.open { transform: rotate(180deg); }

  .answered-list {
    display: none;
    padding: 0.25rem 0.25rem 0.5rem;
  }
  .answered-list.open { display: block; }

  .answered-item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8125rem;
    color: var(--ink-dim);
    animation: answeredEnter 0.3s var(--ease-out-quart) both;
  }
  .answered-item:nth-child(1) { animation-delay: 0s; }
  .answered-item:nth-child(2) { animation-delay: 0.03s; }
  .answered-item:nth-child(3) { animation-delay: 0.06s; }
  .answered-item:nth-child(4) { animation-delay: 0.09s; }
  .answered-item:nth-child(5) { animation-delay: 0.12s; }

  @keyframes answeredEnter {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .answered-item:hover { background: var(--surface); }
  .answered-item-dot { width: 0.375rem; height: 0.375rem; border-radius: 50%; flex-shrink: 0; }
  .answered-item-text {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .answered-item-score {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .answered-empty {
    text-align: center;
    font-size: 0.8125rem;
    color: var(--ink-muted);
    padding: 1rem;
  }

  .answered-show-all {
    width: 100%;
    background: none;
    border: none;
    color: var(--ink-muted);
    font-family: var(--font-body);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    padding: 0.5rem;
    text-align: center;
    transition: color 0.2s;
    -webkit-tap-highlight-color: transparent;
  }
  .answered-show-all:hover { color: var(--ink-dim); }
  .answered-show-all.hidden { display: none; }
  .answered-show-all:focus-visible {
    outline: 2px solid var(--ink-dim);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  @media (min-width: 900px) {
    .answered-sidebar {
      width: 280px;
      max-width: 280px;
      flex-shrink: 0;
      align-self: stretch;
      display: flex;
      flex-direction: column;
      padding: 0.5rem 0;
    }
    .answered-header {
      cursor: default;
      pointer-events: none;
    }
    .answered-header .answered-chevron { display: none; }
    .answered-list { display: block; }
  }
```

- [ ] **Step 4: Rename the discard-pile DOM refs and state to answered-sidebar equivalents in `app.js`**

Replace the Game State block:

```js
  /* ── Game State ── */
  let deck = [];
  let discard = [];
  let currentCard = null;
  let score = 0;
  let scoreEnabled = true;
  let questionsAnswered = 0;
  let rarestAnswered = null;
```

with:

```js
  /* ── Game State ── */
  let deck = [];
  let discard = [];
  let currentCard = null;
  let score = 0;
  let scoreEnabled = true;
  let questionsAnswered = 0;
  let rarestAnswered = null;
  let showAllAnswered = false;
```

Replace the DOM refs:

```js
  const $discardToggle = document.getElementById('discardToggle');
  const $discardChevron = document.getElementById('discardChevron');
  const $discardPile  = document.getElementById('discardPile');
  const $discardCount = document.getElementById('discardCount');
```

with:

```js
  const $answeredMobileToggle = document.getElementById('answeredMobileToggle');
  const $answeredChevron = document.getElementById('answeredChevron');
  const $answeredList = document.getElementById('answeredList');
  const $answeredCount = document.getElementById('answeredCount');
  const $answeredShowAll = document.getElementById('answeredShowAll');
```

- [ ] **Step 5: Update `resetGame()` to clear the answered sidebar**

Replace:

```js
    $discardPile.innerHTML = '';
    $discardPile.classList.remove('open');
    $discardChevron.classList.remove('open');
    $discardToggle.setAttribute('aria-expanded', 'false');
```

with:

```js
    showAllAnswered = false;
    $answeredList.innerHTML = '';
    $answeredList.classList.remove('open', 'expanded');
    $answeredChevron.classList.remove('open');
    $answeredMobileToggle.setAttribute('aria-expanded', 'false');
    $answeredShowAll.classList.add('hidden');
    $answeredShowAll.textContent = 'Show all';
```

- [ ] **Step 6: Rename `renderDiscardPile()` to `renderAnsweredList()` and cap it to 10 rows**

Replace the entire function:

```js
  function renderDiscardPile() {
    if (discard.length === 0) {
      $discardPile.innerHTML = '<p class="discard-empty">No questions answered yet</p>';
    } else {
      $discardPile.innerHTML = discard.map((q) => {
        const r = RARITY[q.rarity];
        return `
          <div class="discard-item">
            <span class="discard-item-dot" style="background: ${r.color}"></span>
            <span class="discard-item-text" title="${escapeHTML(q.text)}">${escapeHTML(q.text)}</span>
            ${scoreEnabled ? `<span class="discard-item-score" style="color: ${r.color}">+${r.points}</span>` : ''}
          </div>
        `;
      }).join('');
    }
    $discardCount.textContent = discard.length;
  }
```

with:

```js
  function renderAnsweredList() {
    const visible = discard.slice(0, 10);
    if (discard.length === 0) {
      $answeredList.innerHTML = '<p class="answered-empty">No questions answered yet</p>';
    } else {
      $answeredList.innerHTML = visible.map((q) => {
        const r = RARITY[q.rarity];
        return `
          <div class="answered-item">
            <span class="answered-item-dot" style="background: ${r.color}"></span>
            <span class="answered-item-text" title="${escapeHTML(q.text)}">${escapeHTML(q.text)}</span>
            ${scoreEnabled ? `<span class="answered-item-score" style="color: ${r.color}">+${r.points}</span>` : ''}
          </div>
        `;
      }).join('');
    }
    $answeredCount.textContent = discard.length;
  }
```

- [ ] **Step 7: Update the two call sites of the renamed function**

In `answerCard()`, replace:

```js
      updateUI();
      renderDiscardPile();
```

with:

```js
      updateUI();
      renderAnsweredList();
```

In `toggleScore()`, replace:

```js
    updateUI();
    renderDiscardPile();
```

with:

```js
    updateUI();
    renderAnsweredList();
```

- [ ] **Step 8: Update `updateUI()` and the mobile toggle listener**

Replace:

```js
  function updateUI() {
    $remainingCount.textContent = deck.length;
    $discardCount.textContent = discard.length;
```

with:

```js
  function updateUI() {
    $remainingCount.textContent = deck.length;
    $answeredCount.textContent = discard.length;
```

Replace:

```js
  $discardToggle.addEventListener('click', () => {
    const isOpen = $discardPile.classList.toggle('open');
    $discardChevron.classList.toggle('open', isOpen);
    $discardToggle.setAttribute('aria-expanded', isOpen);
  });
```

with:

```js
  $answeredMobileToggle.addEventListener('click', () => {
    const isOpen = $answeredList.classList.toggle('open');
    $answeredChevron.classList.toggle('open', isOpen);
    $answeredMobileToggle.setAttribute('aria-expanded', isOpen);
  });
```

- [ ] **Step 9: Verify in the browser**

Run: `python3 server.py` (from repo root), then open `http://localhost:8080` in a browser.

Expected:
- Page loads with no console errors.
- At a wide window (≥900px), the "Answered" panel is visible to the right of the card, showing "No questions answered yet" and a count of 0.
- Answer 2-3 questions (draw a card, click "Answered") — they appear in the sidebar, most recent on top, with a colored dot and a `+N` score badge.
- Narrow the window below 900px — the sidebar becomes a collapsed bar labeled "Answered" with a count and chevron; clicking it opens/closes the list; the chevron rotates.
- No "Show all" button is visible yet regardless of how many are answered (that's Task 2).

- [ ] **Step 10: Commit**

```bash
git add index.html style.css app.js
git commit -m "feat: replace discard-pile footer with answered-questions sidebar"
```

---

### Task 2: Show-all expand/collapse behavior

**Files:**
- Modify: `style.css` (add `.answered-list.expanded` rule near the `.answered-show-all` rules added in Task 1)
- Modify: `app.js` (`renderAnsweredList()`, `resetGame()`, new `$answeredShowAll` click listener)
- Test: manual browser verification

**Interfaces:**
- Consumes: `$answeredShowAll`, `$answeredList`, `showAllAnswered`, `renderAnsweredList()` from Task 1.
- Produces: fully finished sidebar behavior — no further tasks depend on new interfaces from this task.

- [ ] **Step 1: Add the expanded/scrollable CSS**

In `style.css`, insert this rule immediately after `.answered-show-all:focus-visible { ... }` (added in Task 1 Step 3), still inside the `/* ── Answered Sidebar ── */` section, before the `@media (min-width: 900px) { ... }` block:

```css
  .answered-list.expanded {
    max-height: 40vh;
    overflow-y: auto;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
    scrollbar-color: var(--surface-raised) transparent;
  }
```

Then, inside the existing `@media (min-width: 900px) { ... }` block added in Task 1 Step 3 (the one that sets `.answered-header { cursor: default; ... }`), add:

```css
    .answered-list.expanded { max-height: 50vh; }
```

- [ ] **Step 2: Extend `renderAnsweredList()` with show-all logic**

Replace the function body from Task 1 Step 6:

```js
  function renderAnsweredList() {
    const visible = discard.slice(0, 10);
    if (discard.length === 0) {
      $answeredList.innerHTML = '<p class="answered-empty">No questions answered yet</p>';
    } else {
      $answeredList.innerHTML = visible.map((q) => {
        const r = RARITY[q.rarity];
        return `
          <div class="answered-item">
            <span class="answered-item-dot" style="background: ${r.color}"></span>
            <span class="answered-item-text" title="${escapeHTML(q.text)}">${escapeHTML(q.text)}</span>
            ${scoreEnabled ? `<span class="answered-item-score" style="color: ${r.color}">+${r.points}</span>` : ''}
          </div>
        `;
      }).join('');
    }
    $answeredCount.textContent = discard.length;
  }
```

with:

```js
  function renderAnsweredList() {
    const visible = showAllAnswered ? discard : discard.slice(0, 10);
    if (discard.length === 0) {
      $answeredList.innerHTML = '<p class="answered-empty">No questions answered yet</p>';
    } else {
      $answeredList.innerHTML = visible.map((q) => {
        const r = RARITY[q.rarity];
        return `
          <div class="answered-item">
            <span class="answered-item-dot" style="background: ${r.color}"></span>
            <span class="answered-item-text" title="${escapeHTML(q.text)}">${escapeHTML(q.text)}</span>
            ${scoreEnabled ? `<span class="answered-item-score" style="color: ${r.color}">+${r.points}</span>` : ''}
          </div>
        `;
      }).join('');
    }
    $answeredList.classList.toggle('expanded', showAllAnswered);
    $answeredCount.textContent = discard.length;
    $answeredShowAll.classList.toggle('hidden', discard.length <= 10);
    $answeredShowAll.textContent = showAllAnswered ? 'Show recent' : `Show all (${discard.length})`;
  }
```

- [ ] **Step 3: Add the show-all click listener**

Immediately after the `$answeredMobileToggle.addEventListener(...)` block added in Task 1 Step 8, add:

```js

  $answeredShowAll.addEventListener('click', () => {
    showAllAnswered = !showAllAnswered;
    renderAnsweredList();
  });
```

- [ ] **Step 4: Verify in the browser**

Run: `python3 server.py` (from repo root, or reuse an already-running instance), open `http://localhost:8080`.

Expected:
- Answer 10 or fewer questions — no "Show all" button appears.
- Answer an 11th — a "Show all (11)" button appears below the list.
- Click it — the sidebar list expands to show all 11 (or more), gains a scrollbar once it exceeds the panel's max-height, and the button now reads "Show recent".
- Click "Show recent" — collapses back to the 10 most recent, button reverts to "Show all (N)".
- Click "One more round" (reset) mid-expanded-state — sidebar clears, show-all state and button reset back to hidden/collapsed for the new round.
- Toggle the score switch off/on — score badges disappear/reappear on sidebar rows in both capped and expanded view.
- Switch to dark mode — sidebar colors follow the theme with no hardcoded/mismatched colors.

- [ ] **Step 5: Commit**

```bash
git add style.css app.js
git commit -m "feat: add show-all expand/collapse to answered sidebar"
```
