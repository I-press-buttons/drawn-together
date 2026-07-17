# Drawn card fits the viewport — design

Date: 2026-07-17

## Goal

After drawing, the question card scales down to fit the window — like the pile now does — staying centered and never intersecting the fixed answered-history pill (bottom-left) or the top bar. The user's manual card-size preference (`dt_card_scale`) still applies, relative to the fitted size.

## Current state

- `#cardStage` (`.card-stage`, style.css:428) sizes by width: `calc(100% * var(--card-scale, 1))`, `max-width: 92vw`; `.card-question` font is `calc(clamp(1.25rem, 1.2vw + 1rem, 2rem) * var(--card-scale, 1))` (style.css:523). Card height is content-driven — question text wraps, so height varies per question and per width.
- `.top-bar` is in-flow above `.main`; `.corner-pills` is `position: fixed; left: 1rem; bottom: 1rem` (style.css:713). A tall card makes the page scroll: the card slides under the pill and the top bar scrolls away.
- The pile precedent (commits `4b9d5d8`/`82f160b`): viewport-capped base size, user scale multiplies the fitted base, floor below which scroll is accepted.

## Design

CSS cannot predict the card's height (text rewraps as width changes), so a JS-measured fit factor drives the scaling.

### app.js — `fitCardToViewport()`

New function near the card-scale block:

1. If `$cardStage` is hidden, do nothing.
2. Set `--card-fit` to 1 on `$cardStage` (inline), force a layout read.
3. Available height = `window.innerHeight` − bottom of `.top-bar`'s bounding rect − bottom reserve (72px: pill height + its 1rem inset + breathing room) − 16px top gap.
4. factor = available / card rendered height; if ≥ 1, leave fit at 1. Otherwise apply `--card-fit = factor`, then re-measure and refine up to 2 more iterations (text rewrap changes height nonlinearly).
5. Clamp final factor to [0.55, 1]. Below 0.55 the card stops shrinking and normal page scroll takes over (readability floor, mirroring the pile's 140px floor).

Call sites:

- `drawCard()` — immediately after the card content is rendered. Measuring during the enter animation is safe: `animate-in` only animates opacity/transform, which don't affect layout size.
- `window.addEventListener('resize', ...)` — debounced ~100ms.
- `setCardScale()` — manual resize interacts with fit: the preference multiplies the fitted base, and changing it re-runs the fit so the result still fits.

`--card-fit` is derived state: never persisted. Only `dt_card_scale` persists, unchanged.

### style.css

Multiply the existing `--card-scale` usages by `var(--card-fit, 1)`:

- `.card-stage` width: `calc(100% * var(--card-scale, 1) * var(--card-fit, 1))`.
- `.card-question` font-size: `calc(clamp(1.25rem, 1.2vw + 1rem, 2rem) * var(--card-scale, 1) * var(--card-fit, 1))`.
- `.card` padding: multiply each `clamp()` term by `var(--card-fit, 1)` so vertical proportions shrink with the card (padding currently ignores `--card-scale`; it gains only the fit multiplier — the manual preference keeps its existing semantics).

Default `--card-fit: 1` means zero visual change until a card would overflow.

## Non-goals / constraints

- No HTML changes; no new elements. No backend/store impact. No persistence of the fit factor.
- No new animation (reduced-motion posture unchanged). Fit changes apply instantly.
- Zero dependencies; vanilla JS/CSS only.
- No new `.hidden` toggles.

## Error handling

- Guard against zero/negative available height (very short windows): the [0.55, 1] clamp covers it; factor computed from `Math.max(available, 1)`.
- If `.top-bar` is missing from the DOM (never expected), fall back to 0 for its bottom edge.

## Testing / verification

- `python3 -m unittest test_server.py` stays green (frontend-only).
- Browser (project `verify` skill):
  - Draw a card at full size: no visual change vs today (fit = 1).
  - Shrink window (height and width) with a drawn card: card scales down, stays centered, never overlaps the answered pill or top bar, down to the 0.55 floor; below the floor, page scroll returns.
  - Long question (max wrap) in a small window: converges (no oscillation), fits or hits floor.
  - Manual resize handle still works; preference persists; reload restores; pile unaffected.
  - `tools/smoke.mjs` passes.
