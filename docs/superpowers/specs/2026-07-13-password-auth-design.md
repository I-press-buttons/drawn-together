# Email + password auth (replacing magic links)

## Problem

Sign-in on the Supabase (web) backend uses magic-link email auth
(`store.signIn(email, captchaToken)` → `client.auth.signInWithOtp`), which
means *every* sign-in sends an email through Supabase's built-in mailer.
While debugging a recent sign-in failure, two things surfaced:

- A real bug (already fixed and pushed, not part of this spec's work): the
  auth modal opens from four call sites, but only the `$signInBtn` and
  `$packGateSignInBtn` click handlers called `ensureTurnstileWidget()`. The
  other two paths — `requireSignIn()` and the boot-time auto-open for
  signed-out web users — left the Turnstile widget uninitialized, so
  `turnstileToken` was always null there and submits were rejected.
- Once that was fixed, sign-in still failed with `429 email rate limit
  exceeded` from Supabase's magic-link email sending. That's expected
  behavior under repeated testing, not a bug — but it shows that the
  everyday sign-in action depends on Supabase's low default email-sending
  rate limit, which will keep biting.

The fix is to stop sending an email on every sign-in: replace magic-link
auth with email + password auth, and add self-serve sign-up so new
invitees can create their own accounts without anyone needing Supabase
dashboard access.

## Goals

1. Sign in with email + password (`signInWithPassword`) — no email sent,
   no rate limit involved in the everyday sign-in action.
2. Self-serve sign-up: a new invitee with the app link can create an
   account (email + password) directly in the auth modal — no
   dashboard-provisioned accounts, no password-setting by an admin.
3. New accounts are auto-confirmed with **no confirmation email sent**, to
   avoid re-introducing the same rate-limit problem that prompted this
   change.
4. A "forgot password" reset flow, included in this first pass. It does
   send an email and is subject to the same rate limit, but that's
   accepted: password resets are rare, unlike everyday sign-in.
5. Auth errors from all write paths are surfaced to the user via the
   existing toast mechanism, permanently — this error surfacing is what
   let us diagnose the original Turnstile bug, and it stays.

## Non-goals

- No admin dashboard UI for password resets — users reset their own via
  the forgot-password flow.
- No email-confirmation-on-signup flow — deliberately turned off (see the
  manual prerequisite below).
- No change to what sign-in gates (pack editor, favorites, retire) or to
  RLS/schema — this swaps the auth mechanism only.
- No change to the local/Docker backend (`store-server.js`), which has no
  real auth.

## Manual prerequisite (Supabase dashboard)

Before this ships, a one-time manual change in the Supabase dashboard for
project `wajjncluitygfatocbba`:

**Authentication → Providers → Email → turn OFF "Confirm email".**

This makes `signUp` auto-confirm new accounts and send no confirmation
email. Code cannot do this; it must be done by hand in the dashboard.

## Design

### `index.html` — auth modal gains modes

Extend the existing `#authOverlay` / `#authForm` modal:

- Add a password field, and a confirm-password field that is shown only in
  sign-up mode.
- Add a mode-toggle link switching the form between "Sign in" and
  "Sign up" (title, submit-button label, and confirm-password visibility
  all follow the mode).
- Add a "Forgot password?" link that submits the entered email to the
  reset flow.
- Add a new hidden `#resetPasswordForm` panel with a single new-password
  field, shown when the user arrives via a password-reset email link.
- Update the modal copy — the current "we'll send you a sign-in link"
  note and "Send magic link" button text no longer apply.

### `store-supabase.js` — API surface

Replace the existing `signIn(email, captchaToken)` (which called
`client.auth.signInWithOtp`) with four functions:

- `signIn(email, password, captchaToken)` →
  `client.auth.signInWithPassword`.
- `signUp(email, password, captchaToken)` → `client.auth.signUp`. No
  `emailRedirectTo` is needed since email confirmation is off; the user is
  signed in immediately on success.
- `requestPasswordReset(email, captchaToken)` →
  `client.auth.resetPasswordForEmail`, redirecting back to the app.
- `updatePassword(newPassword)` →
  `client.auth.updateUser({ password: newPassword })`, used after the
  user clicks a recovery link.

### `app.js` — wiring

- Wire up the new form fields, the sign-in/sign-up mode toggle, and
  per-mode submit handlers (sign in vs sign up), keeping the existing
  Turnstile token check on submit.
- Listen for the `PASSWORD_RECOVERY` Supabase auth event — surfaced
  through the existing `onAuthStateChange` subscription in
  `store-supabase.js` — and show the `#resetPasswordForm` "set new
  password" panel when it fires; its submit calls
  `store.updatePassword(newPassword)`.

### Error handling

All three write paths (`signIn`, `signUp`, `requestPasswordReset`)
surface `error.message` to the user via the existing toast mechanism
instead of swallowing errors. This is a permanent behavior, not temporary
debug logging — surfacing the real Supabase error is what made the
original Turnstile bug diagnosable, and future auth failures (wrong
password, rate limits, weak password) need the same visibility.

## Testing

Manual verification against the live GitHub Pages deployment
(https://i-press-buttons.github.io/drawn-together/), all three flows:

1. Sign up with a new email + password → immediately signed in, no email
   received.
2. Sign out → sign in again with the same email + password → works.
3. Forgot password → reset email received → click the link → the "set new
   password" panel appears → set a new password → sign out → sign in with
   the new password → works.
