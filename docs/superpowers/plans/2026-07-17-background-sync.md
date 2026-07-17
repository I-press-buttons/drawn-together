# Per-Account Background Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chosen table background syncs per-account on both backends, while anonymous/offline behavior stays pure-localStorage.

**Architecture:** Mirrors the existing `featuredPackPrefs` pattern: two new store methods (`loadBackgroundPref` / `setBackgroundPref`) implemented in both `store-server.js` (new `/api/background` routes in `server.py`, persisted in `user_data.json`) and `store-supabase.js` (new `user_settings` table with RLS + check constraint). `app.js` keeps localStorage as the instant fast path; the account value wins when present.

**Tech Stack:** Vanilla JS, Python stdlib (`http.server`, `unittest`), Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-07-17-background-sync-design.md`

## Global Constraints

- Zero dependencies: vanilla JS, Python stdlib only, no build step (CLAUDE.md).
- Valid background keys, everywhere they are listed: `classic`, `treeline`, `lakeside`, `sunset`, `alpine`. Default: `alpine`.
- Service side validates keys: `server.py` via `BACKGROUND_KEYS` set (400 on unknown), Supabase via a `check` constraint.
- Both store files must expose the identical interface (CLAUDE.md).
- No new shipped files — Dockerfile and Pages workflow untouched.
- After each commit, push `main` (CLAUDE.md publish flow).
- Tests: `python3 -m unittest test_server.py` must pass at the end of every task.

---

### Task 1: `/api/background` routes in server.py

**Files:**
- Modify: `server.py` (constant near top by `MARK_LISTS`; `load_user_data` ~line 55; `do_GET` ~line 171; `do_PUT` — insert before the final 404 at ~line 395)
- Test: `test_server.py` (append tests inside `PackAPITest`)

**Interfaces:**
- Consumes: existing `load_user_data()` / `save_user_data()` / `PACKS_LOCK` / `json_response()` / `read_json_body()` helpers.
- Produces: `GET /api/background` → 200 `{"background": <key-or-null>}`; `PUT /api/background` body `{"background": "<key>"}` → 200 echo `{"background": key}`, or 400 `{"error": ...}` for missing/non-string/unknown keys. Tasks 2 and 5 rely on these exact shapes.

- [ ] **Step 1: Write the failing tests**

Append inside `class PackAPITest` in `test_server.py` (same style as the neighbors — the class already has `self.request`):

```python
    # ── Background pref ──

    def test_background_default_null(self):
        status, data = self.request("GET", "/api/background")
        self.assertEqual(status, 200)
        self.assertIsNone(data["background"])

    def test_set_background_and_read_back(self):
        status, data = self.request("PUT", "/api/background", {"background": "sunset"})
        self.assertEqual(status, 200)
        self.assertEqual(data["background"], "sunset")
        status, data = self.request("GET", "/api/background")
        self.assertEqual(status, 200)
        self.assertEqual(data["background"], "sunset")

    def test_set_background_unknown_key_400(self):
        status, err = self.request("PUT", "/api/background", {"background": "hawaii"})
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_set_background_bad_body_400(self):
        status, err = self.request("PUT", "/api/background", {"nope": True})
        self.assertEqual(status, 400)
        self.assertIn("error", err)
        status, err = self.request("PUT", "/api/background", {"background": 7})
        self.assertEqual(status, 400)
        self.assertIn("error", err)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest test_server.PackAPITest.test_background_default_null test_server.PackAPITest.test_set_background_and_read_back test_server.PackAPITest.test_set_background_unknown_key_400 test_server.PackAPITest.test_set_background_bad_body_400 -v` (from the repo root)

Expected: all four FAIL (GET falls through to static-file 404 → `json.loads` of HTML raises, or non-200 status; PUT hits the JSON 404).

- [ ] **Step 3: Implement**

In `server.py`, add the constant next to `MARK_LISTS` near the top of the file:

```python
BACKGROUND_KEYS = {"classic", "treeline", "lakeside", "sunset", "alpine"}
```

In `load_user_data()`, after the `featuredPackPrefs` line (`data["featuredPackPrefs"] = ...`), add:

```python
    bg = raw.get("background")
    data["background"] = bg if isinstance(bg, str) else None
```

In `do_GET`, after the `/api/featured-pack-prefs` block and before the `/api/session` block:

```python
        # ── Background pref ──
        if self.path == "/api/background":
            json_response(self, {"background": load_user_data()["background"]})
            return
```

In `do_PUT`, after the featured-pack-pref block and before the final `json_response(self, {"error": "Not found"}, 404)`:

```python
        # ── Set the background pref ──
        if self.path == "/api/background":
            body = read_json_body(self)
            if body is None:
                return
            key = body.get("background") if isinstance(body, dict) else None
            if not isinstance(key, str) or key not in BACKGROUND_KEYS:
                json_response(
                    self,
                    {"error": "background must be one of: " + ", ".join(sorted(BACKGROUND_KEYS))},
                    400,
                )
                return
            with PACKS_LOCK:
                data = load_user_data()
                data["background"] = key
                save_user_data(data)
            json_response(self, {"background": key})
            return
```

(The `isinstance(key, str)` guard matters: a non-hashable body value like a list would make `key in BACKGROUND_KEYS` raise `TypeError`.)

- [ ] **Step 4: Run the full suite**

Run: `python3 -m unittest test_server.py -v`
Expected: all tests PASS, including the four new ones.

- [ ] **Step 5: Commit and push**

```bash
git add server.py test_server.py
git commit -m "feat: /api/background routes with server-side key validation"
git push origin main
```

---

### Task 2: Background pref methods in store-server.js

**Files:**
- Modify: `store-server.js` (insert after `setFeaturedPackPref`, ~line 100, before the "Sharing is not available" comment)

**Interfaces:**
- Consumes: Task 1's `GET/PUT /api/background` (shapes above) and the file-local `json(res)` helper.
- Produces: `loadBackgroundPref()` → `Promise<string|null>`; `setBackgroundPref(key)` → `Promise<boolean>`. Task 4 calls exactly these names.

- [ ] **Step 1: Implement both methods**

Insert after the `setFeaturedPackPref` method (keep the trailing comma style):

```js
    async loadBackgroundPref() {
      try {
        const data = await json(await fetch('/api/background'));
        return data ? data.background : null;
      } catch (e) { return null; }
    },
    async setBackgroundPref(key) {
      try {
        const res = await fetch('/api/background', {
          method: 'PUT', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ background: key }),
        });
        return res.ok;
      } catch (e) { return false; }
    },
```

- [ ] **Step 2: Syntax check and manual round-trip**

Run: `node --check store-server.js`
Expected: exits 0, no output.

Round-trip against a real server (uses your scratchpad as a throwaway DATA_DIR):

```bash
DATA_DIR=$(mktemp -d) PORT=8199 python3 server.py &
sleep 1
curl -s http://localhost:8199/api/background            # expect {"background": null}
curl -s -X PUT -H 'Content-Type: application/json' -d '{"background":"lakeside"}' http://localhost:8199/api/background
curl -s http://localhost:8199/api/background            # expect {"background": "lakeside"}
kill %1
```

- [ ] **Step 3: Commit and push**

```bash
git add store-server.js
git commit -m "feat: background pref methods in server store"
git push origin main
```

---

### Task 3: Supabase table + store-supabase.js methods

**Files:**
- Modify: `supabase/schema.sql` (append after the `featured_pack_prefs` section at the end)
- Modify: `store-supabase.js` (insert after `setFeaturedPackPref`, ~line 199, before the `ready()` line)

**Interfaces:**
- Consumes: file-local `session` variable and `client` Supabase client.
- Produces: same interface as Task 2 — `loadBackgroundPref()` → `Promise<string|null>` (null when signed out), `setBackgroundPref(key)` → `Promise<boolean>` (false when signed out or on error, e.g. check-constraint violation).

- [ ] **Step 1: Add the table to schema.sql**

Append at the end of `supabase/schema.sql`:

```sql
create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  background text check (background in ('classic','treeline','lakeside','sunset','alpine')),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "own settings" on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: Add the store methods**

In `store-supabase.js`, insert after the `setFeaturedPackPref` method (before the `ready() { return readyPromise; },` line):

```js
    async loadBackgroundPref() {
      if (!session) return null;
      const { data, error } = await client.from('user_settings')
        .select('background').eq('user_id', session.user.id).maybeSingle();
      return (error || !data) ? null : data.background;
    },
    async setBackgroundPref(key) {
      if (!session) return false;
      const { error } = await client.from('user_settings')
        .upsert({ user_id: session.user.id, background: key, updated_at: new Date().toISOString() });
      return !error;
    },
```

- [ ] **Step 3: Syntax check**

Run: `node --check store-supabase.js`
Expected: exits 0, no output.

- [ ] **Step 4: Commit and push**

```bash
git add supabase/schema.sql store-supabase.js
git commit -m "feat: user_settings table and background pref methods in supabase store"
git push origin main
```

**Deployment note (for the final report, not a code step):** the new table SQL from Step 1 must be run once in the Supabase dashboard SQL editor — schema.sql is not auto-applied.

---

### Task 4: Wire background sync into app.js

**Files:**
- Modify: `app.js` — `setBackground` (~line 105), `loadBackground` (~line 124), a new `syncBackgroundFromAccount` beside them, the auth-change registration (~line 1888), and the async boot block (~line 2158)

**Interfaces:**
- Consumes: `window.store.loadBackgroundPref()` / `window.store.setBackgroundPref(key)` (Tasks 2–3), `window.store.signedIn()`.
- Produces: user-visible behavior only; nothing downstream consumes new symbols.

- [ ] **Step 1: Add a `skipSync` flag to `setBackground` and sync on explicit picks**

Replace the end of `setBackground` and `loadBackground` (currently lines 105–127). The full replacement for both functions:

```js
  function setBackground(key, skipSync) {
    if (!Object.prototype.hasOwnProperty.call(BACKGROUNDS, key)) key = 'alpine';
    const url = BACKGROUNDS[key];
    if (url) {
      $photoBg.style.backgroundImage = `url('${url}')`;
      $photoBg.classList.remove('hidden');
      $mountains.classList.add('hidden');
    } else {
      $photoBg.classList.add('hidden');
      $mountains.classList.remove('hidden');
    }
    $bgOptionList.querySelectorAll('.bg-option').forEach((opt) => {
      const isSelected = opt.dataset.bg === key;
      opt.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      opt.tabIndex = isSelected ? 0 : -1;
    });
    localStorage.setItem('dt-background', key);
    /* Explicit picks sync to the account; applying a stored/account value must not
       echo a write back (skipSync) — that would write on every page load. */
    if (!skipSync) window.store.setBackgroundPref(key).catch(() => {});
  }

  function loadBackground() {
    const saved = localStorage.getItem('dt-background');
    setBackground(saved || 'alpine', true);
  }

  /* Account value wins when present; local value stays otherwise. */
  async function syncBackgroundFromAccount() {
    try {
      const pref = await window.store.loadBackgroundPref();
      if (pref) setBackground(pref, true);
    } catch (e) { /* offline or signed out — keep local */ }
  }
```

The two user-pick call sites (`$bgOptionList` click handler ~line 1830 and keydown handler ~line 1848) stay exactly as they are — one-argument calls, so they sync.

- [ ] **Step 2: Sync at boot and on sign-in**

In the async boot block, `loadBackground()` (line ~2139) stays where it is (instant paint). Add `syncBackgroundFromAccount()` right after the existing `syncAccountUI();` call (~line 2157):

```js
    syncAccountUI();
    syncBackgroundFromAccount();
```

(Not awaited — it must not delay pack/mark loading; when it resolves it repaints only if the account value differs.)

For mid-session sign-in, extend the existing event-forwarding `onAuthChange` registration (~line 1888):

```js
  window.store.onAuthChange((event) => {
    if (event === 'SIGNED_IN') syncBackgroundFromAccount();
    if (event === 'PASSWORD_RECOVERY') {
      closeOverlay($authOverlay);
      openOverlay($resetPasswordOverlay);
    }
  });
```

- [ ] **Step 3: Syntax check and test suite**

Run: `node --check app.js && python3 -m unittest test_server.py`
Expected: both pass.

- [ ] **Step 4: Commit and push**

```bash
git add app.js
git commit -m "feat: background choice syncs per-account"
git push origin main
```

---

### Task 5: End-to-end verification (server backend)

**Files:** none modified — verification only.

**Interfaces:**
- Consumes: everything above, running in a real browser against `server.py`.

- [ ] **Step 1: Run the project verify skill's browser recipe**

Follow the project `verify` skill (build/launch/drive against the local server backend). Scenario to drive:

1. Load the app fresh (clean DATA_DIR) — Alpine background shows (default).
2. Open the background picker, choose **Sunset Ridge**.
3. In the browser console: `localStorage.removeItem('dt-background')`, then hard-reload.
4. Expected: after boot, the background returns to **Sunset Ridge** (restored from the server, not localStorage). `curl http://localhost:<PORT>/api/background` shows `{"background": "sunset"}`.

- [ ] **Step 2: Regression sweep**

Run: `python3 -m unittest test_server.py -v` and, if the Playwright rig is available, `PORT=8155 node tools/smoke.mjs` per CLAUDE.md.
Expected: all pass.

- [ ] **Step 3: Nothing to commit**

Report results; no code changes expected from this task.
