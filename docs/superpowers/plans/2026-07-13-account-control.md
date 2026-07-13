# Top-left account control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, always-visible account control to the top-left of the top bar (sign-in button when signed out, email + sign-out pill when signed in), and a one-time hint nudging signed-out Supabase-backend users that their progress isn't being saved.

**Architecture:** Pure frontend change in `index.html` / `app.js` / `style.css`. No backend or `store-*.js` changes — this only relocates/adds UI driven by the existing `window.store` interface (`signedIn()`, `userEmail()`, `backend`, `onAuthChange()`, `signIn()`, `signOut()`).

**Tech Stack:** Vanilla HTML/CSS/JS, no build step. Manual browser verification (no JS unit-test framework in this repo); one assertion added to the existing Playwright smoke test (`tools/smoke.mjs`).

## Global Constraints

- No new modal — reuse the existing `#authOverlay` / `#authForm` sign-in modal as-is.
- No change to which actions require sign-in (`requireSignIn()` gating on favorites/retire/edit stays exactly as today).
- The control must render nothing on backends where `signedIn() === true && userEmail() === null` (the local/Docker `store-server.js` no-auth case) — verified via `store-server.js:81-82` (`signedIn()` always `true`, `userEmail()` always `null`).
- The persistence hint only fires when `window.store.backend === 'supabase'` and the user is signed out, at most once per page load.
- Follow existing code style: no comments except where a non-obvious constraint needs explaining (see `app.js` existing comment style, e.g. line 593, 684).

---

### Task 1: Relocate account control into the top bar

**Files:**
- Modify: `index.html:30-61` (top bar), `index.html:152-155` (remove old account-row from Packs modal)
- Modify: `app.js:555-580` (element refs, `updateAuthUI`), `app.js:914-937` (event listeners)
- Modify: `style.css:1256-1263` (account-row styles → account-control styles), `style.css:138-158` (top-bar layout)
- Test: `tools/smoke.mjs` (add one assertion)

**Interfaces:**
- Consumes: `window.store.signedIn()`, `window.store.userEmail()`, `window.store.onAuthChange(cb)`, `window.store.signIn(email)`, `window.store.signOut()` — all already defined in `store-server.js` / `store-supabase.js`, unchanged.
- Produces: `#accountControl` (container, starts with class `hidden`), `#signInBtn` (button, opens `#authOverlay`), `#accountPill` (span, wraps `#accountEmail` + `#signOutBtn`). Task 2 does not depend on these IDs directly (it opens `#authOverlay` the same way `requireSignIn()` does), so this is self-contained.

- [ ] **Step 1: Move the account markup into the top bar in `index.html`**

Remove this block (currently `index.html:152-155`, inside `#modalOverlay`):

```html
      <div class="account-row hidden" id="accountRow">
        <span class="account-email" id="accountEmail"></span>
        <button class="btn btn-ghost btn-small" id="signOutBtn">Sign out</button>
      </div>

```

Replace the `<header class="top-bar">` opening (currently `index.html:30-31`):

```html
      <header class="top-bar">
        <h1 class="title">Drawn Together</h1>
```

with:

```html
      <header class="top-bar">
        <div class="account-control hidden" id="accountControl">
          <button class="btn btn-ghost btn-small" id="signInBtn">Sign in</button>
          <span class="account-pill hidden" id="accountPill">
            <span class="account-email" id="accountEmail"></span>
            <button class="account-signout" id="signOutBtn" aria-label="Sign out" title="Sign out">&times;</button>
          </span>
        </div>
        <h1 class="title">Drawn Together</h1>
```

- [ ] **Step 2: Update CSS — replace `.account-row` rules with `.account-control` rules**

In `style.css`, replace the existing block (currently lines 1256-1263):

```css
.account-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.5rem; margin-bottom: 0.75rem; font-size: 0.875rem;
  color: var(--ink-muted);
}
.account-row.hidden { display: none; }
.account-email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn-small { padding: 0.25rem 0.75rem; font-size: 0.8125rem; }
```

with:

```css
.account-control { display: flex; align-items: center; flex-shrink: 0; }
.account-control.hidden { display: none; }
.account-pill {
  display: flex; align-items: center; gap: 0.375rem;
  font-size: 0.8125rem; color: var(--ink-muted);
  max-width: 9rem;
}
.account-pill.hidden { display: none; }
.account-email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-signout {
  display: flex; align-items: center; justify-content: center;
  width: 1.25rem; height: 1.25rem; flex-shrink: 0;
  border: none; border-radius: 50%; background: transparent;
  color: var(--ink-muted); font-size: 1rem; line-height: 1; cursor: pointer;
}
.account-signout:hover, .account-signout:focus-visible { color: var(--ink); background: var(--surface); }
.btn-small { padding: 0.25rem 0.75rem; font-size: 0.8125rem; }
```

`.top-bar` already has `justify-content: space-between; gap: 0.75rem` (`style.css:138-148`), so `#accountControl` sitting before `.title` will push the title right without further layout changes. `@media (min-width: 640px)` is at `style.css:739` — check it after this step; if `.account-pill` truncates too aggressively on narrow phones, widen `max-width` inside that query rather than removing the ellipsis rule.

- [ ] **Step 3: Wire element refs and `updateAuthUI()` in `app.js`**

Replace (currently `app.js:555-562`):

```js
  const $authOverlay  = document.getElementById('authOverlay');
  const $authClose    = document.getElementById('authClose');
  const $authForm     = document.getElementById('authForm');
  const $authEmail    = document.getElementById('authEmail');
  const $authSent     = document.getElementById('authSent');
  const $accountRow   = document.getElementById('accountRow');
  const $accountEmail = document.getElementById('accountEmail');
  const $signOutBtn   = document.getElementById('signOutBtn');
```

with:

```js
  const $authOverlay   = document.getElementById('authOverlay');
  const $authClose     = document.getElementById('authClose');
  const $authForm      = document.getElementById('authForm');
  const $authEmail     = document.getElementById('authEmail');
  const $authSent      = document.getElementById('authSent');
  const $accountControl = document.getElementById('accountControl');
  const $signInBtn     = document.getElementById('signInBtn');
  const $accountPill   = document.getElementById('accountPill');
  const $accountEmail  = document.getElementById('accountEmail');
  const $signOutBtn    = document.getElementById('signOutBtn');
```

Replace `updateAuthUI()` (currently `app.js:571-580`):

```js
  function updateAuthUI() {
    const email = window.store.userEmail();
    $accountRow.classList.toggle('hidden', !email);
    if (email) $accountEmail.textContent = email;
    /* re-pull user data whenever auth flips, then offer to resume that user's session */
    Promise.all([loadPacks(), loadMarks()]).then(() => {
      renderPacks();
      tryResumeOrStart();
    });
  }
```

with:

```js
  function updateAuthUI() {
    const email = window.store.userEmail();
    const signedIn = window.store.signedIn();
    /* local/Docker backend: signedIn() is always true with no email — no real auth, so hide the control entirely */
    $accountControl.classList.toggle('hidden', signedIn && !email);
    $signInBtn.classList.toggle('hidden', signedIn);
    $accountPill.classList.toggle('hidden', !signedIn);
    if (email) $accountEmail.textContent = email;
    /* re-pull user data whenever auth flips, then offer to resume that user's session */
    Promise.all([loadPacks(), loadMarks()]).then(() => {
      renderPacks();
      tryResumeOrStart();
    });
  }
```

- [ ] **Step 4: Add the `#signInBtn` click listener in `app.js`**

Find the existing auth event listener block (currently `app.js:923-937`, starting with `window.store.onAuthChange(updateAuthUI);`). Add this line immediately after it:

```js
  window.store.onAuthChange(updateAuthUI);
  $signInBtn.addEventListener('click', () => $authOverlay.classList.add('open'));
```

Leave the rest of that block (`$authForm` submit, `$authClose`, `$authOverlay` backdrop click, `$signOutBtn` click) unchanged — `$signOutBtn` still refers to the same ID, just relocated in the DOM.

- [ ] **Step 5: Manually verify in the browser (local/server backend)**

```bash
python3 server.py
```

Open `http://localhost:8080`. Confirm:
- `#accountControl` is not visible anywhere in the top bar (local backend has no real auth).
- Opening the Packs modal (pencil icon) no longer shows an account row — the modal starts directly with the pack list.
- Favorites/retire/edit still work without any sign-in prompt (local backend's `requireSignIn()` short-circuits via `signedIn() === true`).

- [ ] **Step 6: Add a smoke-test assertion that the control stays hidden on the server backend**

In `tools/smoke.mjs`, after the "1. Deck loaded" block (currently lines 22-23), add:

```js
// 1b. Account control hidden on server backend (no real auth)
const hidden = await page.evaluate(() =>
  document.getElementById('accountControl').classList.contains('hidden'));
if (!hidden) fail('accountControl should be hidden on server backend');
```

- [ ] **Step 7: Run the smoke test**

```bash
DATA_DIR=$(mktemp -d) PORT=8155 python3 server.py &
sleep 1
PORT=8155 node tools/smoke.mjs
kill %1
```

Expected: `SMOKE PASS` printed, no `SMOKE FAIL` lines.

- [ ] **Step 8: Commit**

```bash
git add index.html app.js style.css tools/smoke.mjs
git commit -m "feat: relocate account control to top-left of top bar"
```

---

### Task 2: One-time signed-out persistence hint (Supabase backend)

**Files:**
- Modify: `app.js:635-642` (`drawCard`)

**Interfaces:**
- Consumes: `window.store.backend` (`'server'` or `'supabase'`, defined in `store-server.js:9` / `store-supabase.js:24`), `window.store.signedIn()`, `showToast(msg, action)` (existing helper, `app.js:831`, signature `showToast(string, {label, fn})`), `$authOverlay` (from Task 1, still `document.getElementById('authOverlay')`).
- Produces: nothing consumed by later tasks — this is the final task in the plan.

- [ ] **Step 1: Add the hint flag and helper**

In `app.js`, near the other module-level game state (currently `app.js:22-30`, the `/* ── Game State ── */` block), add after `let showAllAnswered = false;`:

```js
  let persistHintShown = false;

  function maybeShowPersistHint() {
    if (persistHintShown) return;
    if (window.store.backend !== 'supabase') return;
    if (window.store.signedIn()) return;
    persistHintShown = true;
    showToast('Playing without saving — sign in to keep your progress.', {
      label: 'Sign in',
      fn: () => $authOverlay.classList.add('open'),
    });
  }
```

- [ ] **Step 2: Call it from `drawCard()`**

Replace `drawCard()` (currently `app.js:635-642`):

```js
  function drawCard() {
    if (deck.length === 0) return;
    currentCard = deck.pop();
    renderCard();
    showCard();
    updateUI();
    saveCurrentSession();
  }
```

with:

```js
  function drawCard() {
    if (deck.length === 0) return;
    currentCard = deck.pop();
    renderCard();
    showCard();
    updateUI();
    saveCurrentSession();
    maybeShowPersistHint();
  }
```

- [ ] **Step 3: Manually verify on the server backend (hint must NOT fire)**

```bash
python3 server.py
```

Open `http://localhost:8080`, draw a card. Confirm no "Playing without saving" toast appears (backend is `'server'`, not `'supabase'`, so `maybeShowPersistHint()` returns early).

- [ ] **Step 4: Manually verify on the Supabase backend (hint must fire once, signed out)**

This requires the web config. Temporarily point `config.js` at the Supabase backend to test locally:

```bash
cp config.js /tmp/config.js.bak
cp config.web.js config.js
python3 server.py
```

Open `http://localhost:8080` in a private/incognito window (to guarantee signed-out state), draw a card. Confirm:
- The toast "Playing without saving — sign in to keep your progress." appears with a "Sign in" action button.
- Clicking "Sign in" opens the `#authOverlay` modal.
- Drawing a second card does NOT show the toast again (only once per page load).

Restore the local config afterward:

```bash
cp /tmp/config.js.bak config.js
```

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: hint signed-out Supabase users that progress isn't saved"
```
