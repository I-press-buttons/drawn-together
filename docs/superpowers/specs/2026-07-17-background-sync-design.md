# Per-account background sync — design

**Date:** 2026-07-17
**Status:** Approved

## Goal

The chosen table background (Classic / Treeline / Lakeside / Sunset Ridge / Alpine) currently
lives only in `localStorage` (`dt-background`), so it doesn't follow a user across devices.
Make it sync per-account on both backends, keeping the current instant, offline-friendly
local behavior for anonymous visitors.

## Semantics

- `localStorage` remains the fast path: boot paints the background from `dt-background`
  immediately, before any network call, exactly as today. Default is `alpine`.
- Every explicit background pick writes `localStorage` **and** fire-and-forgets
  `store.setBackgroundPref(key)`.
- After `store.ready()` during boot, load the account value. **If the account has a
  background set, it wins** and is applied (also written to `localStorage` so the fast path
  agrees next load). If the account has none, the local value stays and is *not* pushed up —
  the account only learns a background when the user actively picks one. This avoids a
  write on every page load.
- On sign-in mid-session (Supabase), re-fetch and apply the account value the same way.
- Sign-out / anonymous: pure localStorage behavior, unchanged.

## Store interface (both `store-server.js` and `store-supabase.js`)

Two new methods, mirroring the `featuredPackPrefs` pattern (narrow, not a generic
settings bag):

- `loadBackgroundPref()` → `Promise<string|null>` — account value, or `null` if unset /
  signed out / error.
- `setBackgroundPref(key)` → `Promise<boolean>` — persists; `false` on failure. Signed-out
  Supabase: no-op returning `false` (app.js already wrote localStorage).

## Supabase backend

New table in `supabase/schema.sql`:

```sql
create table user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  background text,
  updated_at timestamptz not null default now()
);
```

RLS enabled, owner-only select/insert/update/delete via `auth.uid() = user_id`, same
pattern as the existing `sessions` table. `setBackgroundPref` upserts the row;
`loadBackgroundPref` selects `background` with `maybeSingle()`.

**Migration note:** the table-creation SQL must be run once in the Supabase dashboard
(schema.sql is not auto-applied). The statement is included verbatim in the plan.

## Server backend (`server.py`)

- `load_user_data()` gains a `"background"` field (string or `None`; tolerate bad types
  like the `featuredPackPrefs` field does).
- `GET /api/background` → `{"background": <key-or-null>}`.
- `PUT /api/background` with body `{"background": "<key>"}` → validates it's a non-empty
  string (server doesn't know the valid key list — the client clamps unknown keys to
  `alpine` on read), stores under `PACKS_LOCK`, echoes `{"background": key}`.
- `test_server.py`: coverage for GET default (null), PUT + readback, PUT rejects
  missing/non-string body (400).

## app.js changes

- `setBackground(key)`: after the existing localStorage write, call
  `window.store.setBackgroundPref(key).catch(() => {})` — but **only for explicit picks**,
  not when applying a value that just came from the account (else applying would echo a
  write back). The account-apply path still writes `localStorage` — it skips only the
  store push. Simplest: a second boolean param (`fromAccount`) on `setBackground` that
  suppresses the `setBackgroundPref` call.
- Boot: keep the immediate `loadBackground()` call; inside the async boot block (after
  `store.ready()`), `loadBackgroundPref()` and apply if non-null.
- `onAuthChange`: on sign-in, `loadBackgroundPref()` and apply if non-null.
- Unknown/invalid keys from the account are clamped by the existing
  `hasOwnProperty` guard in `setBackground` (falls back to `alpine`).

## Not doing

- Generic key/value settings API (YAGNI — one setting).
- Storing the background in the session blob (clear-session would wipe it).
- Syncing for anonymous visitors (nothing to key it on).

## Testing

- `test_server.py` unit coverage for the new routes (above).
- Manual/browser: verify via the project `verify` skill against the local server —
  pick a background, wipe localStorage, reload, confirm it comes back from the server.
- Supabase path is reviewed by inspection (no local Supabase test rig).
