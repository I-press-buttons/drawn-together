# Email + Password Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace magic-link (`signInWithOtp`) sign-in on the Supabase (web) backend with email + password auth, including self-serve sign-up and a forgot-password reset flow.

**Architecture:** `store-supabase.js` gets four auth functions (`signIn`, `signUp`, `requestPasswordReset`, `updatePassword`) replacing the single `signIn(email, captchaToken)`, all returning `null` on success or `error.message` on failure so `app.js` can toast it. `index.html`'s `#authOverlay` modal gains a sign-in/sign-up mode toggle, a forgot-password link, and a hidden `#resetPasswordForm` panel shown on the `PASSWORD_RECOVERY` auth event. No test framework exists in this repo (static site, no `package.json`); verification is manual, done locally against the real Supabase project before publishing.

**Tech Stack:** Vanilla JS, Supabase JS client (`vendor/supabase.js`), static HTML/CSS, Python static file server (`server.py`) for local testing.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-password-auth-design.md` (read before starting — this plan implements it exactly).
- No confirmation email on sign-up — requires the manual Supabase dashboard change called out in the spec (Task 0 below reminds the human to do this; an agent cannot).
- All three write paths (`signIn`, `signUp`, `requestPasswordReset`) must surface `error.message` via `showToast`, permanently (not temporary debug logging).
- No changes to `store-server.js` (local/Docker backend) — it has no real auth and is out of scope.
- No admin dashboard UI — out of scope.
- Local testing must never touch the public GitHub Pages deployment or push to `origin/main` — only the anonymized publish flow (documented in project memory) may do that, and only after the human confirms local testing passed.

---

### Task 0: Manual prerequisite reminder (human, not an agent step)

Before Task 3's sign-up test can pass, a human must go to the Supabase dashboard for project `wajjncluitygfatocbba` → **Authentication → Providers → Email** → turn OFF **"Confirm email"**. This cannot be scripted. If whoever is executing this plan is an agent, stop after Task 1 and ask the human to confirm this toggle is off before proceeding to Task 3's sign-up verification step.

---

### Task 1: `store-supabase.js` — new auth API surface

**Files:**
- Modify: `store-supabase.js:16-19` (auth state change propagation), `store-supabase.js:116-126` (replace `signIn`)

**Interfaces:**
- Produces: `store.signIn(email, password, captchaToken) → Promise<string|null>`, `store.signUp(email, password, captchaToken) → Promise<string|null>`, `store.requestPasswordReset(email, captchaToken) → Promise<string|null>`, `store.updatePassword(newPassword) → Promise<string|null>`. All four return `null` on success, `error.message` (a user-displayable string) on failure.
- Produces: `store.onAuthChange(cb)` now invokes `cb(event)` where `event` is the raw Supabase auth event string (e.g. `'SIGNED_IN'`, `'PASSWORD_RECOVERY'`, `'SIGNED_OUT'`) — existing callback `updateAuthUI` in `app.js` ignores extra args so this is backward compatible.

- [ ] **Step 1: Update auth state propagation to pass the event through**

In `store-supabase.js`, replace:

```js
  client.auth.onAuthStateChange((_event, s) => {
    session = s;
    authCallbacks.forEach(cb => cb());
  });
```

with:

```js
  client.auth.onAuthStateChange((event, s) => {
    session = s;
    authCallbacks.forEach(cb => cb(event));
  });
```

- [ ] **Step 2: Replace `signIn` with the four-function auth API**

Replace:

```js
    async signIn(email, captchaToken) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname,
          captchaToken,
        },
      });
      if (error) console.error('[signIn] signInWithOtp error:', error.status, error.message, error);
      return !error;
    },
    async signOut() { await client.auth.signOut(); },
```

with:

```js
    async signIn(email, password, captchaToken) {
      const { error } = await client.auth.signInWithPassword({
        email, password,
        options: { captchaToken },
      });
      if (error) console.error('[signIn] signInWithPassword error:', error.status, error.message);
      return error ? error.message : null;
    },
    async signUp(email, password, captchaToken) {
      const { error } = await client.auth.signUp({
        email, password,
        options: { captchaToken },
      });
      if (error) console.error('[signUp] signUp error:', error.status, error.message);
      return error ? error.message : null;
    },
    async requestPasswordReset(email, captchaToken) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
        captchaToken,
      });
      if (error) console.error('[requestPasswordReset] error:', error.status, error.message);
      return error ? error.message : null;
    },
    async updatePassword(newPassword) {
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) console.error('[updatePassword] error:', error.status, error.message);
      return error ? error.message : null;
    },
    async signOut() { await client.auth.signOut(); },
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check store-supabase.js`
Expected: no output (exit code 0)

- [ ] **Step 4: Commit**

```bash
git add store-supabase.js
git commit -m "feat: replace magic-link auth with email+password auth API"
```

---

### Task 2: `index.html` — auth modal gains sign-in/sign-up modes and password reset panel

**Files:**
- Modify: `index.html:190-211` (the `#authOverlay` block)

**Interfaces:**
- Produces DOM ids that Task 3 wires up: `#authTitle`, `#authNote`, `#authPassword`, `#authConfirmGroup`, `#authConfirmPassword`, `#authModeToggle`, `#authSubmitBtn`, `#authForgotLink`, `#authSent`, `#resetPasswordOverlay`, `#resetPasswordForm`, `#resetPasswordInput`, `#resetPasswordError`.
- Consumes: existing `.modal-overlay`, `.modal-sheet`, `.auth-sheet`, `.modal-handle`, `.modal-header`, `.modal-title`, `.modal-close`, `.form-group`, `.form-input`, `.btn-add`, `.auth-note`, `.hidden` CSS classes already defined elsewhere in the stylesheet — reuse them, do not add new CSS.

- [ ] **Step 1: Replace the `#authOverlay` block**

Replace the entire block (lines 190-211):

```html
  <!-- Sign-in (web version only) -->
  <div class="modal-overlay" id="authOverlay">
    <div class="modal-sheet auth-sheet">
      <div class="modal-handle" aria-hidden="true"></div>
      <div class="modal-header">
        <h2 class="modal-title">Sign in</h2>
        <button class="modal-close" id="authClose" aria-label="Close">&times;</button>
      </div>
      <p class="auth-note">Enter your email and we'll send you a sign-in link —
        new here, it creates your account. Or close this to play without saving
        your progress.</p>
      <form id="authForm" autocomplete="email">
        <div class="form-group" style="margin-bottom:0.5rem">
          <input class="form-input" id="authEmail" type="email" placeholder="you@example.com" required>
        </div>
        <div id="authCaptcha" style="margin-bottom:0.5rem"></div>
        <p class="auth-note hidden" id="authCaptchaError">Verification didn't load — if you use an ad blocker or privacy extension, please disable it for this site and reload the page.</p>
        <button class="btn-add" type="submit">Send magic link</button>
      </form>
      <p class="auth-note hidden" id="authSent">Check your email — the link signs you in here.</p>
    </div>
  </div>
```

with:

```html
  <!-- Sign-in / sign-up (web version only) -->
  <div class="modal-overlay" id="authOverlay">
    <div class="modal-sheet auth-sheet">
      <div class="modal-handle" aria-hidden="true"></div>
      <div class="modal-header">
        <h2 class="modal-title" id="authTitle">Sign in</h2>
        <button class="modal-close" id="authClose" aria-label="Close">&times;</button>
      </div>
      <p class="auth-note" id="authNote">Sign in to save your progress. Or close
        this to play without saving.</p>
      <form id="authForm" autocomplete="on">
        <div class="form-group" style="margin-bottom:0.5rem">
          <input class="form-input" id="authEmail" type="email" placeholder="you@example.com" autocomplete="email" required>
        </div>
        <div class="form-group" style="margin-bottom:0.5rem">
          <input class="form-input" id="authPassword" type="password" placeholder="Password" autocomplete="current-password" required minlength="6">
        </div>
        <div class="form-group hidden" id="authConfirmGroup" style="margin-bottom:0.5rem">
          <input class="form-input" id="authConfirmPassword" type="password" placeholder="Confirm password" autocomplete="new-password" minlength="6">
        </div>
        <div id="authCaptcha" style="margin-bottom:0.5rem"></div>
        <p class="auth-note hidden" id="authCaptchaError">Verification didn't load — if you use an ad blocker or privacy extension, please disable it for this site and reload the page.</p>
        <button class="btn-add" type="submit" id="authSubmitBtn">Sign in</button>
      </form>
      <p class="auth-note" style="margin-top:0.5rem">
        <a href="#" id="authModeToggle">Need an account? Sign up</a>
        &nbsp;·&nbsp;
        <a href="#" id="authForgotLink">Forgot password?</a>
      </p>
      <p class="auth-note hidden" id="authSent">Check your email — click the link to reset your password.</p>
    </div>
  </div>

  <!-- Set new password (shown after clicking a password-reset email link) -->
  <div class="modal-overlay" id="resetPasswordOverlay">
    <div class="modal-sheet auth-sheet">
      <div class="modal-handle" aria-hidden="true"></div>
      <div class="modal-header">
        <h2 class="modal-title">Set new password</h2>
      </div>
      <p class="auth-note">Enter a new password for your account.</p>
      <form id="resetPasswordForm" autocomplete="off">
        <div class="form-group" style="margin-bottom:0.5rem">
          <input class="form-input" id="resetPasswordInput" type="password" placeholder="New password" autocomplete="new-password" required minlength="6">
        </div>
        <button class="btn-add" type="submit">Set password</button>
      </form>
      <p class="auth-note hidden" id="resetPasswordError"></p>
    </div>
  </div>
```

- [ ] **Step 2: Verify the file has no unclosed tags around the edit**

Run: `python3 -c "import re,sys; s=open('index.html').read(); print('authOverlay count:', s.count('id=\"authOverlay\"')); print('resetPasswordOverlay count:', s.count('id=\"resetPasswordOverlay\"'))"`
Expected: `authOverlay count: 1` and `resetPasswordOverlay count: 1`

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add sign-up mode and password-reset panel to auth modal"
```

---

### Task 3: `app.js` — wire up sign-in/sign-up modes, forgot-password, and recovery flow

**Files:**
- Modify: `app.js:570-619` (DOM refs and Turnstile lifecycle — remove temporary debug logging, keep the widget-init bug fix), `app.js:625-629` (`requireSignIn`, no change needed but confirm it still calls `ensureTurnstileWidget()`), `app.js:990-1004` (auth form event listeners — full rewrite), `app.js:1149-1151` (boot-time auto-open — no change needed, already calls `ensureTurnstileWidget()`)

**Interfaces:**
- Consumes: `store.signIn(email, password, captchaToken)`, `store.signUp(email, password, captchaToken)`, `store.requestPasswordReset(email, captchaToken)`, `store.updatePassword(newPassword)` — all `Promise<string|null>`, from Task 1. `store.onAuthChange(cb)` now calls `cb(event)`.
- Consumes: `#authTitle`, `#authNote`, `#authPassword`, `#authConfirmGroup`, `#authConfirmPassword`, `#authModeToggle`, `#authSubmitBtn`, `#authForgotLink`, `#authSent`, `#resetPasswordOverlay`, `#resetPasswordForm`, `#resetPasswordInput`, `#resetPasswordError` from Task 2.
- Consumes: existing `showToast(msg)` (app.js:904).

- [ ] **Step 1: Remove temporary Turnstile debug logging, keep the widget-init logic**

In `app.js`, in `ensureTurnstileWidget()`, remove the `console.debug(...)` calls added for diagnosis (the bug they diagnosed — missing `ensureTurnstileWidget()` calls on two modal-open paths — is already fixed). Replace:

```js
  function ensureTurnstileWidget() {
    console.debug('[turnstile] ensureTurnstileWidget called', { siteKey: window.TURNSTILE_SITE_KEY, widgetId: turnstileWidgetId, hasTurnstile: !!window.turnstile, loadFailed: !!window.__turnstileLoadFailed });
    if (!window.TURNSTILE_SITE_KEY || turnstileWidgetId !== null) return;
    if (window.turnstile) {
      clearInterval(turnstilePollTimer);
      $authCaptchaError.classList.add('hidden');
      turnstileWidgetId = window.turnstile.render($authCaptcha, {
        sitekey: window.TURNSTILE_SITE_KEY,
        callback: (token) => { console.debug('[turnstile] token received', token && token.slice(0, 12) + '…'); turnstileToken = token; },
        'expired-callback': () => { console.debug('[turnstile] token expired'); turnstileToken = null; },
        'error-callback': (code) => { console.debug('[turnstile] error-callback', code); turnstileToken = null; },
      });
      console.debug('[turnstile] widget rendered', turnstileWidgetId);
      return;
    }
    if (window.__turnstileLoadFailed) {
      console.debug('[turnstile] script failed to load (onerror fired)');
      $authCaptchaError.classList.remove('hidden');
      return;
    }
    if (turnstilePollTimer) return;
    const deadline = Date.now() + 4000;
    turnstilePollTimer = setInterval(() => {
      if (window.turnstile) {
        clearInterval(turnstilePollTimer);
        turnstilePollTimer = null;
        ensureTurnstileWidget();
      } else if (window.__turnstileLoadFailed || Date.now() > deadline) {
        console.debug('[turnstile] gave up waiting for script', { loadFailed: !!window.__turnstileLoadFailed, timedOut: Date.now() > deadline });
        clearInterval(turnstilePollTimer);
        turnstilePollTimer = null;
        $authCaptchaError.classList.remove('hidden');
      }
    }, 250);
  }
```

with:

```js
  function ensureTurnstileWidget() {
    if (!window.TURNSTILE_SITE_KEY || turnstileWidgetId !== null) return;
    if (window.turnstile) {
      clearInterval(turnstilePollTimer);
      $authCaptchaError.classList.add('hidden');
      turnstileWidgetId = window.turnstile.render($authCaptcha, {
        sitekey: window.TURNSTILE_SITE_KEY,
        callback: (token) => { turnstileToken = token; },
        'expired-callback': () => { turnstileToken = null; },
        'error-callback': () => { turnstileToken = null; },
      });
      return;
    }
    if (window.__turnstileLoadFailed) {
      $authCaptchaError.classList.remove('hidden');
      return;
    }
    if (turnstilePollTimer) return;
    const deadline = Date.now() + 4000;
    turnstilePollTimer = setInterval(() => {
      if (window.turnstile) {
        clearInterval(turnstilePollTimer);
        turnstilePollTimer = null;
        ensureTurnstileWidget();
      } else if (window.__turnstileLoadFailed || Date.now() > deadline) {
        clearInterval(turnstilePollTimer);
        turnstilePollTimer = null;
        $authCaptchaError.classList.remove('hidden');
      }
    }, 250);
  }
```

- [ ] **Step 2: Add new DOM refs**

Find the existing DOM ref block (around `app.js:570-579`):

```js
  const $authForm      = document.getElementById('authForm');
  const $authEmail     = document.getElementById('authEmail');
  const $authSent      = document.getElementById('authSent');
  const $authCaptcha   = document.getElementById('authCaptcha');
  const $authCaptchaError = document.getElementById('authCaptchaError');
```

Add immediately after it:

```js
  const $authTitle     = document.getElementById('authTitle');
  const $authNote      = document.getElementById('authNote');
  const $authPassword  = document.getElementById('authPassword');
  const $authConfirmGroup = document.getElementById('authConfirmGroup');
  const $authConfirmPassword = document.getElementById('authConfirmPassword');
  const $authModeToggle = document.getElementById('authModeToggle');
  const $authSubmitBtn = document.getElementById('authSubmitBtn');
  const $authForgotLink = document.getElementById('authForgotLink');
  const $resetPasswordOverlay = document.getElementById('resetPasswordOverlay');
  const $resetPasswordForm = document.getElementById('resetPasswordForm');
  const $resetPasswordInput = document.getElementById('resetPasswordInput');
  const $resetPasswordError = document.getElementById('resetPasswordError');
```

- [ ] **Step 3: Replace the auth form event listeners**

Replace (around `app.js:990-1004`):

```js
  /* ── Auth Event Listeners ── */
  window.store.onAuthChange(updateAuthUI);
  $signInBtn.addEventListener('click', () => { $authOverlay.classList.add('open'); ensureTurnstileWidget(); });
  $packGateSignInBtn.addEventListener('click', () => { $authOverlay.classList.add('open'); ensureTurnstileWidget(); });
  $authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.debug('[turnstile] submit', { hasToken: !!turnstileToken });
    if (window.TURNSTILE_SITE_KEY && !turnstileToken) {
      showToast("Please complete the verification and try again");
      return;
    }
    const ok = await window.store.signIn($authEmail.value.trim(), turnstileToken);
    resetTurnstile();
    $authSent.classList.toggle('hidden', !ok);
    if (!ok) showToast("Couldn't send the link — try again");
  });
  $authClose.addEventListener('click', () => $authOverlay.classList.remove('open'));
  $authOverlay.addEventListener('click', (e) => {
    if (e.target === $authOverlay) $authOverlay.classList.remove('open');
  });
```

with:

```js
  /* ── Auth Event Listeners ── */
  let authMode = 'signin'; // 'signin' | 'signup'
  function setAuthMode(mode) {
    authMode = mode;
    const isSignUp = mode === 'signup';
    $authTitle.textContent = isSignUp ? 'Sign up' : 'Sign in';
    $authNote.textContent = isSignUp
      ? 'Create an account to save your progress. Or close this to play without saving.'
      : 'Sign in to save your progress. Or close this to play without saving.';
    $authConfirmGroup.classList.toggle('hidden', !isSignUp);
    $authConfirmPassword.required = isSignUp;
    $authSubmitBtn.textContent = isSignUp ? 'Sign up' : 'Sign in';
    $authModeToggle.textContent = isSignUp ? 'Have an account? Sign in' : 'Need an account? Sign up';
    $authSent.classList.add('hidden');
  }
  window.store.onAuthChange(updateAuthUI);
  window.store.onAuthChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      $authOverlay.classList.remove('open');
      $resetPasswordOverlay.classList.add('open');
    }
  });
  $signInBtn.addEventListener('click', () => { setAuthMode('signin'); $authOverlay.classList.add('open'); ensureTurnstileWidget(); });
  $packGateSignInBtn.addEventListener('click', () => { setAuthMode('signin'); $authOverlay.classList.add('open'); ensureTurnstileWidget(); });
  $authModeToggle.addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
  });
  $authForgotLink.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $authEmail.value.trim();
    if (!email) { showToast('Enter your email first'); return; }
    if (window.TURNSTILE_SITE_KEY && !turnstileToken) {
      showToast('Please complete the verification and try again');
      return;
    }
    const err = await window.store.requestPasswordReset(email, turnstileToken);
    resetTurnstile();
    if (err) { showToast(err); return; }
    $authSent.classList.remove('hidden');
  });
  $authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (window.TURNSTILE_SITE_KEY && !turnstileToken) {
      showToast("Please complete the verification and try again");
      return;
    }
    const email = $authEmail.value.trim();
    const password = $authPassword.value;
    if (authMode === 'signup' && password !== $authConfirmPassword.value) {
      showToast("Passwords don't match");
      return;
    }
    const err = authMode === 'signup'
      ? await window.store.signUp(email, password, turnstileToken)
      : await window.store.signIn(email, password, turnstileToken);
    resetTurnstile();
    if (err) { showToast(err); return; }
    $authOverlay.classList.remove('open');
  });
  $authClose.addEventListener('click', () => $authOverlay.classList.remove('open'));
  $authOverlay.addEventListener('click', (e) => {
    if (e.target === $authOverlay) $authOverlay.classList.remove('open');
  });
  $resetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = await window.store.updatePassword($resetPasswordInput.value);
    if (err) {
      $resetPasswordError.textContent = err;
      $resetPasswordError.classList.remove('hidden');
      return;
    }
    $resetPasswordOverlay.classList.remove('open');
    showToast('Password updated');
  });
```

- [ ] **Step 4: Verify no syntax errors**

Run: `node --check app.js`
Expected: no output (exit code 0)

- [ ] **Step 5: Local manual test against the real Supabase project**

This repo has no test framework — verify by hand, locally, against the real (already-configured) Supabase project without touching the public deployment:

```bash
cp config.js /tmp/config.js.bak   # keep a copy of the local ('server' backend) config
cp config.web.js config.js        # temporarily point local dev at Supabase
python3 server.py
```

Open `http://localhost:8080` in a browser. **Before testing sign-up:** confirm the human has completed Task 0 (turned off "Confirm email" in the Supabase dashboard) — if not, stop and ask them to do it now.

Test all three flows:
1. **Sign up:** click sign-in, switch to "Sign up", enter a new test email + password (6+ chars) + matching confirm password, complete the Turnstile widget, submit. Expect: modal closes, you're signed in immediately (check the account pill shows the email), no email received.
2. **Sign out → sign in:** click sign out, then sign in again with the same email + password. Expect: modal closes, signed in.
3. **Forgot password:** click "Forgot password?" with the test email filled in, complete Turnstile, submit. Expect: "Check your email" note appears, and a real password-reset email arrives (check the inbox for the test account). Click the link in the email — expect it opens `http://localhost:8080` and the "Set new password" panel appears automatically (via the `PASSWORD_RECOVERY` event). Enter a new password, submit. Expect: "Password updated" toast, panel closes. Sign out, sign in with the *new* password — expect success.

If any step fails, check the browser console for `[signIn]`, `[signUp]`, `[requestPasswordReset]`, or `[updatePassword]` error logs (added in Task 1) — they show the raw Supabase error.

- [ ] **Step 6: Restore local config**

```bash
mv /tmp/config.js.bak config.js
git status --short config.js   # must show no diff — config.js should be back to 'server' backend
```

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: wire sign-in/sign-up modes and password-reset flow into auth modal"
```

---

### Task 4: Publish to the live site

**Files:** none (deploy-only task)

- [ ] **Step 1: Confirm with the human before publishing**

This step pushes to the public repo (`i-press-buttons/drawn-together`). Do not run it without the human's explicit go-ahead in this session, even though earlier debug pushes in this same conversation were pre-approved — each publish is a separate confirmation per this project's working agreement.

- [ ] **Step 2: Run the anonymized publish flow**

(See project memory "Drawn Together deployments" for the exact flow — local `main` is never pushed directly.)

```bash
git fetch origin
git checkout -B publish origin/main
git checkout main -- .
git add -A
git -c user.name="I-press-buttons" -c user.email="58920920+I-press-buttons@users.noreply.github.com" commit -m "feat: replace magic-link auth with email+password auth"
git push origin publish:main
git checkout main
git branch -D publish
```

- [ ] **Step 3: Verify on the live site**

Open `https://i-press-buttons.github.io/drawn-together/` and repeat the sign-up flow from Task 3 Step 5 once, to confirm the manual Supabase dashboard change and the deployed code agree in production.
