---
name: verify
description: Build/launch/drive recipe for verifying Drawn Together changes in a real browser against the local server backend
---

# Verifying Drawn Together in the browser

## Launch

No build step. Start the server with a **clean temp DATA_DIR and a fresh port**
(stale servers from earlier runs linger — check `lsof -nP -iTCP:<port>` before
blaming your change; never reuse a port another server answered on):

```sh
DATA_DIR=$(mktemp -d) PORT=8179 python3 server.py
```

## Drive

Playwright is NOT installed in the repo. Install it in the session scratchpad
(`npm i playwright`, chromium usually already cached), then point the repo
harness at it:

```sh
PORT=8179 PLAYWRIGHT_DIR=<scratchpad-abs-path> node tools/smoke.mjs   # baseline regression
```

For feature scripts, reuse `tools/smoke.mjs`'s createRequire(PLAYWRIGHT_DIR)
preamble and selector style.

## Gotchas

- **Creating a pack auto-expands it** (`openPackId = pack.id` in the
  `#newPackForm` submit handler). An "expand" helper must check for
  `.pack-header[data-pack-id="N"] + .pack-body.open` first or it will
  collapse the pack instead.
- Only one pack is open at a time; scope form fills to `.pack-body.open ...`.
- Adding a question does NOT put its card in the live deck. To inject a
  pack's cards deterministically, toggle the pack off then on
  (`[data-toggle="N"]` twice) and watch `#remainingCount`.
- Server pack/question ids are small ints assigned per pack: first pack is
  id 1, its questions 1, 2, ... — qkeys are `p<packId>-<qid>`.
- Marks can be seeded without UI: `POST /api/marks/favorites/p1-1` (reload
  the page afterward so the app picks them up).
- Server state persists across page reloads (session resume) — a "clean"
  check needs a fresh DATA_DIR, not just a reload.
