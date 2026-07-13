# Sign-in First + Pack Editor Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Supabase backend, open the sign-in overlay at boot for signed-out users (replacing the after-first-draw toast), and gate the "+ New Pack" control behind sign-in with a clear inline prompt.

**Architecture:** Two small, independent changes to the existing vanilla-JS app. (1) The boot IIFE at the bottom of `app.js` auto-opens the existing `#authOverlay` once when `store.backend === 'supabase' && !store.signedIn()`; the `maybeShowPersistHint()` toast and its `persistHintShown` flag are deleted. (2) A static `#packGate` block in the packs modal replaces `#newPackBtn` when signed out on Supabase; a new `updatePackGate()` in `app.js` toggles between them and is re-run from `renderPacks()`, which `updateAuthUI()` already calls on every auth change, so the control flips live on sign-in/sign-out.

**Tech Stack:** Vanilla JS (`app.js`), static HTML (`index.html`), plain CSS (`style.css`). Backends: `store-supabase.js` (real auth) and `store-server.js` (`signedIn()` always `true`, `backend: 'server'`). No JS test framework exists in this repo — verification is manual in the browser, per the spec's Testing section.

**Spec:** `docs/superpowers/specs/2026-07-13-signin-first-design.md`

## Global Constraints

- Supabase-backend only: every new gate/prompt must be inert when `window.store.backend !== 'supabase'` (local/Docker backend has `signedIn()` always `true`, so guarding on `signedIn()` alone is sufficient — but keep behavior identical on the server backend).
- Sign-in stays optional: the auto-opened overlay must remain dismissible via the existing close button, backdrop click, and Escape handlers (`app.js:956-959`, `app.js:1038-1040`) with no changes to them.
- Gate copy (verbatim from spec): "Sign in to create and edit question packs" with a "Sign in" button.
- Do not touch `signIn`/`signInWithOtp`, RLS/schema, favorites/retire gating (`$favBtn`/`$retireBtn` handlers), or the account-control work (`updateAuthUI` / `#accountControl`) beyond the two additions this plan names explicitly.
- Do not remove `requireSignIn()` itself — `$favBtn` (app.js:882) and `$retireBtn` (app.js:895) still use it.

## Pre-existing context an implementer needs

- `window.store.ready()` resolves after `client.auth.getSession()` returns (`store-supabase.js:11-15`), so `store.signedIn()` is accurate immediately after `await window.store.ready()` in the boot IIFE.
- `window.store.onAuthChange(updateAuthUI)` is already wired (`app.js:948`). `updateAuthUI()` (`app.js:585-601`) re-runs `renderPacks()` on every auth change — that is the hook that makes the pack gate flip without a reload.
- The packs modal is currently unreachable while signed out on Supabase: the `$editBtn` handler (`app.js:938-941`) calls `requireSignIn()` before `openModal()`. The spec's testing section requires a signed-out user to open Packs and see the gate ("Signed out, open Packs → '+ New Pack' replaced by sign-in prompt"), so Task 2 changes `$editBtn` to open the modal directly; the gating moves inside the modal onto the "+ New Pack" control. Signed-out users see only the Base Game card and empty Greatest Hits there (`loadPacks()`/`loadMarks()` return empty when signed out — spec Problem section confirms this).
- `.hidden` is **not** a global utility class in `style.css` — each use has its own scoped rule (e.g. `.auth-note.hidden { display: none; }` at `style.css:1255`). New hidden-toggled elements need their own CSS rules.

---

### Task 1: Boot-time sign-in prompt (replace the toast)

**Files:**
- Modify: `app.js:31` (delete `persistHintShown`), `app.js:33-42` (delete `maybeShowPersistHint`), `app.js:663` (delete call in `drawCard`), `app.js:585-601` (`updateAuthUI` — close overlay on sign-in), `app.js:1090-1099` (boot IIFE — auto-open)
- Modify: `index.html:192-193` (stale "invite-only" copy in the auth sheet)

**Interfaces:**
- Consumes: `window.store.ready()`, `window.store.backend`, `window.store.signedIn()`, `$authOverlay` (all existing).
- Produces: nothing new — Task 2 does not depend on Task 1.

- [ ] **Step 1: Delete the persist-hint toast**

In `app.js`, delete the flag at line 31:

```js
  let persistHintShown = false;
```

Delete the whole function at lines 33-42:

```js
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

And delete its only call site, the last line of `drawCard()` (app.js:663):

```js
    maybeShowPersistHint();
```

Then confirm nothing references them anymore:

Run: `grep -n "maybeShowPersistHint\|persistHintShown" app.js`
Expected: no output.

(Leave `showToast` itself untouched — `retireCurrentCard()` and others still use it, including the `action` parameter.)

- [ ] **Step 2: Auto-open the auth overlay at boot when signed out on Supabase**

In the boot IIFE at the bottom of `app.js`, add the auto-open immediately after `await window.store.ready()`. The block currently reads (app.js:1092-1099):

```js
  (async () => {
    await loadQuestions();
    await window.store.ready();
    await Promise.all([loadPacks(), loadMarks()]);
    await tryResumeOrStart();
    toggleScore(true);
    updateDeckCount();
  })();
```

Change it to:

```js
  (async () => {
    await loadQuestions();
    await window.store.ready();
    /* Sign-in is the first thing a signed-out web user sees (dismissible — anonymous play still works) */
    if (window.store.backend === 'supabase' && !window.store.signedIn()) {
      $authOverlay.classList.add('open');
    }
    await Promise.all([loadPacks(), loadMarks()]);
    await tryResumeOrStart();
    toggleScore(true);
    updateDeckCount();
  })();
```

This is the same open mechanism `$signInBtn`'s click handler uses (app.js:949). The existing close button (app.js:956), backdrop click (app.js:957-959), and Escape handler (app.js:1038-1040) already dismiss it — no changes needed there. It only auto-opens once, at boot, so no re-show flag is needed.

- [ ] **Step 3: Close the overlay when auth flips to signed-in**

Supabase's `onAuthStateChange` can fire `SIGNED_IN` after boot in the same tab (e.g. magic-link tokens processed from the URL just after `getSession()` resolved). If the overlay auto-opened in that window, it would sit open over a signed-in app. Close it in `updateAuthUI()` (app.js:585). Add one line right after the `signedIn` const:

```js
  function updateAuthUI() {
    const email = window.store.userEmail();
    const signedIn = window.store.signedIn();
    if (signedIn) $authOverlay.classList.remove('open');
```

(The rest of `updateAuthUI` — account-control toggling, `loadPacks`/`loadMarks`/`renderPacks`/`tryResumeOrStart` — is existing account-control work; do not modify it.)

- [ ] **Step 4: Fix the stale "invite-only" copy in the auth sheet**

The overlay is now the first thing new users see, and the spec's Goal 1 is self-serve signup ("Anyone with the app link can sign up by simply entering their email"); Goal 3 keeps sign-in skippable. The current note (`index.html:192-193`) contradicts both:

```html
      <p class="auth-note">Enter your email and we'll send you a sign-in link.
        Accounts are invite-only.</p>
```

Replace with:

```html
      <p class="auth-note">Enter your email and we'll send you a sign-in link —
        new here, it creates your account. Or close this to play without saving
        your progress.</p>
```

- [ ] **Step 5: Manually verify (Supabase backend)**

Temporarily point the local config at Supabase: copy the web config over the local one for the test session (`config.js` currently sets `window.DT_BACKEND = 'server'`; `config.web.js` has the Supabase settings). Serve the directory statically (e.g. `python3 -m http.server 8000`) and open `http://localhost:8000`. Do **not** commit any `config.js` change.

Check, signed out:
1. Fresh load → auth overlay opens automatically, showing the new copy.
2. Dismiss via Escape, then reload and dismiss via backdrop click, then reload and dismiss via the × button — all three work.
3. After dismissing, draw/answer/skip cards works; **no toast** ever appears about saving.
4. Reload → overlay auto-opens again (once per load is expected).

Check, signed in (use a real magic link, or verify from an existing session): fresh load → overlay does **not** open.

- [ ] **Step 6: Manually verify no change on the server backend**

Restore `config.js` to `window.DT_BACKEND = 'server'`, run the local server (`python3 server.py`), open the app: overlay never auto-opens, no toast, gameplay unchanged.

- [ ] **Step 7: Commit**

```bash
git add app.js index.html
git commit -m "feat: open sign-in sheet at boot for signed-out web users, drop persist-hint toast"
```

---

### Task 2: Gate "+ New Pack" behind sign-in

**Files:**
- Modify: `index.html:162-173` (add `#packGate` next to `#newPackBtn`/`#newPackForm`)
- Modify: `style.css` (rules for `.pack-gate` and the hidden states — `.hidden` is scoped per selector in this stylesheet, so new rules are required)
- Modify: `app.js` — DOM consts (~line 564), `renderPacks()` tail (app.js:415-416), `$editBtn` handler (app.js:938-941), new-pack listeners (app.js:965-969), new `updatePackGate()` + gate button wiring

**Interfaces:**
- Consumes: `window.store.backend`, `window.store.signedIn()`, `$authOverlay`, `renderPacks()`, `updateAuthUI()`'s existing `renderPacks()` call on auth change (app.js:597-600).
- Produces: `updatePackGate()` — no args, no return; reads auth state and toggles `#newPackBtn` / `#newPackForm` / `#packGate`. Called only from `renderPacks()`.

- [ ] **Step 1: Add the gate markup to `index.html`**

In the packs modal, directly above the `#newPackBtn` button (index.html:162-165), add the gate block. The section becomes:

```html
      <!-- Sign-in gate shown in place of the new-pack controls when signed out (web backend) -->
      <div class="pack-gate hidden" id="packGate">
        <p class="pack-gate-text">Sign in to create and edit question packs</p>
        <button class="btn btn-ghost" id="packGateSignInBtn" type="button">Sign in</button>
      </div>

      <!-- New pack button -->
      <button class="btn btn-ghost" id="newPackBtn" style="width:100%;margin-top:0.75rem">
        + New Pack
      </button>
```

(`#newPackForm` below it is unchanged; it already boots with `style="display:none"`.)

- [ ] **Step 2: Style the gate in `style.css`**

Append near the other pack styles (or after the `.auth-note` rules at style.css:1254-1255):

```css
/* Sign-in gate replacing "+ New Pack" when signed out (web backend) */
.pack-gate {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding: 0.75rem;
  border: 1px dashed var(--border);
  border-radius: 0.75rem;
  text-align: center;
}
.pack-gate.hidden { display: none; }
.pack-gate-text { color: var(--ink-muted); font-size: 0.875rem; margin: 0; }
#newPackBtn.hidden { display: none; }
```

(Check that `--border` and `--ink-muted` exist in `style.css`'s custom properties; `--ink-muted` is used by `.auth-note` at line 1254. If `--border` doesn't exist, use whatever border-color variable the modal's `.pack-card` uses.)

- [ ] **Step 3: Add DOM consts and `updatePackGate()` in `app.js`**

In the DOM const block, after `$newPackName` (app.js:565), add:

```js
  const $newPackBtn  = document.getElementById('newPackBtn');
  const $packGate    = document.getElementById('packGate');
  const $packGateSignInBtn = document.getElementById('packGateSignInBtn');
```

Define `updatePackGate()` next to `renderPacks()` (e.g. just above it, app.js:288):

```js
  /* Signed out on the web backend: replace "+ New Pack" with a sign-in prompt.
     Server backend: signedIn() is always true, so the gate never shows. */
  function updatePackGate() {
    const gated = window.store.backend === 'supabase' && !window.store.signedIn();
    $newPackBtn.classList.toggle('hidden', gated);
    $packGate.classList.toggle('hidden', !gated);
    if (gated) $newPackForm.style.display = 'none';
  }
```

Call it at the end of `renderPacks()` (app.js:415-416), so it re-evaluates on every pack re-render — including the `renderPacks()` that `updateAuthUI()` fires on each auth change, which is what flips the control immediately on sign-in/sign-out without a reload:

```js
    container.innerHTML = html;
    bindPackEvents();
    updatePackGate();
  }
```

- [ ] **Step 4: Wire the gate's Sign in button and switch existing listeners to the new consts**

With the auth event listeners (near app.js:949), add — same trigger as `$signInBtn`:

```js
  $packGateSignInBtn.addEventListener('click', () => $authOverlay.classList.add('open'));
```

And replace the inline lookups in the new-pack toggle listener (app.js:965-969):

```js
  document.getElementById('newPackBtn').addEventListener('click', () => {
    const form = document.getElementById('newPackForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (form.style.display === 'block') document.getElementById('newPackName').focus();
  });
```

becomes:

```js
  $newPackBtn.addEventListener('click', () => {
    $newPackForm.style.display = $newPackForm.style.display === 'none' ? 'block' : 'none';
    if ($newPackForm.style.display === 'block') $newPackName.focus();
  });
```

- [ ] **Step 5: Let signed-out users open the packs modal**

The gate is unreachable while `$editBtn` blocks the whole modal. The spec's testing section requires "Signed out, open Packs → '+ New Pack' replaced by sign-in prompt", so revert the handler (app.js:938-941) to open directly:

```js
  $editBtn.addEventListener('click', () => {
    if (!requireSignIn()) return;
    openModal();
  });
```

becomes:

```js
  $editBtn.addEventListener('click', openModal);
```

Keep `requireSignIn()` itself — `$favBtn` (app.js:882) and `$retireBtn` (app.js:895) still call it. A signed-out visitor now sees the modal with the Base Game card, an empty Greatest Hits section, and the gate; there is nothing editable because `loadPacks()`/`loadMarks()` return empty when signed out.

- [ ] **Step 6: Manually verify (Supabase backend)**

Same Supabase-pointed `config.js` setup as Task 1 Step 5 (do not commit the config change). Check:

1. Signed out, click the pencil (Edit questions) button → packs modal opens (no auth overlay hijack).
2. In the modal: "+ New Pack" is hidden; the gate shows "Sign in to create and edit question packs" with a Sign in button. The `#newPackForm` is not visible. Export/Import buttons are still visible below (out of scope — harmless with zero packs).
3. Click the gate's Sign in button → auth overlay opens on top.
4. Sign in via magic link → after redirect, open Packs → "+ New Pack" shows, gate hidden; create a pack → toast `"<name>" pack created` and the pack appears.
5. With the packs modal still open, sign out (× on the account pill) → the modal's control flips back to the gate without a reload (via `updateAuthUI` → `renderPacks` → `updatePackGate`).

- [ ] **Step 7: Manually verify no change on the server backend**

Restore `config.js` to `window.DT_BACKEND = 'server'`, run `python3 server.py`, open the app → packs modal opens from the pencil button as before, "+ New Pack" always visible, gate never shows, pack creation works.

- [ ] **Step 8: Commit**

```bash
git add index.html style.css app.js
git commit -m "feat: gate + New Pack behind sign-in on the web backend"
```

---

### Task 3: Full spec-checklist verification pass

**Files:** none (verification only; fix-forward in `app.js`/`index.html`/`style.css` if a check fails).

**Interfaces:** consumes everything from Tasks 1-2.

- [ ] **Step 1: Run the spec's complete Testing checklist end-to-end**

With `config.js` pointed at Supabase (uncommitted), verify every line of the spec's Testing section in one session:

- Fresh signed-out load → auth overlay opens automatically.
- Dismiss it (Escape / backdrop / close button) → can still draw, answer, and skip cards; progress not saved; no toast appears later.
- Reload while signed out → overlay opens again.
- Signed out, open Packs → "+ New Pack" replaced by the sign-in prompt; clicking its Sign in button opens the same overlay.
- Sign in → overlay closes on redirect, "+ New Pack" control shown, pack creation works normally.
- Sign out → "+ New Pack" reverts to the sign-in prompt.

Then restore `config.js` to the server backend and verify: overlay never auto-opens, "+ New Pack" always shown, no gate.

- [ ] **Step 2: Confirm the working tree is clean of test scaffolding**

Run: `git status --short`
Expected: empty (in particular, `config.js` must show no diff).

No commit — this task produces no changes unless a fix was needed (commit any fix as `fix: <what>`).

---

## Self-review notes

- **Spec coverage:** Design §1 (boot prompt, toast removal, dismissibility) → Task 1 Steps 1-3; Design §2 (gate + copy + auth-change re-render) → Task 2 Steps 1-5; Goals 1/3 (self-serve + skippable messaging) → Task 1 Step 4; spec Testing section → Task 1 Steps 5-6, Task 2 Steps 6-7, Task 3. Non-goals respected: no `signIn`/RLS/favorites/retire changes.
- **Out-of-spec decisions made explicit:** (a) `$editBtn` un-gating (Task 2 Step 5) — required for the spec's own test line to be satisfiable; (b) `updateAuthUI` overlay-close (Task 1 Step 3) — defensive, matches spec's "overlay closes on redirect" expectation; (c) auth-note copy (Task 1 Step 4) — stale "invite-only" text contradicts spec Goal 1.
- **Naming consistency:** `updatePackGate`, `$packGate`, `$packGateSignInBtn`, `$newPackBtn` used identically across steps.
