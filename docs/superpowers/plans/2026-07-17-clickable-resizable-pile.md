# Clickable, Resizable Card Pile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the draw-screen card pile a real draw affordance — clickable to draw, ~2x its current size by default, with a persisted corner resize handle independent of the drawn card's size.

**Architecture:** Frontend-only change mirroring the existing drawn-card resize pattern in `app.js` (a corner handle drives a `--pile-scale` CSS variable, persisted in localStorage as `dt_pile_scale`). The decorative `.deck-illustration` div becomes a real `<button>` wired to the existing `drawCard()` function. No store/server changes.

**Tech Stack:** Vanilla HTML/CSS/JS, zero dependencies (project rule — no frameworks, no build step).

**Spec:** `docs/superpowers/specs/2026-07-17-clickable-resizable-pile-design.md`

## Global Constraints

- Zero dependencies: vanilla HTML/CSS/JS only, no package.json, no build step.
- No generic `.hidden` rule exists in `style.css`; any JS-toggled `.hidden` needs its own scoped CSS rule (this plan adds no new `.hidden` toggles).
- Motion effects must be gated on `prefers-reduced-motion` (PRODUCT.md).
- Commit to `main` and push immediately after each commit (repo publish flow).
- This project has no frontend unit-test framework; the test cycle for each task is the Python API suite (must stay green) plus a scripted browser check via the project's `verify` skill.
- New files are none — `index.html`, `style.css`, `app.js` are already shipped in both the Dockerfile and the Pages workflow, so no deployment manifest changes.

---

### Task 1: Pile becomes a clickable draw button

**Files:**
- Modify: `index.html:85-89` (the `.deck-illustration` block)
- Modify: `style.css:295-313` (`.deck-illustration` / `.deck-card` rules)
- Modify: `app.js:958` region (DOM refs) and `app.js:1623` region (listeners)

**Interfaces:**
- Consumes: existing `drawCard()` (`app.js:1284`, no args, guards empty deck itself).
- Produces: `<button id="pileBtn" class="deck-illustration">` wrapped in `<div class="pile-wrap">`, and JS ref `$pileBtn`. Task 2 adds a sibling handle button inside `.pile-wrap` and sets `--pile-scale` on `$pileBtn`.

- [ ] **Step 1: Replace the illustration markup in `index.html`**

Replace lines 85–89:

```html
          <div class="deck-illustration" aria-hidden="true">
            <div class="deck-card"></div>
            <div class="deck-card"></div>
            <div class="deck-card"></div>
          </div>
```

with:

```html
          <div class="pile-wrap">
            <button type="button" class="deck-illustration" id="pileBtn" aria-label="Draw a card" title="Draw a card">
              <span class="deck-card" aria-hidden="true"></span>
              <span class="deck-card" aria-hidden="true"></span>
              <span class="deck-card" aria-hidden="true"></span>
            </button>
          </div>
```

(`span`, not `div` — flow content inside a `<button>` is invalid HTML. `.deck-card` is `position: absolute`, so rendering is unchanged.)

- [ ] **Step 2: Add button styling in `style.css`**

`.deck-card` uses `nth-child` selectors (`style.css:311-313`) — they keep working on the spans. Immediately before the `.deck-illustration` rule (line 295), add:

```css
  .pile-wrap {
    position: relative;
  }
```

Then extend the existing `.deck-illustration` rule and add new rules after it, so the block reads:

```css
  .deck-illustration {
    position: relative;
    width: clamp(140px, 10vw + 100px, 200px);
    height: clamp(180px, 12vw + 130px, 256px);
    display: block;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .deck-illustration:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 4px;
    border-radius: var(--radius-md);
  }
  @media (prefers-reduced-motion: no-preference) {
    .deck-illustration:hover .deck-card:nth-child(1),
    .deck-illustration:focus-visible .deck-card:nth-child(1) {
      transform: translateX(-50%) translateY(-6px);
    }
    .deck-illustration:active .deck-card:nth-child(1) {
      transform: translateX(-50%) translateY(-2px);
    }
  }
```

(The lift animates via the existing `transition: transform 0.4s var(--ease-out-expo)` on `.deck-card`, and the whole hover block is gated on `prefers-reduced-motion: no-preference`.)

- [ ] **Step 3: Wire the click in `app.js`**

Next to the existing DOM ref at line 958:

```js
  const $pileBtn      = document.getElementById('pileBtn');
```

Next to the existing listener at line 1623 (`$drawBtn.addEventListener('click', drawCard);`):

```js
  $pileBtn.addEventListener('click', drawCard);
```

- [ ] **Step 4: Run the API test suite (regression guard)**

Run: `python3 -m unittest test_server.py`
Expected: OK (all tests pass — this change is frontend-only).

- [ ] **Step 5: Verify in a real browser**

Invoke the project's `verify` skill (build/launch/drive recipe) and confirm:
- The draw screen renders the pile identically to before (three stacked cards).
- Clicking the pile draws a card (same as the Draw button).
- Tab reaches the pile button; it shows a focus ring; Enter/Space draws.
- The existing Playwright smoke test (`tools/smoke.mjs`, per the skill's recipe) still passes — it clicks `#drawBtn`, which is unchanged.

- [ ] **Step 6: Commit and push**

```bash
git add index.html style.css app.js
git commit -m "feat: card pile is clickable to draw"
git push
```

---

### Task 2: Doubled default size + persisted corner resize handle

**Files:**
- Modify: `index.html` (inside the `.pile-wrap` div added in Task 1)
- Modify: `style.css` (`.deck-illustration` / `.deck-card` dimensions; handle positioning)
- Modify: `app.js` (new pile-scale block after line 201, DOM refs near line 993, boot calls near line 2024)

**Interfaces:**
- Consumes: `.pile-wrap` / `#pileBtn` from Task 1; existing helpers `announceStatus(msg)` and the card-scale block at `app.js:129-201` as the pattern to mirror; existing `.card-resize-handle` CSS class for handle appearance.
- Produces: localStorage key `dt_pile_scale` (stringified float in [0.5, 1.5]); CSS var `--pile-scale` set inline on `#pileBtn`.

- [ ] **Step 1: Add the handle markup in `index.html`**

Inside `.pile-wrap`, as a *sibling* after the `</button>` closing `#pileBtn` (a button can't nest inside a button):

```html
            <button class="card-resize-handle pile-resize-handle" id="pileResizeHandle" type="button" aria-label="Resize pile" title="Drag to resize (arrow keys when focused, Enter to reset)">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                <line x1="5" y1="15" x2="15" y2="5"/>
                <line x1="9" y1="15" x2="15" y2="9"/>
              </svg>
            </button>
```

- [ ] **Step 2: Double the pile dimensions and apply `--pile-scale` in `style.css`**

Replace the dimension declarations in `.deck-illustration` and `.deck-card` (keep every other declaration from Task 1 as-is):

```css
  .deck-illustration {
    width: calc(clamp(280px, 20vw + 200px, 400px) * var(--pile-scale, 1));
    height: calc(clamp(360px, 24vw + 260px, 512px) * var(--pile-scale, 1));
  }
  .deck-card {
    width: calc(clamp(240px, 18vw + 168px, 344px) * var(--pile-scale, 1));
    height: calc(clamp(336px, 24vw + 236px, 480px) * var(--pile-scale, 1));
  }
```

Double the stacking offsets to keep proportions:

```css
  .deck-card:nth-child(1) { top: 0;  z-index: 3; }
  .deck-card:nth-child(2) { top: 12px; z-index: 2; transform: translateX(-50%) rotate(-2deg); }
  .deck-card:nth-child(3) { top: 24px; z-index: 1; transform: translateX(-50%) rotate(3deg); }
```

Position the handle at the wrap's bottom-right (it reuses `.card-resize-handle` for appearance, which is `position: absolute; bottom/right: 0.375rem` — correct within the `position: relative` `.pile-wrap`; no extra rules needed unless the corner misses the visual card edge, in which case nudge with):

```css
  .pile-resize-handle {
    bottom: 0.125rem;
    right: 0.125rem;
  }
```

- [ ] **Step 3: Add the pile-scale block in `app.js`**

After the card-resize block (after line 201), a straight parallel:

```js
  /* ── Pile resize (manual, drag or keyboard) ── */
  const PILE_SCALE_MIN = 0.5;
  const PILE_SCALE_MAX = 1.5;
  const PILE_SCALE_STEP = 0.05;
  let pileScale = 1;

  function clampPileScale(v) {
    return Math.min(PILE_SCALE_MAX, Math.max(PILE_SCALE_MIN, v));
  }

  function setPileScale(v, announce) {
    pileScale = clampPileScale(v);
    $pileBtn.style.setProperty('--pile-scale', pileScale);
    if (announce) announceStatus(`Pile size ${Math.round(pileScale * 100)}%`);
  }

  function persistPileScale() {
    localStorage.setItem('dt_pile_scale', String(pileScale));
  }

  function loadPileScale() {
    const saved = parseFloat(localStorage.getItem('dt_pile_scale'));
    setPileScale(Number.isNaN(saved) ? 1 : saved, false);
  }

  function initPileResize() {
    let dragging = false;
    let startX = 0;
    let startScale = 1;

    $pileResizeHandle.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
      startScale = pileScale;
      $pileResizeHandle.setPointerCapture(e.pointerId);
    });

    $pileResizeHandle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const deltaX = e.clientX - startX;
      setPileScale(startScale + deltaX / 300, false);
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      persistPileScale();
      announceStatus(`Pile size ${Math.round(pileScale * 100)}%`);
    };
    $pileResizeHandle.addEventListener('pointerup', endDrag);
    $pileResizeHandle.addEventListener('pointercancel', endDrag);

    $pileResizeHandle.addEventListener('dblclick', () => {
      setPileScale(1, true);
      persistPileScale();
    });

    $pileResizeHandle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === '+') {
        e.preventDefault();
        setPileScale(pileScale + PILE_SCALE_STEP, true);
        persistPileScale();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === '-') {
        e.preventDefault();
        setPileScale(pileScale - PILE_SCALE_STEP, true);
        persistPileScale();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        setPileScale(1, true);
        persistPileScale();
      }
    });
  }
```

DOM ref next to `$cardResizeHandle` (line 993):

```js
  const $pileResizeHandle = document.getElementById('pileResizeHandle');
```

Boot calls immediately after `initCardResize();` (line 2024):

```js
  loadPileScale();
  initPileResize();
```

(Note: `$pileBtn` is declared at line ~958, which runs before the boot block calls `loadPileScale()` — same ordering the card version relies on.)

- [ ] **Step 4: Run the API test suite (regression guard)**

Run: `python3 -m unittest test_server.py`
Expected: OK.

- [ ] **Step 5: Verify in a real browser**

Invoke the project's `verify` skill and confirm:
- Pile renders ~2x its previous size by default; badge and Draw button still fit below without page overflow at a typical laptop viewport (~1280×800).
- Dragging the corner handle resizes the pile smoothly; releasing persists.
- Reloading the page restores the chosen size (`localStorage.getItem('dt_pile_scale')` in the console shows the value).
- Arrow keys on the focused handle step the size with a screen-reader announcement ("Pile size 105%"); Enter and double-click reset to 100%.
- Resizing the pile does not change the drawn card's size, and vice versa.
- `tools/smoke.mjs` still passes.

- [ ] **Step 6: Commit and push**

```bash
git add index.html style.css app.js
git commit -m "feat: pile 2x default size with persisted corner resize"
git push
```
