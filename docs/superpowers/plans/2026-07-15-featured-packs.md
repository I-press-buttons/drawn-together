# Featured Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship read-only "featured packs" (first: Biblical Marriage, 42 questions) bundled with the app, visible to every visitor on both deployment targets, individually toggleable per viewer.

**Architecture:** A static `featured_packs.json` at repo root is fetched by `app.js` alongside `questions.json`. Only the per-viewer on/off preference persists, via two new `window.store` methods implemented in both store backends: `server.py` stores a `featuredPackPrefs` map in `user_data.json` behind two new routes; Supabase stores per-user rows in a new RLS table for signed-in users and a `localStorage` blob for anonymous visitors. Question qkeys use a new `f<key>-<id>` prefix so marks never collide with base (`b<n>`) or custom (`p<id>-<qid>`) questions.

**Tech Stack:** Vanilla JS (single IIFE `app.js`), Python stdlib server, Supabase Postgres + RLS, `unittest`.

## Global Constraints

- Zero dependencies: no frameworks, no build step, no package.json (CLAUDE.md).
- Store interface changes must land in **both** `store-server.js` and `store-supabase.js` with the identical shape; `app.js` never branches on `window.DT_BACKEND`.
- New shipped files go in **both** the Dockerfile `COPY` line and the Pages workflow "Assemble static site" `cp` line.
- Featured question qkey format: `f<key>-<id>`, e.g. `fbiblical-marriage-1`.
- Prefs default: **enabled**. `loadFeaturedPackPrefs()` returns only overrides; a missing key means enabled.
- Featured content is read-only: no add/edit/delete/move UI, no chevron/expand in the modal.
- After each commit on `main`, push immediately (`git push`) — direct pushes are the publish flow.
- No generic `.hidden` CSS rule exists; this plan doesn't add any new `classList.toggle('hidden', …)` targets (the featured cards are re-rendered via `innerHTML`), so no new CSS rules are required.
- Run the full API suite with `python3 -m unittest test_server.py`; a single test with `python3 -m unittest test_server.PackAPITest.test_name`.

---

### Task 1: `featured_packs.json` content + deployment wiring

The 42 approved Biblical Marriage questions currently live only in the **gitignored local** `question_packs.json` (custom pack id 3). Extract them by script — do not retype them.

**Files:**
- Create: `featured_packs.json` (repo root, committed)
- Modify: `Dockerfile:3` (COPY line)
- Modify: `.github/workflows/pages.yml:29` (cp line)

**Interfaces:**
- Consumes: local `question_packs.json` pack named "Biblical Marriage" (id 3, 42 questions, 7 per rarity tier, category "Faith").
- Produces: `featured_packs.json` — a JSON array of `{ key: string, name: string, questions: [{ id: number, text: string, rarity: string, category: string }] }`. First entry has `key: "biblical-marriage"`, `name: "Biblical Marriage"`. Every later task reads this shape.

- [ ] **Step 1: Generate the file**

Run from the repo root:

```sh
python3 - <<'EOF'
import json
packs = json.load(open('question_packs.json'))
src = next(p for p in packs if p['name'] == 'Biblical Marriage')
featured = [{
    'key': 'biblical-marriage',
    'name': 'Biblical Marriage',
    'questions': [
        {'id': q['id'], 'text': q['text'], 'rarity': q['rarity'], 'category': q['category']}
        for q in src['questions']
    ],
}]
with open('featured_packs.json', 'w') as f:
    f.write(json.dumps(featured, indent=2, ensure_ascii=False) + '\n')
print('wrote', len(featured[0]['questions']), 'questions')
EOF
```

Expected output: `wrote 42 questions`

- [ ] **Step 2: Verify content shape**

```sh
python3 - <<'EOF'
import json
from collections import Counter
data = json.load(open('featured_packs.json'))
assert len(data) == 1 and data[0]['key'] == 'biblical-marriage'
qs = data[0]['questions']
assert len(qs) == 42, len(qs)
assert Counter(q['rarity'] for q in qs) == {r: 7 for r in ('common','uncommon','rare','epic','legendary','mythic')}
assert all(q['category'] == 'Faith' for q in qs)
assert len({q['id'] for q in qs}) == 42
print('OK')
EOF
```

Expected: `OK`

- [ ] **Step 3: Add to Dockerfile COPY line**

In `Dockerfile`, change line 3 to:

```dockerfile
COPY server.py index.html style.css app.js config.js store-server.js questions.json featured_packs.json ./
```

- [ ] **Step 4: Add to Pages workflow assemble step**

In `.github/workflows/pages.yml`, change the `cp index.html …` line to:

```yaml
          cp index.html style.css app.js store-server.js store-supabase.js questions.json featured_packs.json _site/play/
```

- [ ] **Step 5: Sanity-check the diff for personal data, then commit and push**

Skim `git diff --cached` output for personal paths/data (CLAUDE.md rule), then:

```bash
git add featured_packs.json Dockerfile .github/workflows/pages.yml
git commit -m "feat: ship featured_packs.json with Biblical Marriage pack"
git push
```

---

### Task 2: `server.py` featured-pack-prefs API + `f`-prefix mark keys

**Files:**
- Modify: `server.py` (module constants ~line 26, `load_user_data` ~line 42, `do_GET` ~line 144, `do_PUT` ~line 280)
- Test: `test_server.py`

**Interfaces:**
- Consumes: `featured_packs.json` (Task 1) read from the server's own directory for key validation.
- Produces:
  - `GET /api/featured-pack-prefs` → `200` with the prefs map, e.g. `{}` or `{"biblical-marriage": false}`.
  - `PUT /api/featured-pack-prefs/<key>` with body `{"enabled": bool}` → `200` with the **full updated map**; `400` if `enabled` is missing/non-boolean; `404` if `<key>` is not in `featured_packs.json`.
  - `server.FEATURED_PACKS_FILE` — module-level `Path`, overridable by tests (same pattern as `server.DATA_FILE`).
  - Marks accept qkeys matching `f<slug>-<n>` (e.g. `fbiblical-marriage-1`).
  - `user_data.json` gains a `featuredPackPrefs` object that survives every other user-data write.

- [ ] **Step 1: Write the failing tests**

In `test_server.py`, extend `setUpClass` (after the `server.USER_DATA_FILE` line):

```python
        server.FEATURED_PACKS_FILE = Path(cls._tmpdir.name) / "featured_packs.json"
```

Extend `setUp` (after the existing two `write_text` lines):

```python
        server.FEATURED_PACKS_FILE.write_text(json.dumps([
            {"key": "biblical-marriage", "name": "Biblical Marriage", "questions": []}
        ]))
```

Add a new test section (e.g. after the marks tests):

```python
    # ── Featured pack prefs ──

    def test_featured_prefs_default_empty(self):
        status, prefs = self.request("GET", "/api/featured-pack-prefs")
        self.assertEqual(status, 200)
        self.assertEqual(prefs, {})

    def test_set_featured_pref(self):
        status, prefs = self.request(
            "PUT", "/api/featured-pack-prefs/biblical-marriage", {"enabled": False})
        self.assertEqual(status, 200)
        self.assertEqual(prefs, {"biblical-marriage": False})
        status, prefs = self.request("GET", "/api/featured-pack-prefs")
        self.assertEqual(prefs, {"biblical-marriage": False})
        status, prefs = self.request(
            "PUT", "/api/featured-pack-prefs/biblical-marriage", {"enabled": True})
        self.assertEqual(prefs, {"biblical-marriage": True})

    def test_set_featured_pref_unknown_key_404(self):
        status, err = self.request(
            "PUT", "/api/featured-pack-prefs/no-such-pack", {"enabled": False})
        self.assertEqual(status, 404)
        self.assertIn("error", err)

    def test_set_featured_pref_requires_boolean(self):
        for bad in ({}, {"enabled": "false"}, {"enabled": 0}):
            status, err = self.request(
                "PUT", "/api/featured-pack-prefs/biblical-marriage", bad)
            self.assertEqual(status, 400)
            self.assertIn("error", err)

    def test_featured_prefs_survive_other_user_data_writes(self):
        """load_user_data must round-trip featuredPackPrefs, not drop it."""
        self.request("PUT", "/api/featured-pack-prefs/biblical-marriage", {"enabled": False})
        self.request("POST", "/api/marks/favorites/b12")
        self.request("PUT", "/api/session", {"score": 3})
        status, prefs = self.request("GET", "/api/featured-pack-prefs")
        self.assertEqual(prefs, {"biblical-marriage": False})
        status, marks = self.request("GET", "/api/marks")
        self.assertEqual(set(marks.keys()), {"favorites", "retired"})

    def test_mark_featured_question(self):
        status, marks = self.request("POST", "/api/marks/favorites/fbiblical-marriage-3")
        self.assertEqual(status, 200)
        self.assertEqual(marks["favorites"], ["fbiblical-marriage-3"])
        status, marks = self.request("DELETE", "/api/marks/favorites/fbiblical-marriage-3")
        self.assertEqual(marks["favorites"], [])

    def test_mark_invalid_featured_key_rejected(self):
        for bad in ("f-1", "fUPPER-1", "fbiblical-marriage-", "fbiblical-marriage-x"):
            status, err = self.request("POST", f"/api/marks/favorites/{bad}")
            self.assertEqual(status, 400)
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m unittest test_server.py -v 2>&1 | tail -20`
Expected: the new `test_featured_*` / `test_mark_featured_*` tests FAIL (404 responses / 400 on the mark), pre-existing tests still pass.

- [ ] **Step 3: Implement in `server.py`**

Add after the `MARK_KEY_RE` line (~line 26), replacing the old regex:

```python
MARK_KEY_RE = re.compile(r"^(b\d+|p\d+-\d+|f[a-z0-9][a-z0-9-]*-\d+)$")

# Shipped featured-pack content lives next to server.py (static, read-only),
# not in DATA_DIR — it's code, not user data. Tests point this elsewhere.
FEATURED_PACKS_FILE = Path(__file__).parent / "featured_packs.json"


def load_featured_pack_keys():
    if FEATURED_PACKS_FILE.exists():
        try:
            return {p["key"] for p in json.loads(FEATURED_PACKS_FILE.read_text())}
        except (json.JSONDecodeError, OSError, TypeError, KeyError):
            pass
    return set()
```

Note the invalid-key regex nuance: `f[a-z0-9][a-z0-9-]*-\d+` requires the slug to start with a lowercase alphanumeric and the id to be digits, which is what makes the `test_mark_invalid_featured_key_rejected` cases fail validation.

In `load_user_data`, add before `return data`:

```python
    prefs = raw.get("featuredPackPrefs", {})
    data["featuredPackPrefs"] = dict(prefs) if isinstance(prefs, dict) else {}
```

In `do_GET`, add alongside the other API routes (before the static-files fallthrough):

```python
        # ── Featured pack prefs (per-viewer on/off) ──
        if self.path == "/api/featured-pack-prefs":
            json_response(self, load_user_data()["featuredPackPrefs"])
            return
```

In `do_PUT`, add before the final `json_response(self, {"error": "Not found"}, 404)`:

```python
        # ── Set a featured pack pref ──
        m = re.match(r"^/api/featured-pack-prefs/([a-z0-9-]+)$", self.path)
        if m:
            key = m.group(1)
            body = read_json_body(self)
            if body is None:
                return
            if not isinstance(body, dict) or not isinstance(body.get("enabled"), bool):
                json_response(self, {"error": "enabled (boolean) required"}, 400)
                return
            if key not in load_featured_pack_keys():
                json_response(self, {"error": "Unknown featured pack"}, 404)
                return
            with PACKS_LOCK:
                data = load_user_data()
                data["featuredPackPrefs"][key] = body["enabled"]
                save_user_data(data)
            json_response(self, data["featuredPackPrefs"])
            return
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `python3 -m unittest test_server.py`
Expected: `OK` (all tests, old and new).

- [ ] **Step 5: Commit and push**

```bash
git add server.py test_server.py
git commit -m "feat: featured-pack-prefs API and f-prefix mark keys (server)"
git push
```

---

### Task 3: Store interface in both backends + Supabase schema

**Files:**
- Modify: `store-server.js` (insert after `clearSession`, ~line 87)
- Modify: `store-supabase.js` (insert after `clearSession`, ~line 170; helper near `EMPTY_MARKS`, ~line 21)
- Modify: `supabase/schema.sql` (append)

**Interfaces:**
- Consumes: Task 2's routes (server backend); new `featured_pack_prefs` table (Supabase backend).
- Produces, on `window.store` in **both** files with the identical shape:
  - `async loadFeaturedPackPrefs()` → `{ [key: string]: boolean }` (only overrides present; `{}` on any failure).
  - `async setFeaturedPackPref(key, enabled)` → the full updated map on success, `null` on failure (mirrors `setMark`'s return-the-new-state convention).

- [ ] **Step 1: Add methods to `store-server.js`**

Insert after the `clearSession` method (before the `/* Sharing is not available… */` block):

```js
    async loadFeaturedPackPrefs() {
      try { return (await json(await fetch('/api/featured-pack-prefs'))) || {}; }
      catch (e) { return {}; }
    },
    async setFeaturedPackPref(key, enabled) {
      try {
        const res = await fetch(`/api/featured-pack-prefs/${key}`, {
          method: 'PUT', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ enabled }),
        });
        return json(res);
      } catch (e) { return null; }
    },
```

- [ ] **Step 2: Add methods to `store-supabase.js`**

Insert a helper next to `EMPTY_MARKS` (top of the IIFE):

```js
  /* Anonymous visitors have no account row to store the toggle in — keep it
     device-local. Signed-in users use the featured_pack_prefs table instead. */
  const FEATURED_PREFS_LS_KEY = 'dt_featured_pack_prefs';
  function readLocalFeaturedPrefs() {
    try { return JSON.parse(localStorage.getItem(FEATURED_PREFS_LS_KEY)) || {}; }
    catch (e) { return {}; }
  }
```

Insert the two methods after `clearSession` (before `ready()`):

```js
    async loadFeaturedPackPrefs() {
      if (!session) return readLocalFeaturedPrefs();
      const { data, error } = await client.from('featured_pack_prefs')
        .select('pack_key, enabled');
      if (error) return {};
      const prefs = {};
      for (const row of data) prefs[row.pack_key] = row.enabled;
      return prefs;
    },
    async setFeaturedPackPref(key, enabled) {
      if (!session) {
        const prefs = readLocalFeaturedPrefs();
        prefs[key] = enabled;
        try { localStorage.setItem(FEATURED_PREFS_LS_KEY, JSON.stringify(prefs)); }
        catch (e) { return null; }
        return prefs;
      }
      const { error } = await client.from('featured_pack_prefs')
        .upsert({ pack_key: key, enabled });
      return error ? null : this.loadFeaturedPackPrefs();
    },
```

(The bare `upsert({ pack_key, enabled })` with `user_id` defaulting to `auth.uid()` and conflict resolution on the composite PK is the exact pattern the existing `marks` upsert at `store-supabase.js:148` already uses.)

- [ ] **Step 3: Append the table + policy to `supabase/schema.sql`**

Append at the end of the file (copy verbatim from the spec):

```sql
-- Per-viewer on/off toggle for shipped featured packs (content is static in
-- featured_packs.json; only the preference is stored). Missing row = enabled.
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

- [ ] **Step 4: Syntax-check both store files**

Run: `node --check store-server.js && node --check store-supabase.js && echo SYNTAX-OK`
Expected: `SYNTAX-OK`

- [ ] **Step 5: Verify the server-backend methods end-to-end**

Run:

```sh
DATA_DIR=$(mktemp -d) PORT=8156 python3 server.py & SRV=$!; sleep 1
curl -s http://localhost:8156/api/featured-pack-prefs
curl -s -X PUT http://localhost:8156/api/featured-pack-prefs/biblical-marriage \
  -H 'Content-Type: application/json' -d '{"enabled": false}'
kill $SRV
```

Expected output lines: `{}` then `{"biblical-marriage": false}` (real `featured_packs.json` from Task 1 validates the key).

- [ ] **Step 6: Commit and push**

```bash
git add store-server.js store-supabase.js supabase/schema.sql
git commit -m "feat: featured-pack-pref store methods (both backends) and schema"
git push
```

---

### Task 4: `app.js` data layer — load featured packs, merge into the deck

**Files:**
- Modify: `app.js` — `loadQuestions` area (~line 14), packs/marks section (~line 79), `findQuestionByKey` (~line 107), `getAllQuestions` (~line 179), `syncDeckWithPack` (~line 907), `updateAuthUI` (~line 884), boot IIFE (~line 1722)

**Interfaces:**
- Consumes: `featured_packs.json` shape from Task 1; `window.store.loadFeaturedPackPrefs()` / `setFeaturedPackPref(key, enabled)` from Task 3.
- Produces (used by Task 5's UI):
  - `const FEATURED_PACKS` — array of `{ key, name, questions }` loaded at boot.
  - `isFeaturedPackEnabled(key)` → boolean (`featuredPrefs[key] !== false`).
  - `featuredCards(fp)` → array of card objects `{ text, rarity, category, pack, qkey: 'f<key>-<id>' }`.
  - `async toggleFeaturedPack(key, enabled)` → boolean; optimistic-map update via the store, toast + reload on failure (mirrors `setMark`).
  - `syncDeckWithCards(prefix, cards, enabled)` — generalized deck-reconcile helper; `syncDeckWithPack(pack)` now delegates to it.

- [ ] **Step 1: Add featured-pack state and loaders**

In `app.js`, immediately after the `loadQuestions` function (~line 20), add:

```js
  /* ── Featured packs (shipped, read-only content) ── */
  const FEATURED_PACKS = [];
  let featuredPrefs = {};   /* { [key]: boolean } — only overrides; missing key = enabled */

  async function loadFeaturedPacks() {
    try {
      const res = await fetch('featured_packs.json');
      if (res.ok) FEATURED_PACKS.push(...await res.json());
    } catch (e) { /* fetch failed — featured section stays empty */ }
  }

  async function loadFeaturedPrefs() {
    featuredPrefs = await window.store.loadFeaturedPackPrefs();
  }

  function isFeaturedPackEnabled(key) { return featuredPrefs[key] !== false; }

  function featuredCards(fp) {
    return fp.questions.map(q => ({
      text: q.text,
      rarity: q.rarity,
      category: q.category || 'Custom',
      pack: fp.name,
      qkey: `f${fp.key}-${q.id}`,
    }));
  }

  /* Optimistic-ish toggle: persist via the store, adopt the returned map. */
  async function toggleFeaturedPack(key, enabled) {
    const updated = await window.store.setFeaturedPackPref(key, enabled);
    if (updated) { featuredPrefs = updated; return true; }
    await loadFeaturedPrefs();
    showToast("Couldn't save that — check the connection");
    return false;
  }
```

- [ ] **Step 2: Extend `findQuestionByKey`**

In `findQuestionByKey` (~line 107), after the `const base = …; if (base) return base;` lines and before the custom-pack loop, add:

```js
    for (const fp of FEATURED_PACKS) {
      for (const q of fp.questions) {
        if (`f${fp.key}-${q.id}` === qkey) {
          return { text: q.text, rarity: q.rarity, category: q.category || 'Custom', qkey };
        }
      }
    }
```

- [ ] **Step 3: Extend `getAllQuestions`**

Replace the body of `getAllQuestions` (~line 179) with:

```js
  function getAllQuestions() {
    let extra = [];
    for (const fp of FEATURED_PACKS) {
      if (!isFeaturedPackEnabled(fp.key)) continue;
      extra.push(...featuredCards(fp));
    }
    for (const pack of questionPacks) {
      if (!pack.enabled) continue;
      for (const q of pack.questions) {
        extra.push({
          text: q.text,
          rarity: q.rarity,
          category: q.category || 'Custom',
          pack: pack.name,
          qkey: `p${pack.id}-${q.id}`,
        });
      }
    }
    const all = extra.length === 0 ? [...QUESTIONS] : [...QUESTIONS, ...extra];
    return all.filter(q => !isRetired(q.qkey));
  }
```

- [ ] **Step 4: Generalize the deck-sync helper**

Replace `syncDeckWithPack` (~line 907) with the pair below. The body of `syncDeckWithCards` is the existing logic verbatim, parameterized on `(prefix, cards, enabled)` — this is the toggle sync path from commit `7ee3c4c` that featured packs must reuse:

```js
  /* Reconcile the live deck after a pack toggle: shuffle the pack's cards in
     when it's enabled, pull them out when it's disabled. Cards already drawn
     (currentCard) or answered (discard) stay put. */
  function syncDeckWithCards(prefix, cards, enabled) {
    if (enabled) {
      const inPlay = new Set([...deck, ...discard, ...skipped].map(q => q.qkey));
      if (currentCard) inPlay.add(currentCard.qkey);
      const additions = cards.filter(q => !inPlay.has(q.qkey) && !isRetired(q.qkey));
      if (additions.length > 0) deck = shuffle([...deck, ...additions]);
    } else {
      deck = deck.filter(q => !q.qkey.startsWith(prefix));
      skipped = skipped.filter(q => !q.qkey.startsWith(prefix));
    }
    updateUI();
    if (!currentCard && deck.length > 0 && !$gameOver.classList.contains('hidden')) {
      $gameOver.classList.add('hidden');
      showEmptyState();
    }
    saveCurrentSession();
  }

  function syncDeckWithPack(pack) {
    const prefix = `p${pack.id}-`;
    const cards = pack.questions.map(q => ({
      text: q.text,
      rarity: q.rarity,
      category: q.category || 'Custom',
      pack: pack.name,
      qkey: `${prefix}${q.id}`,
    }));
    syncDeckWithCards(prefix, cards, pack.enabled);
  }
```

- [ ] **Step 5: Load prefs at boot and on auth changes**

In the boot IIFE (~line 1722), change `await loadQuestions();` to:

```js
    await Promise.all([loadQuestions(), loadFeaturedPacks()]);
```

and change `await Promise.all([loadPacks(), loadMarks()]);` to:

```js
    await Promise.all([loadPacks(), loadMarks(), loadFeaturedPrefs()]);
```

In `updateAuthUI` (~line 884), change the `Promise.all` line to (sign-in/out switches between localStorage and Supabase prefs, so re-pull):

```js
    Promise.all([loadPacks(), loadMarks(), loadFeaturedPrefs()]).then(() => {
```

- [ ] **Step 6: Syntax check + API suite still green**

Run: `node --check app.js && python3 -m unittest test_server.py && echo OK`
Expected: `OK` after the unittest `OK` line.

- [ ] **Step 7: Quick functional check (deck count includes featured questions)**

Run the server against a scratch data dir and confirm the merged deck via the API-facing bits you can reach headlessly:

```sh
DATA_DIR=$(mktemp -d) PORT=8156 python3 server.py & SRV=$!; sleep 1
curl -s http://localhost:8156/featured_packs.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d[0]['questions']))"
kill $SRV
```

Expected: `42` (full browser verification happens in Task 6).

- [ ] **Step 8: Commit and push**

```bash
git add app.js
git commit -m "feat: merge featured packs into the live deck (app.js data layer)"
git push
```

---

### Task 5: `app.js` packs-modal UI — featured section + toggle

**Files:**
- Modify: `app.js` — `renderPacks` (~line 334, after the Base Game card block) and `bindPackEvents` (~line 491)

**Interfaces:**
- Consumes: `FEATURED_PACKS`, `isFeaturedPackEnabled(key)`, `featuredCards(fp)`, `toggleFeaturedPack(key, enabled)`, `syncDeckWithCards(prefix, cards, enabled)` from Task 4; existing CSS classes `pack-card`, `pack-card-off`, `pack-header`, `pack-toggle`, `pack-toggle-knob`, `pack-name`, `pack-base-tag`, `pack-count`.
- Produces: featured-pack cards rendered between the Base Game card and the custom-packs list, each with a live toggle (`data-featured-toggle="<key>"`). No chevron, no expand, no edit/delete/add affordances. Anonymous visitors can toggle (no `requireSignIn` gate).

- [ ] **Step 1: Render the featured section**

In `renderPacks`, immediately after the Base Game card template (the `html = \`…\`;` block ending ~line 351) and **before** the `/* Custom packs */` loop, add:

```js
    /* Featured packs (shipped, read-only — toggle only, no expand/edit) */
    for (const fp of FEATURED_PACKS) {
      const on = isFeaturedPackEnabled(fp.key);
      const qCount = fp.questions.length;
      html += `
        <div class="pack-card ${on ? '' : 'pack-card-off'}">
          <div class="pack-header">
            <button class="pack-toggle ${on ? 'on' : ''}" data-featured-toggle="${escapeAttr(fp.key)}" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${escapeAttr(fp.name)}: ${on ? 'on, tap to disable' : 'off, tap to enable'}">
              <span class="pack-toggle-knob"></span>
            </button>
            <span class="pack-name">${escapeHTML(fp.name)}</span>
            <span class="pack-base-tag">Featured</span>
            <span class="pack-count">${qCount} ${qCount === 1 ? 'question' : 'questions'}</span>
          </div>
        </div>
      `;
    }
```

(Note: the header has no `data-pack-id`, so the existing expand/collapse binder skips it — clicking the card body does nothing, matching the Base Game card.)

- [ ] **Step 2: Bind the toggle**

In `bindPackEvents`, add as the first binder (before the `[data-toggle]` block):

```js
    /* Toggle featured pack on/off (works signed-out — it's per-viewer, free content) */
    document.querySelectorAll('[data-featured-toggle]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const key = btn.dataset.featuredToggle;
        const fp = FEATURED_PACKS.find(p => p.key === key);
        if (!fp) return;
        const next = !isFeaturedPackEnabled(key);
        if (await toggleFeaturedPack(key, next)) {
          syncDeckWithCards(`f${key}-`, featuredCards(fp), next);
        }
        renderPacks();
      });
    });
```

- [ ] **Step 3: Syntax check**

Run: `node --check app.js && echo SYNTAX-OK`
Expected: `SYNTAX-OK`

- [ ] **Step 4: Browser smoke test still passes**

Start a clean server and run the existing Playwright smoke test (it clicks the *first* `.pack-header`'s add-question form via `.pack-add-input`, which featured cards don't render, so it must stay green):

```sh
DATA_DIR=$(mktemp -d) PORT=8155 python3 server.py & SRV=$!; sleep 1
PORT=8155 node tools/smoke.mjs
kill $SRV
```

Expected: `SMOKE PASS` (needs `PLAYWRIGHT_DIR` set as documented in CLAUDE.md; if Playwright isn't available in this environment, note it and rely on Task 6's verification instead).

- [ ] **Step 5: Commit and push**

```bash
git add app.js
git commit -m "feat: featured packs section with per-viewer toggle in packs modal"
git push
```

---

### Task 6: README docs, placeholder cleanup, end-to-end verification

**Files:**
- Modify: `README.md` (features list ~top; Supabase setup step 1, ~line 88)
- Modify (local data only, **not committed** — both files are gitignored): `question_packs.json`, `user_data.json`

**Interfaces:**
- Consumes: everything above.
- Produces: documented upgrade step for existing Supabase deployments; local placeholder pack removed; verified feature.

- [ ] **Step 1: README — mention featured packs and the schema upgrade**

In the README features area, add a bullet (match the existing bullet style):

```markdown
- **Featured packs** — curated packs shipped with the game (starting with Biblical Marriage), shown to everyone and individually toggleable per viewer.
```

In the "Hosted web version" setup step 1 (the `run supabase/schema.sql` instruction), append:

```markdown
   Upgrading an existing deployment? Re-run the `featured_pack_prefs` table +
   policy statements at the bottom of `supabase/schema.sql` once in the SQL
   editor (every statement is `create … if not exists`-safe except policies —
   skip any `create policy` that already exists).
```

- [ ] **Step 2: Remove the local stand-in custom pack (id 3) and its marks**

This edits gitignored local data only. Stop any running local server first, then:

```sh
python3 - <<'EOF'
import json
packs = json.load(open('question_packs.json'))
before = len(packs)
packs = [p for p in packs if p['id'] != 3]
assert before - len(packs) == 1, "expected to remove exactly pack id 3"
open('question_packs.json', 'w').write(json.dumps(packs, indent=2, ensure_ascii=False))
ud = json.load(open('user_data.json'))
for lst in ('favorites', 'retired'):
    ud[lst] = [k for k in ud.get(lst, []) if not k.startswith('p3-')]
open('user_data.json', 'w').write(json.dumps(ud, indent=2, ensure_ascii=False))
print('removed placeholder pack + its marks')
EOF
```

Expected: `removed placeholder pack + its marks`

- [ ] **Step 3: Full test suite + syntax checks**

Run: `python3 -m unittest test_server.py && node --check app.js && node --check store-server.js && node --check store-supabase.js && echo ALL-OK`
Expected: unittest `OK`, then `ALL-OK`.

- [ ] **Step 4: Manual browser verification (self-hosted)**

Use the project's `verify` skill recipe (`/verify`) against `python3 server.py`, checking:
1. Packs modal shows "Biblical Marriage" with a `Featured` tag and `42 questions` between Base Game and custom packs — no chevron, no add/edit/delete.
2. Fresh game deck count is 150 (108 base + 42 featured, assuming no other packs/retired marks).
3. Toggle Biblical Marriage off mid-game → its undrawn cards leave the deck immediately; count drops; answered cards stay in the answered list. Toggle back on → cards shuffle back in.
4. Reload → the toggle state persisted (`user_data.json` now contains `featuredPackPrefs`).
5. Heart a featured question → it appears in Greatest Hits and survives reload.

- [ ] **Step 5: Commit and push**

Sanity-check `git status` — `question_packs.json`/`user_data.json` must **not** appear (gitignored). Then:

```bash
git add README.md
git commit -m "docs: featured packs in README + Supabase upgrade note"
git push
```

- [ ] **Step 6: Post-deploy manual steps (report to the user — cannot be automated)**

- Run the new `featured_pack_prefs` DDL once in the public deployment's Supabase SQL editor.
- On the public site after Pages deploys: verify the anonymous toggle persists across a reload (localStorage `dt_featured_pack_prefs`), and a signed-in toggle persists across a fresh sign-in on another browser/profile.

---

## Spec coverage map

| Spec section | Task |
|---|---|
| `featured_packs.json` data model, `f<key>-<id>` qkeys | 1 (file), 2 (mark regex), 4 (qkey construction) |
| Self-hosted persistence + routes + tests | 2 |
| Supabase table/RLS + anonymous localStorage | 3 |
| Store interface (both backends, identical shape) | 3 |
| Frontend: fetch, prefs load, deck merge, modal section, deck sync on toggle | 4, 5 |
| Deployment (Dockerfile, Pages workflow, schema DDL docs) | 1, 3, 6 |
| Rollout: Biblical Marriage content + placeholder removal | 1, 6 |
| Testing/verification | 2 (API), 5 (smoke), 6 (manual) |
