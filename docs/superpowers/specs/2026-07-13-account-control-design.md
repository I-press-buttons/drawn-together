# Top-left account control

## Problem

The app already has a full magic-link auth flow (invite-only, Supabase-backed),
gating favorites, retiring questions, and the pack editor via `requireSignIn()`.
But there's no persistent, visible way to sign in or see auth status:

- The only way to trigger sign-in is to stumble into one of the three gated
  actions.
- Once signed in, the account row (email + sign out) is buried inside the
  Packs modal (`#modalOverlay`), not visible from the main screen.
- On the Supabase backend, a signed-out user can draw/answer/skip/reset
  freely, but `saveCurrentSession()` silently no-ops — their session isn't
  persisted and there's no indication of that.

This only applies to the Supabase (web) backend. The local/Docker backend
(`store-server.js`) has no real auth: `signedIn()` always returns `true` and
`userEmail()` always returns `null`.

## Goals

1. A persistent, always-visible account control in the top-left of the top
   bar (left of the "Drawn Together" title).
2. Signed out: shows a "Sign in" button that opens the existing auth modal.
3. Signed in: shows the user's email + a sign-out control, replacing the
   account row currently buried in the Packs modal.
4. Hidden entirely on backends with no real auth (local/Docker), so it never
   appears as a dead control.
5. A one-time hint nudging signed-out users on the Supabase backend that
   their progress isn't being saved, with a quick path to sign in.

## Non-goals

- No new signup flow — accounts stay invite-only via the existing
  single-field magic-link form.
- No change to which actions require sign-in (favorites, retire, edit
  questions keep gating via `requireSignIn()` as today).
- No change to session/pack/mark persistence logic itself — this is purely
  making existing behavior visible and reachable.

## Design

### Top-bar layout

`.top-bar` is currently `justify-content: space-between` with `.title` then
`.top-actions`. Add a new element `#accountControl` as the *first* child of
`.top-bar`, before `.title`, so it sits at the top-left corner and the title
sits to its right.

`#accountControl` has three possible visual states, chosen by
`updateAuthUI()`:

- **Hidden** — `signedIn() === true && userEmail() === null` (the
  local/Docker no-auth case). Render nothing.
- **Signed out** — `signedIn() === false`. Render a compact ghost button,
  text "Sign in". Click calls the same logic as `requireSignIn()`'s modal
  trigger (opens `#authOverlay`).
- **Signed in** — `signedIn() === true && userEmail()` truthy. Render a
  compact pill: truncated email + small sign-out button. This reuses the
  markup/behavior of the current `.account-row` (`#accountEmail`,
  `#signOutBtn`), moved from inside `#modalOverlay` to `#accountControl` in
  the top bar. The Packs modal no longer shows an account row.

### Sign-in modal

Unchanged — reuses the existing `#authOverlay` / `#authForm` markup and
`window.store.signIn(email)` call. No new modal.

### Silent-persistence hint

On the Supabase backend only (`window.store.backend === 'supabase'`), the
first time a signed-out user performs a save-triggering action (their first
`drawCard()` of the page load), show a toast via the existing `showToast(msg,
{label, fn})` helper (same pattern already used for the "Undo" action on
retire):

> "Playing without saving — sign in to keep your progress." **[Sign in]**

The action button opens `#authOverlay`. A module-level boolean
(`persistHintShown`) ensures this fires at most once per page load. It does
not fire again once the user signs in, and does not fire at all on the
local/Docker backend or once already signed in.

### Styling

New `.account-control` rules near the existing `.account-row` /
`.account-email` / `.btn-small` styles in `style.css`, reusing
`--ink-muted`, `--surface`, and the existing ghost-button visual language.
Sized to fit comfortably in the top bar at both mobile and desktop widths;
the email pill truncates via the existing `.account-email` ellipsis rule.

## Testing

- Manual verification via the `run` skill / browser: Supabase-backed local
  config, exercise signed-out → hint toast → sign-in → email pill → sign out
  → back to "Sign in" button.
- Verify the control renders nothing on the local/Docker (`store-server.js`)
  backend.
- Verify existing gated actions (favorites, retire, edit) still prompt
  sign-in unchanged.
