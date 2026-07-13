# Sign-in as the first step, and gating the pack editor

## Problem

On the Supabase backend, sign-in is currently optional and easy to miss:

- The only nudge to sign in is a toast (`maybeShowPersistHint()` in `app.js`)
  that fires *after* a signed-out user draws their first card — by which
  point they may already be invested in a session that won't be saved.
- The "+ New Pack" button (`#newPackBtn` / `#newPackForm` in `index.html`)
  is always shown, even when signed out. Clicking it lets a signed-out user
  fill out the form and submit; `store.createPack()` silently fails (RLS
  rejects the anonymous insert because `packs.user_id` has no `auth.uid()`
  to default to), giving no feedback about why nothing happened.

Note: `loadPacks()` and `loadMarks()` already return empty state when
signed out, so no existing custom packs/marks are ever visible to an
anonymous user — the only reachable "edit" surface today is pack creation.

This only applies to the Supabase (web) backend. The local/Docker backend
(`store-server.js`) has no real auth: `signedIn()` always returns `true`.

## Goals

1. Anyone with the app link can sign up by simply entering their email —
   this already works via `store.signIn(email)` → `signInWithOtp`, which
   creates a new user on first use. No backend/schema change needed.
2. Move the sign-in prompt to be the *first* thing a signed-out user sees
   on the Supabase backend, instead of a toast shown after they've already
   started playing.
3. Sign-in stays optional/skippable — anonymous play is still allowed, just
   without persistence, consistent with current behavior.
4. Pack/question editing is unambiguously gated behind sign-in: a
   signed-out user sees a clear sign-in prompt in place of the "+ New Pack"
   control, not a silently-failing form.

## Non-goals

- No manual-approval queue, invite tokens, or admin dashboard — dropped
  during design discussion in favor of simple self-serve signup.
- No change to `signIn`/`signInWithOtp`/RLS — the existing magic-link flow
  and schema already support everything needed here.
- No change to favorites/retire gating — already correctly return empty
  state when signed out (unaffected by this change).

## Design

### 1. Boot-time sign-in prompt (replaces the after-the-fact toast)

In the boot sequence (`app.js` bottom, `~line 1090-1099`), after
`await window.store.ready()`, if `window.store.backend === 'supabase' &&
!window.store.signedIn()`, open `$authOverlay` once
(`$authOverlay.classList.add('open')`) — the same overlay/open mechanism
already used by `$signInBtn`'s click handler. It remains fully dismissible
via the existing close button, backdrop click, and Escape key handlers
(`app.js` ~956-1039) — closing it lets the user play anonymously exactly as
today.

Remove `maybeShowPersistHint()` and its call site (`app.js:663`,
inside the draw/answer flow) — the boot-time prompt replaces it. No
`persistHintShown` flag is needed anymore since the overlay only
auto-opens once, at boot.

### 2. Gate the "+ New Pack" control behind sign-in

In `renderPacks()` (`app.js:288`) or the static markup in `index.html`
(`~line 163-168`), when `window.store.backend === 'supabase' &&
!window.store.signedIn()`, replace the `#newPackBtn` button with an inline
message: "Sign in to create and edit question packs" plus a "Sign in"
button that opens `$authOverlay` (same trigger as `$signInBtn`). When
signed in (or on the local/Docker backend), show `#newPackBtn` as today.

This should be re-evaluated whenever auth state changes, alongside the
existing `updateAuthUI()`-style re-render already triggered by
`onAuthChange` (see the account-control work in
`docs/superpowers/specs/2026-07-13-account-control-design.md`), so the
control flips immediately after sign-in/sign-out without a page reload.

## Testing

- Manual verification via the `run` skill / browser, Supabase-backed local
  config:
  - Fresh signed-out load → auth overlay opens automatically.
  - Dismiss it (Escape/backdrop/close button) → can still draw/answer/skip
    cards, progress not saved, no toast appears later.
  - Reload while signed out → overlay opens again.
  - Signed out, open Packs → "+ New Pack" replaced by sign-in prompt;
    clicking its Sign in button opens the same overlay.
  - Sign in → overlay closes on redirect, "+ New Pack" control now shown,
    pack creation works normally.
  - Sign out → "+ New Pack" reverts to the sign-in prompt.
- Verify no behavior change on the local/Docker (`store-server.js`) backend
  (overlay never auto-opens, "+ New Pack" always shown).
