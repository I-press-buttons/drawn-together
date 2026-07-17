# Clickable, resizable card pile — design

Date: 2026-07-17

## Goal

The card pile in the middle of the draw screen becomes a real draw affordance:

1. Clicking the pile draws a card (the existing "Draw a Card" button stays as-is).
2. The pile's default size roughly doubles.
3. The pile gets a manual corner resize handle whose setting persists across sessions, independent of the drawn card's size setting.

## Current state

- The pile is `.deck-illustration` in `index.html` — a decorative `aria-hidden` div holding three stacked `.deck-card` divs, sized ~140–200px wide via `clamp()` in `style.css`.
- The drawn card already has the target resize pattern (`app.js` lines ~129–201): a corner handle (`#cardResizeHandle`) drives a `--card-scale` CSS variable via pointer drag, arrow keys, and double-click reset; the value persists in localStorage as `dt_card_scale`.

## Design

Mirror the card-resize pattern rather than refactoring a shared helper — the drag logic is short and a parallel copy is lower risk.

### index.html

- `.deck-illustration` becomes `<button type="button" class="deck-illustration" id="pileBtn" aria-label="Draw a card">`. The inner `.deck-card` divs stay decorative (`aria-hidden` moves to them or a wrapper).
- Add `#pileResizeHandle`, a small button at the pile's bottom-right corner, same markup pattern as `#cardResizeHandle` (focusable, labeled, e.g. "Resize pile").

### style.css

- Double the pile's base dimensions: roughly `width: clamp(280px, 20vw + 200px, 400px)` and matching height; inner `.deck-card` sizes doubled to match.
- All pile dimensions multiplied by `var(--pile-scale, 1)` via `calc()` (same technique as the card's `--card-scale`).
- Button reset styles on `.deck-illustration` (no default border/background/padding), pointer cursor, visible focus ring, subtle hover/active lift gated by `prefers-reduced-motion`.
- No new `.hidden` toggles (the pile lives inside `.empty-state`, which already has a scoped rule), so the no-generic-`.hidden` gotcha doesn't bite.

### app.js

- `#pileBtn` click invokes the same handler as `#drawBtn`.
- New constants `PILE_SCALE_MIN = 0.5`, `PILE_SCALE_MAX = 1.5`, step 0.05; functions `setPileScale`, `persistPileScale`, `loadPileScale` (localStorage key `dt_pile_scale`), and `initPileResize` — a straight parallel of the card versions including `announceStatus`, keyboard arrows/+/-, Enter and double-click reset to 1.
- Scale 1 = the new doubled default size.

### Persistence

localStorage, matching `dt_card_scale` and `dt-background`. No store/server changes.

## Error handling

- Invalid/missing stored scale falls back to 1 (same `parseFloat`/`isNaN` guard as the card).
- Values clamped to [0.5, 1.5] on load and on every change.

## Testing / verification

- `python3 -m unittest test_server.py` (should be untouched — frontend-only change).
- Browser smoke test (`tools/smoke.mjs`) still passes; it clicks `#drawBtn`, which remains.
- Manual verification via the project `verify` skill: click pile draws a card; drag/keyboard resize works; reload restores size; focus ring visible; reduced-motion respected.
