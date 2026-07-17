# Drawn Card Fits Viewport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The drawn question card auto-shrinks to fit the window — centered, never intersecting the fixed answered-history pill (bottom-left) or the top bar — with the user's persisted manual size preference applying relative to the fitted size.

**Architecture:** A JS-measured fit factor (`--card-fit`, derived state, never persisted) multiplies the existing `--card-scale` pipeline in CSS. `fitCardToViewport()` measures the rendered card against available height (viewport minus top bar, bottom pill reserve, top gap) and converges in ≤3 iterations (text rewraps as the card narrows, so height responds nonlinearly); floor 0.55, below which page scroll takes over. Hooked into `showCard()` (single choke point for every card-reveal path), a debounced window `resize` listener, and `setCardScale()`.

**Tech Stack:** Vanilla HTML/CSS/JS, zero dependencies (project rule — no frameworks, no build step).

**Spec:** `docs/superpowers/specs/2026-07-17-card-fit-viewport-design.md`

## Global Constraints

- Zero dependencies: vanilla JS/CSS only, no package.json, no build step.
- No HTML changes; no new elements; no persistence of the fit factor (only `dt_card_scale` persists, unchanged).
- No new animation (reduced-motion posture unchanged); fit changes apply instantly.
- No new `.hidden` toggles (nothing to add scoped CSS for).
- Clamp: final fit factor in [0.55, 1]; available height guarded with `Math.max(..., 1)`.
- Missing `.top-bar` falls back to 0 for its bottom edge.
- Commit to `main` and push immediately after each commit (repo publish flow).
- No frontend unit-test framework; test cycle = `python3 -m unittest test_server.py` (must stay green) + browser check via the project `verify` skill.
- Deployment manifests untouched (only `app.js` + `style.css` change; both already shipped).

---

### Task 1: `--card-fit` factor — CSS pipeline + JS measurement

**Files:**
- Modify: `style.css` (`.card-stage` width at ~429, `.card` padding at ~460, `.card-question` font-size at ~523)
- Modify: `app.js` (new fit block after the card-resize block ending at line 201; hook in `showCard()` at ~1354; call at end of `setCardScale()` at ~139)

**Interfaces:**
- Consumes: `$cardStage`, `$activeCard` (existing DOM refs, app.js ~958-993); `.top-bar` element (index.html:35, no JS ref exists — query it inside the function); existing `--card-scale` CSS usages.
- Produces: CSS var `--card-fit` set inline on `#cardStage` (float in [0.55, 1], default 1); function `fitCardToViewport()` (no args, no return).

- [ ] **Step 1: Add the `--card-fit` multiplier in `style.css`**

Three edits, each multiplying an existing `--card-scale`-era value by `var(--card-fit, 1)`:

`.card-stage` (line ~429), change only the `width` declaration:

```css
    width: calc(100% * var(--card-scale, 1) * var(--card-fit, 1));
```

`.card` (line ~460), change only the `padding` declaration (each of the three clamps gains the multiplier):

```css
    padding: calc(clamp(2rem, 1.4rem + 1.5vw, 3rem) * var(--card-fit, 1)) calc(clamp(1.5rem, 1.1rem + 1vw, 2.25rem) * var(--card-fit, 1)) calc(clamp(1.75rem, 1.35rem + 1vw, 2.5rem) * var(--card-fit, 1));
```

`.card-question` (line ~523), change only the `font-size` declaration:

```css
    font-size: calc(clamp(1.25rem, 1.2vw + 1rem, 2rem) * var(--card-scale, 1) * var(--card-fit, 1));
```

(Default `--card-fit` is 1, so rendering is pixel-identical until a card would overflow.)

- [ ] **Step 2: Add the fit block in `app.js`**

Insert immediately after the card-resize block (after the `initCardResize()` function's closing brace at line 201, before the `/* ── Pile resize ── */` comment):

```js
  /* ── Card fit (auto-shrink to the viewport; derived, never persisted) ── */
  const CARD_FIT_MIN = 0.55;
  const CARD_FIT_BOTTOM_RESERVE = 72;  /* answered pill height + 1rem inset + breathing room */
  const CARD_FIT_TOP_GAP = 16;

  function fitCardToViewport() {
    if ($cardStage.classList.contains('hidden')) return;
    $cardStage.style.setProperty('--card-fit', 1);
    const topBar = document.querySelector('.top-bar');
    const topEdge = topBar ? topBar.getBoundingClientRect().bottom : 0;
    const available = Math.max(
      window.innerHeight - topEdge - CARD_FIT_BOTTOM_RESERVE - CARD_FIT_TOP_GAP, 1);
    let fit = 1;
    /* text rewraps as the card narrows, so height responds nonlinearly — iterate to converge */
    for (let i = 0; i < 3; i++) {
      const height = $activeCard.getBoundingClientRect().height;
      if (height <= available) break;
      fit = Math.max(CARD_FIT_MIN, fit * (available / height));
      $cardStage.style.setProperty('--card-fit', fit);
      if (fit === CARD_FIT_MIN) break;
    }
  }

  let cardFitResizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(cardFitResizeTimer);
    cardFitResizeTimer = setTimeout(fitCardToViewport, 100);
  });
```

- [ ] **Step 3: Hook the two call sites in `app.js`**

`showCard()` (line ~1354) — add the call after the stage is unhidden, so measurement sees real layout. This covers draw, session-resume, and un-skip paths (all funnel through `showCard()`; the spec's `drawCard()` call site is subsumed):

```js
  function showCard() {
    $emptyState.classList.add('hidden');
    $gameOver.classList.add('hidden');
    $cardStage.classList.remove('hidden');
    fitCardToViewport();
  }
```

`setCardScale()` (line ~139) — re-fit when the manual preference changes, so preference × fit still fits:

```js
  function setCardScale(v, announce) {
    cardScale = clampCardScale(v);
    $cardStage.style.setProperty('--card-scale', cardScale);
    fitCardToViewport();
    if (announce) announceStatus(`Card size ${Math.round(cardScale * 100)}%`);
  }
```

(`fitCardToViewport` is defined before `setCardScale` runs at call time; the IIFE hoists nothing across blocks but all calls happen post-boot, matching how existing functions reference later-declared `$` refs.)

- [ ] **Step 4: Run the API test suite (regression guard)**

Run: `python3 -m unittest test_server.py`
Expected: OK (frontend-only change).

- [ ] **Step 5: Verify in a real browser**

Invoke the project `verify` skill and confirm:
- Full-size window (~1280×800), draw a card: `getComputedStyle($cardStage).getPropertyValue('--card-fit')` is 1 (or unset→1); rendering identical to before.
- With a drawn card, shrink the window (height to ~500, then ~350; width to ~500): card scales down, stays horizontally/vertically centered, top edge stays below the top bar, bottom edge stays above the answered pill (no overlap of `#answeredPill`'s bounding rect with the card's), until fit hits 0.55 — below that page scroll returns.
- Long question (pick/force a max-length question) in a ~1280×450 window: converges without visible oscillation, fits or floors.
- Drag the card's resize handle at a small window size: preference still applies but result keeps fitting; reload restores preference; `localStorage` has no fit-related key.
- Pile (empty state) rendering unaffected.
- `tools/smoke.mjs` still passes.

- [ ] **Step 6: Commit and push**

```bash
git add style.css app.js
git commit -m "feat: drawn card auto-fits the viewport"
git push
```
