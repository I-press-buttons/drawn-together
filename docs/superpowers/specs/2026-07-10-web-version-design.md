# Drawn Together — Public Web Version (Supabase + GitHub Pages)

**Date:** 2026-07-10
**Status:** Approved (Approach A — shared codebase with storage adapter)

## Goal

Publish Drawn Together as a public static website where invited users sign in
with an email magic link and keep their own custom question packs, favorites,
and retired questions synced across devices. The existing Docker/local version
keeps working unchanged, sharing the same UI code.

## Decisions (made with the user)

- **Backend:** Supabase (Postgres + row-level security + built-in auth).
- **Access:** Invite-only. Public signups disabled in the Supabase dashboard;
  the owner invites emails manually. No CAPTCHA or per-user row caps needed —
  all account holders are trusted.
- **Sign-in:** Email magic link only.
- **Hosting:** GitHub Pages, deployed from the repo by a GitHub Actions
  workflow on push to main.
- **Architecture:** Approach A — one codebase; all persistence behind a
  `store` interface with two implementations (server API / Supabase).
- **Execution:** Fable orchestrates and verifies; Opus subagents implement
  each task.

## Architecture

```
index.html
  ├─ config.js          ← picks backend; repo copy says "server";
  │                        Pages deploy swaps in the "supabase" copy
  ├─ store-server.js    ← current fetch('/api/...') calls, extracted
  ├─ store-supabase.js  ← same interface, backed by supabase-js + auth UI
  ├─ vendor/supabase.js ← vendored supabase-js UMD build (no CDN at runtime)
  └─ app.js             ← game UI; talks only to window.store
```

`index.html` loads `config.js`, then both store implementations, then
`app.js`. Each store file registers itself only if `window.DT_BACKEND`
matches its name; `app.js` uses the winner as `window.store`. The vendored
supabase-js and `store-supabase.js` are skipped by the server backend at
runtime (cheap no-op; the files still ship in the Docker image — acceptable).

### The store interface

Every current `fetch('/api/...')` call in `app.js` moves behind:

```js
window.store = {
  backend,                    // "server" | "supabase"
  async loadPacks(),          // → [{id, name, enabled, questions: [...]}]
  async createPack(name),     // → pack
  async updatePack(id, fields),        // {name?, enabled?}
  async deletePack(id),
  async addQuestion(packId, q),        // {text, rarity, category} → question
  async updateQuestion(packId, qid, fields),
  async deleteQuestion(packId, qid),
  async loadMarks(),          // → {favorites: [...], retired: [...]}
  async setMark(list, qkey, on),

  // Auth (server backend: signedIn always true, signIn/Out no-ops)
  signedIn(),                 // → bool
  onAuthChange(cb),
  async signIn(email),        // magic link request
  async signOut(),
}
```

Question keys (`b1`…`b108`, `p<packId>-<qid>`) keep working; for Supabase,
pack/question ids are UUIDs and qkeys become `p<packUuid>-<qUuid>` — the
existing `MARK_KEY` semantics in app.js only concatenate and compare, so no
format assumptions break. (Verify during implementation: the only server-side
key validation lives in server.py and doesn't apply to Supabase.)

## Supabase schema (`supabase/schema.sql`, committed)

```sql
create table packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references packs(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 300),
  rarity text not null default 'common',
  category text not null default 'Custom',
  created_at timestamptz not null default now()
);

create table marks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list text not null check (list in ('favorites','retired')),
  qkey text not null check (char_length(qkey) <= 80),
  primary key (user_id, list, qkey)
);
```

Row-level security on all three tables: enable RLS; policies allow
select/insert/update/delete only where `user_id = auth.uid()` (for
`questions`, via `exists (select 1 from packs where packs.id = pack_id and
packs.user_id = auth.uid())`).

## Web experience

- **Signed out:** full game with the 108 base questions (served statically —
  no backend touched). The heart/retire buttons and the pack manager show a
  sign-in prompt instead of acting.
- **Sign-in flow:** email field → `signInWithOtp` → "check your email" note →
  clicking the emailed link returns to the site signed in. Session persists
  (supabase-js default localStorage session).
- **Signed in:** identical to the Docker version — packs, editing,
  favorites/greatest hits, retire, export/import all work, stored per-user
  in Supabase. A small sign-out control shows the signed-in email.
- **Errors:** network/auth failures reuse the existing toast; optimistic
  mark updates keep their existing revert-on-failure behavior.

## Deploy (`.github/workflows/pages.yml`)

On push to main: checkout → copy the static files to a `_site` dir → replace
`config.js` with the supabase variant (URL + anon key are public-safe and
committed as `config.web.js`) → `actions/deploy-pages`. No build tooling —
the "build" is file copying.

## Owner's one-time setup (documented in README)

1. Create a free Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Auth settings: disable "Allow new users to sign up"; magic link is on by
   default. Add the Pages URL to the auth redirect allowlist.
4. Put the project URL + anon key in `config.web.js`; push.
5. Enable GitHub Pages (source: GitHub Actions) on the repo.
6. Invite users by email from the dashboard.

## Testing

- `test_server.py` (32 tests) must stay green — proves the server refactor
  to `store-server.js` didn't change the API.
- New Playwright smoke script (dev-only, not shipped): loads the site with the
  server backend, draws a card, opens the pack manager — catches wiring
  regressions in the store split.
- Supabase path verified against the user's real project once keys exist:
  sign-in, pack CRUD, marks, RLS isolation (second test user can't read the
  first user's rows).

## Out of scope

- Accounts on the Docker version (stays single-household, no auth).
- Sharing packs between users, public pack gallery.
- Custom domain (Pages default URL first; domain can be added later).
- Offline/PWA support.
