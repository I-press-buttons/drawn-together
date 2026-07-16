# Featured packs (shipped, toggleable content)

## Context

The app ships one mandatory content set — `questions.json`'s 108-question "Base Game" — plus per-user custom packs (self-hosted: `question_packs.json`; public site: Supabase `packs`/`questions` tables, gated behind sign-in). There is no way to ship additional curated content (like a themed "Biblical Marriage" pack) to *everyone*, including anonymous visitors, while still letting each viewer turn it off.

This spec adds a **featured packs** layer: read-only content bundled with the app, shown to every visitor on both deployment targets, each pack individually toggleable per viewer. The first featured pack is "Biblical Marriage" (42 Christian marriage questions, already drafted and reviewed).

Out of scope: editing or deleting featured-pack questions (they're fixed content — only custom packs are editable), and folding the existing "Base Game" into this system (it stays exactly as-is, per prior decision).

## Data model

New static file `featured_packs.json` at repo root, shipped alongside `questions.json`:

```json
[
  {
    "key": "biblical-marriage",
    "name": "Biblical Marriage",
    "questions": [
      { "id": 1, "text": "...", "rarity": "common", "category": "Faith" },
      ...
    ]
  }
]
```

- `key` is a stable slug, not a database id — this file is static and identical across every self-hosted instance and the public deployment, so there's no per-instance id assignment. Keys must be lowercase `[a-z0-9-]` starting alphanumeric (the server's mark/pref validation regexes require it), and no key may be a prefix of another key (deck-sync filters match on the `f<key>-` prefix).
- Question qkey format: `f<key>-<id>` (e.g. `fbiblical-marriage-1`). This is a new prefix, distinct from `b<n>` (base deck) and `p<packId>-<id>` (custom packs), so favorites/retired marks against featured-pack questions never collide with either existing namespace.
- Content in this file is never mutated by the app — no add/edit/delete/move UI for it.

## Enable/disable persistence

Only the per-viewer on/off toggle needs to persist (content itself is identical for everyone), keyed by pack `key`, default enabled.

**Self-hosted (`server.py`)**
- New field in the existing `user_data.json`: `featuredPackPrefs: { [key]: boolean }` (sits next to the current session/marks data — same file, same lock).
- New routes: `GET /api/featured-pack-prefs` → the prefs map; `PUT /api/featured-pack-prefs/<key>` with body `{enabled}` → updates one entry, returns the full map. Covered in `test_server.py` (happy path + unknown key).

**Public site, signed-in (Supabase)**
- New table, mirroring the existing `marks` RLS pattern:
  ```sql
  create table if not exists public.featured_pack_prefs (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    pack_key text not null check (char_length(pack_key) <= 60),
    enabled boolean not null,
    primary key (user_id, pack_key)
  );
  alter table public.featured_pack_prefs enable row level security;
  create policy "own featured prefs" on public.featured_pack_prefs
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  ```
- Added to `supabase/schema.sql`. Existing deployments need to run the new `create table`/policy statements once (documented in README's Supabase setup step).

**Public site, anonymous**
- No account to store it in. `store-supabase.js` reads/writes a `localStorage` blob (e.g. `dt_featured_pack_prefs`) instead of hitting Supabase when there's no session. Device-local, resets if they clear browser storage or switch devices — acceptable since it only controls an on/off switch on free content.

## Store interface (both backends, identical shape)

Two new methods on `window.store`, alongside the existing pack/mark/session methods:
- `loadFeaturedPackPrefs()` → `{ [key]: boolean }` (only overrides are present; a missing key means "enabled").
- `setFeaturedPackPref(key, enabled)` → persists and returns the updated map (mirrors `setMark`'s return-the-new-state convention).

`app.js` remains backend-agnostic — it only calls these two methods, never branches on `window.DT_BACKEND` for this feature (matching the existing pattern for packs/marks/session).

## Frontend (`app.js`)

- At startup, fetch `featured_packs.json` the same way `questions.json` is fetched today (`loadQuestions()`), tagging each question with its pack `key` and `qkey`.
- Load prefs via `window.store.loadFeaturedPackPrefs()` once at startup (alongside marks/session loading).
- Extend the existing "which packs contribute to the live deck" merge logic (currently: Base Game always + enabled custom packs) to also include enabled featured packs.
- Packs modal: new "Featured packs" section between "Base Game" and the custom-packs list. Each entry renders like the current hardcoded Base Game card (name, question count, `Built-in`-style tag) but with a real toggle switch (same `pack-toggle` component/markup used for custom packs) wired to `setFeaturedPackPref`. No chevron, no expand, no edit/delete/add-question affordances — the content is fixed.
- Toggling a featured pack off should also remove its questions from the live/session deck the same way disabling a custom pack does today (reuse that existing sync path — this was fixed for custom packs previously, see `7ee3c4c fix: sync live deck when packs are toggled on/off`).

## Deployment

- `featured_packs.json` added to the Dockerfile `COPY` line and the Pages workflow's "Assemble static site" `cp` line — both currently list `questions.json` explicitly, so this is a one-line addition in each place (the CLAUDE.md gotcha this project already tracks).
- `supabase/schema.sql` updated with the new table/policy; existing public deployment needs that DDL run once via the Supabase SQL editor (manual step, not automated by CI).

## Rollout for Biblical Marriage

- `featured_packs.json` ships with one entry, `key: "biblical-marriage"`, containing the 42 previously-approved questions (7 per rarity tier, `category: "Faith"`, mutual-love framing).
- The earlier stand-in copy in local `question_packs.json` (custom pack id 3, "Biblical Marriage") is removed as part of this change — it was a placeholder before the real featured-pack mechanism existed.

## Testing / verification

- `test_server.py`: new tests for `GET`/`PUT /api/featured-pack-prefs` (default state, setting a pref, unknown key behavior).
- Manual verification: self-hosted (`python3 server.py`) — toggle Biblical Marriage off/on, confirm live deck updates and question count matches; public site — verify anonymous toggle persists via localStorage across a reload, and signed-in toggle persists via Supabase across a fresh sign-in on another browser/profile.
