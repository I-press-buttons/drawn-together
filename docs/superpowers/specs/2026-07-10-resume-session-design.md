# Resume Session

## Summary

Persist enough of the in-progress game state (remaining deck, discard pile, score, and related counters) so that reopening the app after a refresh, browser close, or on another signed-in device offers a choice to continue exactly where you left off — instead of always reshuffling the full question pool and risking many repeat cards.

Session state syncs through the existing `window.store` backend abstraction (same pattern as marks and packs), so it works identically for the local/Docker deployment (single-user JSON file) and the Supabase-backed public site (per-user, cross-device).

## Non-goals

- No change to how marks (favorites/retired) or packs are stored — this only adds a new, independent piece of persisted state.
- No offline/local-only fallback distinct from the store abstraction — the local server backend already treats every request as the single implicit user (`signedIn()` always returns `true`), so "sync across devices" and "persist across reloads on this install" fall out of the same mechanism for free.
- No attempt to resume mid-animation visual state (card flip, score-pop) — only logical state (which cards are left, which are discarded, current score).
- No change to the score-toggle (`scoreEnabled`) persistence — it continues to default to `true` on every boot, as today.

## Data model

A single saved-session blob per user/install, stored as identifiers only (not full question snapshots), so a resume always reflects the current state of packs/questions rather than a stale copy:

```js
{
  deckKeys: string[],        // remaining undrawn qkeys, in current array order (last element = next card `drawCard()` pops)
  discardKeys: string[],     // answered qkeys, newest first (mirrors today's `discard` ordering)
  currentKey: string | null, // qkey of the card currently on screen, if a card was mid-reveal
  score: number,
  questionsAnswered: number,
  rarestKey: string | null,  // qkey of rarestAnswered, if any
  sessionHearts: number,
}
```

On load, each key is re-resolved against the live question set. `findQuestionByKey` alone is insufficient for this: it resolves a key as long as the underlying question exists in *any* pack, regardless of whether that pack is currently enabled or the question is retired. Resolution for resume purposes must additionally reject a key if its pack is disabled or `isRetired(qkey)` is true — i.e. only keys that would appear in a fresh `getAllQuestions()` result count as resolvable. Any key that fails this check (question/pack deleted, pack disabled, or question retired since the session was saved) is silently dropped from the rehydrated `deckKeys`/`discardKeys`/`currentKey`. Counters (`score`, `questionsAnswered`, etc.) are restored as-saved regardless, since they reflect what already happened in that session, not the current deck contents. This mirrors the existing precedent of dropping orphaned marks when a question is deleted.

Rehydration (including this filtering) happens once, immediately after `loadSession()` returns at boot — not deferred until the user clicks "Resume" — so the count shown in the resume prompt already reflects any dropped keys.

## Storage (`window.store` additions)

Three new methods, implemented by both backends:

- `async loadSession()` → returns the saved session object, or `null` if none exists.
- `async saveSession(session)` → upserts/overwrites the single saved session for this user/install.
- `async clearSession()` → deletes the saved session, if any.

### `server.py` / `store-server.js`

- Add a `session` key to the existing `user_data.json` (alongside `favorites`/`retired`), defaulting to `null`.
- New endpoints mirroring the existing marks pattern:
  - `GET /api/session` → `{ session: {...} | null }`
  - `PUT /api/session` → body is the session object; overwrites and returns it.
  - `DELETE /api/session` → clears it, returns `{ ok: true }`.
- Same `MAX_BODY_BYTES` guard applies (existing global body-size check).
- `GET /api/marks` must continue to return only `{ favorites, retired }`, not the raw `user_data.json` contents — the handler needs to pick those two keys out explicitly rather than returning the loaded object wholesale, so the session blob doesn't leak into the marks response.

### `store-supabase.js` / `supabase/schema.sql`

- New table:
  ```sql
  create table if not exists public.sessions (
    user_id uuid primary key references auth.users(id) on delete cascade,
    data jsonb not null,
    updated_at timestamptz not null default now()
  );
  alter table public.sessions enable row level security;
  -- RLS: a user may only select/insert/update/delete their own row (user_id = auth.uid()),
  -- following the same policy pattern already used for packs/questions/marks.
  ```
- `loadSession()`: `select data from sessions where user_id = auth.uid()` (implicit via RLS) → returns `data` or `null` if no row.
- `saveSession(session)`: `upsert({ user_id: <implicit>, data: session, updated_at: now() })`.
- `clearSession()`: `delete().eq('user_id', ...)` (implicit via RLS).

## Triggers (`app.js`)

- **Autosave**: a `saveCurrentSession()` helper serializes the in-memory state (`deck`, `discard`, `currentCard`, `score`, `questionsAnswered`, `rarestAnswered`, `sessionHearts`) to the shape above and calls `window.store.saveSession(...)`, fire-and-forget (not awaited by callers, errors logged not surfaced — matches how mark saves behave today). Called at the end of `drawCard()`, `answerCard()`, and `skipCard()`.
- **`resetGame()`** (covers "One more round" and starting a favorites round): after building the fresh shuffled deck, calls `saveCurrentSession()` (overwrite, no separate `clearSession()` call first — `saveSession` is already an upsert/overwrite, so clearing first only adds a race between the DELETE and the PUT landing out of order). This makes the newly-started round itself immediately resumable.
- **Game completion** (`answerCard()` reaching `deck.length === 0` → `showGameOver()`): calls `clearSession()` — a finished deck has nothing left to resume, so the next load should start fresh without prompting.
- **Boot sequence**: after `loadQuestions()` / `loadPacks()` / `loadMarks()` resolve, call `loadSession()`.
  - If `null` (or resolves to an effectively-empty session — no keys and no current card): proceed exactly as today, `resetGame()` with no prompt.
  - If a non-empty resumable session exists: skip the immediate `resetGame()` call and instead render the resume-choice screen (see below).
- **Post-auth-change re-sync (`updateAuthUI`)**: this does **not** use the plain `resetGame()` trigger above. On the Supabase backend, `client.auth.getSession()` resolves asynchronously after the initial boot sequence has already run (`store-supabase.js`), so boot's `loadSession()` can complete signed-out (returning `null`, `resetGame()` runs) *before* `onAuthChange` later fires with a real session. If `updateAuthUI` then unconditionally called `resetGame()`, it would immediately overwrite whatever session that user had saved remotely, before ever offering to resume it. Instead, `updateAuthUI` must re-run the same boot logic: `loadPacks()` + `loadMarks()` (as today), then `loadSession()` → resume-prompt-or-`resetGame()`, exactly as at boot.

### Known limitation: concurrent tabs/devices

Autosave is last-write-wins with no locking or merge — if the same account is played simultaneously in two tabs or on two devices, whichever save lands last overwrites the other, and a tab that finished/cleared its game can have that clear undone by a stale autosave from another still-open tab. This is an accepted limitation given the app's single-player, personal-use scope; not addressed further here.

### Signed-out behavior (Supabase backend)

`saveSession`/`clearSession`/`loadSession` must no-op safely when there is no active session (mirroring the existing `if (!session) return ...` guards already used by `loadMarks`/`loadPacks` in `store-supabase.js`) rather than attempting a write that RLS would reject.

## Resume UI

No new modal — reuse the existing empty-state screen (`#emptyState`) real estate. Rehydration (deck/discard/score/etc., with unresolvable keys already dropped per the Data model section above) happens first; the resume prompt is only shown if anything survives that filtering. Then, in place of the normal "Draw a Card" prompt:

> "You have a game in progress — **{N} cards left**, score **{score}**."
> **[Resume]**  **[Start Fresh]**

- **Resume**: applies the already-rehydrated state (`deck`/`discard`/`score`/`questionsAnswered`/`rarestAnswered`/`sessionHearts`), calls `updateUI()` and `renderAnsweredList()`, then either re-renders and shows the in-progress card (if `currentKey` resolved) or falls through to the normal empty-state draw screen.
- **Start Fresh**: calls `clearSession()` then `resetGame()`, exactly as today's boot behavior.

If, after dropping unresolvable keys, the rehydrated session turns out to be fully empty (e.g. every saved question was since deleted), treat it the same as "no session found" — skip the prompt and call `resetGame()` directly.

## Testing

- `test_server.py`: new tests for the 3 session endpoints — save-then-load round-trip, clear removes it, loading with nothing saved returns `null`/no session, and the existing body-size/content-type hardening tests extended to cover `/api/session`.
- Manual verification (per this project's `/verify` skill) of the end-to-end flow in a browser: draw a few cards, reload, confirm the resume prompt appears with the right count; click Resume and confirm no duplicate cards are drawn; click Start Fresh and confirm a normal fresh shuffle; play a full deck to completion and confirm the next reload does *not* prompt.
