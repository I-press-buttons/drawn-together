# Resume Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player resume an in-progress game (remaining deck, discard pile, score) after a reload/close, or on another signed-in device, instead of always reshuffling and risking many repeat cards.

**Architecture:** A new `session` blob (deck/discard qkeys + score counters, no full question snapshots) is persisted through the existing `window.store` abstraction, alongside marks and packs. Both backends (local `server.py` JSON file, Supabase) get three new methods: `loadSession`/`saveSession`/`clearSession`. `app.js` autosaves after every draw/answer/skip and offers a "Resume vs Start Fresh" choice — reusing the existing empty-state screen — whenever a resumable session is found at boot or after an auth change.

**Tech Stack:** Vanilla JS, stdlib Python `http.server`, Supabase (Postgres + RLS + supabase-js), stdlib `unittest`.

## Global Constraints

- Persist **qkeys only**, never full question text/rarity snapshots — resume must always reflect the *current* state of packs/questions (design spec: Data model).
- A key only counts as resolvable if it would appear in a fresh `getAllQuestions()` result (i.e. its pack is enabled and it is not retired) — `findQuestionByKey` alone is NOT sufficient, it ignores both conditions (design spec: Data model).
- `resetGame()` must `saveSession(...)` directly (no `clearSession()` call beforehand — `saveSession` is already an overwrite, and calling both risks the DELETE landing after the PUT) (design spec: Triggers).
- `updateAuthUI()` must NOT unconditionally call `resetGame()` — it must re-run the same "load session, then resume-prompt-or-reset" logic as boot, so a just-signed-in user's remote session isn't clobbered before it can be offered (design spec: Triggers, "Post-auth-change re-sync").
- `GET /api/marks` must continue to return only `{"favorites": [...], "retired": [...]}` — never the raw stored blob, so the new `session` field can't leak into it (design spec: Storage / server.py).
- Supabase `loadSession`/`saveSession`/`clearSession` must no-op safely (return `null`/`false`) when there is no active auth session, mirroring the existing `if (!session) return ...` guards already used by `loadMarks`/`loadPacks` in `store-supabase.js`.
- No new npm/pip dependencies. No new test framework — `test_server.py` (stdlib `unittest`) is the only automated test surface in this repo; there is no existing JS unit-test harness, so `app.js`/`store-server.js`/`store-supabase.js` changes are verified by `node --check` (syntax) plus manual browser verification in the final task, consistent with how prior features in this repo (e.g. the answered-sidebar feature) were verified.

---

### Task 1: Server-side session storage (`server.py`)

**Files:**
- Modify: `server.py`
- Test: `test_server.py`

**Interfaces:**
- Produces: `load_session() -> dict | None`, `save_session(session: dict) -> None`, `clear_session() -> None` (module-level functions in `server.py`, used only by the request handler in this task).
- Produces (HTTP): `GET /api/session` → `{"session": {...} | null}`; `PUT /api/session` (body = session object) → `{"session": {...}}`, `400` if body isn't a JSON object; `DELETE /api/session` → `{"ok": true}`.
- Modifies existing behavior: `GET /api/marks` now explicitly returns only `{"favorites": [...], "retired": [...]}` (previously happened to already exclude extra keys as a side effect of `load_user_data()`'s reconstruction — this task makes it an explicit, permanent guarantee since `load_user_data()` is about to start carrying the `session` field too).

- [ ] **Step 1: Write the failing tests**

Open `test_server.py` and find the `# ── Mark cleanup ──` section (around line 259, right before `test_deleting_question_removes_its_marks`). Insert this new section immediately **before** it:

```python
    # ── Session (resume) ──

    def test_session_initially_null(self):
        status, body = self.request("GET", "/api/session")
        self.assertEqual(status, 200)
        self.assertIsNone(body["session"])

    def test_save_and_load_session(self):
        session = {
            "deckKeys": ["b1", "b2"], "discardKeys": [], "currentKey": None,
            "score": 3, "questionsAnswered": 1, "rarestKey": None, "sessionHearts": 0,
        }
        status, saved = self.request("PUT", "/api/session", session)
        self.assertEqual(status, 200)
        self.assertEqual(saved["session"], session)
        status, body = self.request("GET", "/api/session")
        self.assertEqual(status, 200)
        self.assertEqual(body["session"], session)

    def test_save_session_overwrites_previous(self):
        self.request("PUT", "/api/session", {"deckKeys": ["b1"]})
        self.request("PUT", "/api/session", {"deckKeys": ["b2", "b3"]})
        status, body = self.request("GET", "/api/session")
        self.assertEqual(status, 200)
        self.assertEqual(body["session"], {"deckKeys": ["b2", "b3"]})

    def test_clear_session(self):
        self.request("PUT", "/api/session", {"deckKeys": ["b1"]})
        status, body = self.request("DELETE", "/api/session")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})
        status, body = self.request("GET", "/api/session")
        self.assertEqual(status, 200)
        self.assertIsNone(body["session"])

    def test_clear_session_when_none_saved(self):
        status, body = self.request("DELETE", "/api/session")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})

    def test_save_session_rejects_non_object_body(self):
        status, err = self.request("PUT", "/api/session", ["not", "an", "object"])
        self.assertEqual(status, 400)
        self.assertIn("error", err)
        status, body = self.request("GET", "/api/session")
        self.assertIsNone(body["session"])

    def test_marks_endpoint_excludes_session(self):
        self.request("PUT", "/api/session", {"deckKeys": ["b1"]})
        status, marks = self.request("GET", "/api/marks")
        self.assertEqual(status, 200)
        self.assertEqual(set(marks.keys()), {"favorites", "retired"})

    def test_session_persists_to_user_data_file(self):
        session = {"deckKeys": ["b7"]}
        self.request("PUT", "/api/session", session)
        on_disk = json.loads(server.USER_DATA_FILE.read_text())
        self.assertEqual(on_disk["session"], session)

    def test_saving_session_preserves_existing_marks(self):
        self.request("POST", "/api/marks/favorites/b12")
        self.request("PUT", "/api/session", {"deckKeys": ["b1"]})
        status, marks = self.request("GET", "/api/marks")
        self.assertEqual(marks["favorites"], ["b12"])

    def test_adding_mark_preserves_existing_session(self):
        session = {"deckKeys": ["b1"]}
        self.request("PUT", "/api/session", session)
        self.request("POST", "/api/marks/favorites/b12")
        status, body = self.request("GET", "/api/session")
        self.assertEqual(body["session"], session)

```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest test_server -v 2>&1 | tail -40`
Expected: the 9 new tests fail (404s from the not-yet-existing `/api/session` route; `test_marks_endpoint_excludes_session` currently passes already — that's fine, it becomes a regression guard).

- [ ] **Step 3: Implement the storage functions and routes**

In `server.py`, replace the existing `load_user_data()` function (lines 42-49):

```python
def load_user_data():
    if USER_DATA_FILE.exists():
        try:
            raw = json.loads(USER_DATA_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            raw = {}
    else:
        raw = {}
    data = {k: list(raw.get(k, [])) for k in MARK_LISTS}
    data["session"] = raw.get("session")
    return data
```

Immediately after `save_user_data()` (currently lines 52-53) and before `remove_marks()`, add:

```python
def load_session():
    return load_user_data().get("session")


def save_session(session):
    data = load_user_data()
    data["session"] = session
    save_user_data(data)


def clear_session():
    data = load_user_data()
    data["session"] = None
    save_user_data(data)
```

In `do_GET`, replace:

```python
        # ── User marks (favorites / retired) ──
        if self.path == "/api/marks":
            json_response(self, load_user_data())
            return
```

with:

```python
        # ── User marks (favorites / retired) ──
        if self.path == "/api/marks":
            data = load_user_data()
            json_response(self, {k: data[k] for k in MARK_LISTS})
            return

        # ── Saved session (resume) ──
        if self.path == "/api/session":
            json_response(self, {"session": load_session()})
            return
```

At the very start of `do_PUT` (right after the `def do_PUT(self):` line, before the existing "Update a pack" block), insert:

```python
        # ── Save session (resume) ──
        if self.path == "/api/session":
            body = read_json_body(self)
            if body is None:
                return
            if not isinstance(body, dict):
                json_response(self, {"error": "Session must be a JSON object"}, 400)
                return
            with PACKS_LOCK:
                save_session(body)
            json_response(self, {"session": body})
            return

```

At the very start of `do_DELETE` (right after the `def do_DELETE(self):` line, before the existing "Delete entire pack" block), insert:

```python
        # ── Clear session (resume) ──
        if self.path == "/api/session":
            with PACKS_LOCK:
                clear_session()
            json_response(self, {"ok": True})
            return

```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m unittest test_server -v 2>&1 | tail -50`
Expected: all tests pass (existing 32 + 9 new = 41 total, `OK`).

- [ ] **Step 5: Commit**

```bash
git add server.py test_server.py
git commit -m "feat: add session storage endpoints for resume feature"
```

---

### Task 2: Local-server store client (`store-server.js`)

**Files:**
- Modify: `store-server.js`

**Interfaces:**
- Consumes: `GET/PUT/DELETE /api/session` from Task 1.
- Produces: `window.store.loadSession()`, `window.store.saveSession(session)`, `window.store.clearSession()` — used by `app.js` in Task 4.

- [ ] **Step 1: Add the three methods**

In `store-server.js`, the object literal assigned to `window.store` currently ends with the marks methods followed by the auth no-ops:

```js
    async setMark(list, qkey, on) {
      try {
        const res = await fetch(`/api/marks/${list}/${qkey}`, { method: on ? 'POST' : 'DELETE' });
        return json(res);
      } catch (e) { return null; }
    },

    /* Auth is a no-op on the local server. */
```

Insert the new methods between `setMark` and the auth comment:

```js
    async setMark(list, qkey, on) {
      try {
        const res = await fetch(`/api/marks/${list}/${qkey}`, { method: on ? 'POST' : 'DELETE' });
        return json(res);
      } catch (e) { return null; }
    },
    async loadSession() {
      try {
        const data = await json(await fetch('/api/session'));
        return data ? data.session : null;
      } catch (e) { return null; }
    },
    async saveSession(session) {
      try {
        const res = await fetch('/api/session', {
          method: 'PUT', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(session),
        });
        return res.ok;
      } catch (e) { return false; }
    },
    async clearSession() {
      try { return (await fetch('/api/session', { method: 'DELETE' })).ok; }
      catch (e) { return false; }
    },

    /* Auth is a no-op on the local server. */
```

- [ ] **Step 2: Syntax-check**

Run: `node --check store-server.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Manually verify against the running server**

Run: `python3 server.py &` (background), then in another shell:

```bash
curl -s -X PUT localhost:8080/api/session -H 'Content-Type: application/json' -d '{"deckKeys":["b1"]}'
curl -s localhost:8080/api/session
curl -s -X DELETE localhost:8080/api/session
curl -s localhost:8080/api/session
```

Expected output, in order:
```
{"session": {"deckKeys": ["b1"]}}
{"session": {"deckKeys": ["b1"]}}
{"ok": true}
{"session": null}
```

Then stop the server: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add store-server.js
git commit -m "feat: add session methods to the local-server store client"
```

---

### Task 3: Supabase store client + schema (`store-supabase.js`, `supabase/schema.sql`)

**Files:**
- Modify: `store-supabase.js`
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: `window.store.loadSession()`, `window.store.saveSession(session)`, `window.store.clearSession()` for the Supabase backend — same signatures as Task 2, used interchangeably by `app.js`.

- [ ] **Step 1: Add the `sessions` table and RLS policy to the schema**

In `supabase/schema.sql`, after the existing `public.marks` table definition and before the `alter table ... enable row level security` block:

```sql
create table if not exists public.marks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list text not null check (list in ('favorites','retired')),
  qkey text not null check (char_length(qkey) between 1 and 80),
  primary key (user_id, list, qkey)
);

create table if not exists public.sessions (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.packs enable row level security;
alter table public.questions enable row level security;
alter table public.marks enable row level security;
alter table public.sessions enable row level security;

create policy "own packs" on public.packs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own questions" on public.questions
  for all using (
    exists (select 1 from public.packs p where p.id = pack_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.packs p where p.id = pack_id and p.user_id = auth.uid())
  );

create policy "own marks" on public.marks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own session" on public.sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

(This replaces the tail of the file from the `public.marks` table definition through the final `create policy` — the new `sessions` table, its RLS enable line, and its policy are inserted in the natural spots alongside the existing three tables/policies.)

- [ ] **Step 2: Add the three methods to `store-supabase.js`**

The object literal currently has `setMark` immediately followed by `signedIn()`:

```js
    async setMark(list, qkey, on) {
      const op = on
        ? client.from('marks').upsert({ list, qkey })
        : client.from('marks').delete().match({ list, qkey });
      const { error } = await op;
      return error ? null : this.loadMarks();
    },

    signedIn() { return !!session; },
```

Insert the new methods between them:

```js
    async setMark(list, qkey, on) {
      const op = on
        ? client.from('marks').upsert({ list, qkey })
        : client.from('marks').delete().match({ list, qkey });
      const { error } = await op;
      return error ? null : this.loadMarks();
    },
    async loadSession() {
      if (!session) return null;
      const { data, error } = await client.from('sessions')
        .select('data').eq('user_id', session.user.id).maybeSingle();
      if (error || !data) return null;
      return data.data;
    },
    async saveSession(sessionState) {
      if (!session) return false;
      const { error } = await client.from('sessions')
        .upsert({ user_id: session.user.id, data: sessionState, updated_at: new Date().toISOString() });
      return !error;
    },
    async clearSession() {
      if (!session) return false;
      const { error } = await client.from('sessions').delete().eq('user_id', session.user.id);
      return !error;
    },

    signedIn() { return !!session; },
```

- [ ] **Step 3: Syntax-check**

Run: `node --check store-supabase.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Note for manual Supabase deployment (no automated verification here)**

`supabase/schema.sql` is a manual "paste into the Supabase SQL editor and run once" script (per its own header) — it is not applied automatically to any already-provisioned project. There is nothing to run/verify against a live database in this repo; this is documented so whoever maintains the live Supabase project knows an `ALTER`/re-run is needed there. No test step is skipped by this — there simply is no live database reachable from this task.

- [ ] **Step 5: Commit**

```bash
git add store-supabase.js supabase/schema.sql
git commit -m "feat: add session table, RLS policy, and store client methods for Supabase backend"
```

---

### Task 4: Session state helpers and autosave wiring (`app.js`)

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `window.store.loadSession()`, `window.store.saveSession(session)`, `window.store.clearSession()` (Tasks 2 & 3); existing `deck`, `discard`, `currentCard`, `score`, `questionsAnswered`, `rarestAnswered`, `sessionHearts` module state; existing `getAllQuestions()`, `findQuestionByKey(qkey)`.
- Produces: `serializeSession()`, `saveCurrentSession()`, `rehydrateSession(raw)` — used by Task 5's boot/resume-UI wiring.

- [ ] **Step 1: Add the session helper functions**

In `app.js`, find `function getAllQuestions()` (around line 158) and its closing brace (the function ends at line 174 with `}`, right before `function findQuestionByKey` — actually `findQuestionByKey` is defined earlier at line 87; `getAllQuestions` is defined after it). Add the new helpers immediately after the closing brace of `getAllQuestions()`:

```js
  function getAllQuestions() {
    let extra = [];
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

  /* ── Session (resume) ── */
  function serializeSession() {
    return {
      deckKeys: deck.map(q => q.qkey),
      discardKeys: discard.map(q => q.qkey),
      currentKey: currentCard ? currentCard.qkey : null,
      score,
      questionsAnswered,
      rarestKey: rarestAnswered ? rarestAnswered.qkey : null,
      sessionHearts,
    };
  }

  function saveCurrentSession() {
    window.store.saveSession(serializeSession()).catch(() => {});
  }

  function rehydrateSession(raw) {
    const validKeys = new Set(getAllQuestions().map(q => q.qkey));
    const resolve = (keys) => keys.filter(k => validKeys.has(k)).map(findQuestionByKey);
    return {
      deck: resolve(raw.deckKeys || []),
      discard: resolve(raw.discardKeys || []),
      currentCard: raw.currentKey && validKeys.has(raw.currentKey) ? findQuestionByKey(raw.currentKey) : null,
      score: raw.score || 0,
      questionsAnswered: raw.questionsAnswered || 0,
      rarestAnswered: raw.rarestKey && validKeys.has(raw.rarestKey) ? findQuestionByKey(raw.rarestKey) : null,
      sessionHearts: raw.sessionHearts || 0,
    };
  }
```

Note: `getAllQuestions()` already filters out disabled-pack questions (the `if (!pack.enabled) continue;` line) and retired questions (the final `.filter(q => !isRetired(q.qkey))`), so building `validKeys` from its result is exactly the "would appear in a fresh deck" check the design spec requires — no separate enabled/retired check is needed here.

- [ ] **Step 2: Verify syntax**

Run: `node --check app.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Wire autosave into `drawCard`, `answerCard`, `skipCard`, and `resetGame`**

Replace `drawCard()` (currently lines 546-552):

```js
  function drawCard() {
    if (deck.length === 0) return;
    currentCard = deck.pop();
    renderCard();
    showCard();
    updateUI();
  }
```

with:

```js
  function drawCard() {
    if (deck.length === 0) return;
    currentCard = deck.pop();
    renderCard();
    showCard();
    updateUI();
    saveCurrentSession();
  }
```

Replace `answerCard()` (currently lines 576-608):

```js
  function answerCard() {
    if (!currentCard) return;

    /* score */
    if (scoreEnabled) {
      const pts = RARITY[currentCard.rarity].points;
      score += pts;
      showScorePop(pts);
    }
    questionsAnswered++;
    if (!rarestAnswered || RARITY[currentCard.rarity].points > RARITY[rarestAnswered.rarity].points) {
      rarestAnswered = currentCard;
    }

    /* move to discard */
    discard.unshift({ ...currentCard, id: Date.now() });
    currentCard = null;

    /* animate out */
    $cardStage.classList.remove('animate-in');
    $cardStage.classList.add('animate-out');

    setTimeout(() => {
      updateUI();
      renderAnsweredList();
      if (deck.length === 0) {
        showGameOver();
      } else {
        showEmptyState();
        $drawBtn.focus();
      }
    }, 300);
  }
```

with:

```js
  function answerCard() {
    if (!currentCard) return;

    /* score */
    if (scoreEnabled) {
      const pts = RARITY[currentCard.rarity].points;
      score += pts;
      showScorePop(pts);
    }
    questionsAnswered++;
    if (!rarestAnswered || RARITY[currentCard.rarity].points > RARITY[rarestAnswered.rarity].points) {
      rarestAnswered = currentCard;
    }

    /* move to discard */
    discard.unshift({ ...currentCard, id: Date.now() });
    currentCard = null;

    /* a finished deck has nothing left to resume; otherwise persist progress */
    if (deck.length === 0) {
      window.store.clearSession().catch(() => {});
    } else {
      saveCurrentSession();
    }

    /* animate out */
    $cardStage.classList.remove('animate-in');
    $cardStage.classList.add('animate-out');

    setTimeout(() => {
      updateUI();
      renderAnsweredList();
      if (deck.length === 0) {
        showGameOver();
      } else {
        showEmptyState();
        $drawBtn.focus();
      }
    }, 300);
  }
```

Replace `skipCard()` (currently lines 610-625, showing through its closing brace):

```js
  function skipCard() {
    if (!currentCard) return;
    /* Put back and reshuffle into random position */
    const idx = Math.floor(Math.random() * (deck.length + 1));
    deck.splice(idx, 0, currentCard);
    currentCard = null;

    $cardStage.classList.remove('animate-in');
    $cardStage.classList.add('animate-out');

    setTimeout(() => {
      updateUI();
      showEmptyState();
      $drawBtn.focus();
```

with (only the lines up to and including `currentCard = null;` change; the rest of the function, animate-out through the closing of the `setTimeout`, is unchanged):

```js
  function skipCard() {
    if (!currentCard) return;
    /* Put back and reshuffle into random position */
    const idx = Math.floor(Math.random() * (deck.length + 1));
    deck.splice(idx, 0, currentCard);
    currentCard = null;
    saveCurrentSession();

    $cardStage.classList.remove('animate-in');
    $cardStage.classList.add('animate-out');

    setTimeout(() => {
      updateUI();
      showEmptyState();
      $drawBtn.focus();
```

Replace `resetGame()` (currently lines 505-523):

```js
  function resetGame(customDeck) {
    /* Array.isArray guard: resetGame doubles as a click handler, which passes a MouseEvent */
    deck = shuffle(Array.isArray(customDeck) ? customDeck : getAllQuestions());
    discard = [];
    currentCard = null;
    score = 0;
    questionsAnswered = 0;
    rarestAnswered = null;
    sessionHearts = 0;
    updateUI();
    showEmptyState();
    $gameOver.classList.add('hidden');
    showAllAnswered = false;
    $answeredList.classList.remove('open', 'expanded');
    $answeredChevron.classList.remove('open');
    $answeredMobileToggle.setAttribute('aria-expanded', 'false');
    renderAnsweredList();
    $drawBtn.focus();
  }
```

with:

```js
  function resetGame(customDeck) {
    /* Array.isArray guard: resetGame doubles as a click handler, which passes a MouseEvent */
    deck = shuffle(Array.isArray(customDeck) ? customDeck : getAllQuestions());
    discard = [];
    currentCard = null;
    score = 0;
    questionsAnswered = 0;
    rarestAnswered = null;
    sessionHearts = 0;
    updateUI();
    showEmptyState();
    $gameOver.classList.add('hidden');
    showAllAnswered = false;
    $answeredList.classList.remove('open', 'expanded');
    $answeredChevron.classList.remove('open');
    $answeredMobileToggle.setAttribute('aria-expanded', 'false');
    renderAnsweredList();
    $drawBtn.focus();
    saveCurrentSession();
  }
```

- [ ] **Step 4: Verify syntax**

Run: `node --check app.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: autosave session state on draw/answer/skip/reset"
```

---

### Task 5: Resume prompt UI (`index.html`, `style.css`, `app.js`)

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`

**Interfaces:**
- Consumes: `window.store.loadSession()` / `window.store.clearSession()` (Tasks 2 & 3), `rehydrateSession(raw)` (Task 4).
- Produces: `tryResumeOrStart()` — called at boot and from `updateAuthUI()`.

- [ ] **Step 1: Add the resume-prompt markup**

In `index.html`, the empty-state block currently reads (lines 65-78):

```html
        <!-- Empty / Draw State -->
        <div class="empty-state" id="emptyState">
          <div class="deck-illustration" aria-hidden="true">
            <div class="deck-card"></div>
            <div class="deck-card"></div>
            <div class="deck-card"></div>
          </div>
          <p class="remaining-badge" id="remainingBadge">
            <strong id="remainingCount">108</strong> questions in the deck
          </p>
          <button class="btn btn-primary" id="drawBtn" autofocus>
            Draw a Card
          </button>
        </div>
```

Replace it with (wraps the badge+button pair in `#drawControls` so they can be hidden as a unit, and adds the new `#resumePrompt` block, hidden by default):

```html
        <!-- Empty / Draw State -->
        <div class="empty-state" id="emptyState">
          <div class="deck-illustration" aria-hidden="true">
            <div class="deck-card"></div>
            <div class="deck-card"></div>
            <div class="deck-card"></div>
          </div>

          <div class="draw-controls" id="drawControls">
            <p class="remaining-badge" id="remainingBadge">
              <strong id="remainingCount">108</strong> questions in the deck
            </p>
            <button class="btn btn-primary" id="drawBtn" autofocus>
              Draw a Card
            </button>
          </div>

          <div class="resume-prompt hidden" id="resumePrompt">
            <p class="resume-text" id="resumeText"></p>
            <div class="resume-actions">
              <button class="btn btn-primary" id="resumeBtn" type="button">Resume</button>
              <button class="btn btn-ghost" id="startFreshBtn" type="button">Start Fresh</button>
            </div>
          </div>
        </div>
```

- [ ] **Step 2: Add styles**

In `style.css`, find the `.remaining-badge strong { color: var(--ink); font-weight: 600; }` rule (in the `/* ── Empty State ── */` section, currently right after `.remaining-badge`). Add immediately after it:

```css
  .remaining-badge strong { color: var(--ink); font-weight: 600; }

  .draw-controls,
  .resume-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.25rem;
  }
  .draw-controls.hidden,
  .resume-prompt.hidden { display: none; }

  .resume-text {
    font-size: 0.9375rem;
    color: var(--ink-dim);
    text-align: center;
    max-width: 26ch;
  }
  .resume-text strong { color: var(--ink); font-weight: 600; }

  .resume-actions {
    display: flex;
    gap: 0.75rem;
  }
```

- [ ] **Step 3: Add DOM refs**

In `app.js`, find the `/* ── DOM ── */` block (starts around line 435). Add these lines immediately after `const $drawBtn = document.getElementById('drawBtn');`:

```js
  const $drawBtn      = document.getElementById('drawBtn');
  const $drawControls = document.getElementById('drawControls');
  const $resumePrompt = document.getElementById('resumePrompt');
  const $resumeText   = document.getElementById('resumeText');
  const $resumeBtn    = document.getElementById('resumeBtn');
  const $startFreshBtn = document.getElementById('startFreshBtn');
```

- [ ] **Step 4: Add the resume-prompt functions**

Immediately after the `rehydrateSession(raw)` function added in Task 4 (which ends with the closing `}` of its returned object and function), add:

```js
  function applyRehydratedSession(state) {
    deck = state.deck;
    discard = state.discard;
    currentCard = state.currentCard;
    score = state.score;
    questionsAnswered = state.questionsAnswered;
    rarestAnswered = state.rarestAnswered;
    sessionHearts = state.sessionHearts;
    showAllAnswered = false;
    updateUI();
    renderAnsweredList();
    if (currentCard) {
      renderCard();
      showCard();
    } else {
      showEmptyState();
    }
  }

  function hideResumePrompt() {
    $resumePrompt.classList.add('hidden');
    $drawControls.classList.remove('hidden');
  }

  function showResumePrompt(state) {
    $drawControls.classList.add('hidden');
    $resumePrompt.classList.remove('hidden');
    const remaining = state.deck.length + (state.currentCard ? 1 : 0);
    $resumeText.innerHTML =
      `You have a game in progress — <strong>${remaining}</strong> card${remaining === 1 ? '' : 's'} left, ` +
      `score <strong>${state.score}</strong>.`;
    $resumeBtn.onclick = () => {
      hideResumePrompt();
      applyRehydratedSession(state);
    };
    $startFreshBtn.onclick = async () => {
      hideResumePrompt();
      await window.store.clearSession();
      resetGame();
    };
  }

  async function tryResumeOrStart() {
    const raw = await window.store.loadSession();
    if (!raw) { resetGame(); return; }
    const state = rehydrateSession(raw);
    const hasContent = state.deck.length > 0 || state.discard.length > 0 || !!state.currentCard;
    if (!hasContent) { resetGame(); return; }
    showResumePrompt(state);
  }
```

- [ ] **Step 5: Wire `tryResumeOrStart()` into boot and `updateAuthUI`**

Replace `updateAuthUI()` (currently lines 484-493):

```js
  function updateAuthUI() {
    const email = window.store.userEmail();
    $accountRow.classList.toggle('hidden', !email);
    if (email) $accountEmail.textContent = email;
    /* re-pull user data whenever auth flips */
    Promise.all([loadPacks(), loadMarks()]).then(() => {
      renderPacks();
      resetGame();
    });
  }
```

with:

```js
  function updateAuthUI() {
    const email = window.store.userEmail();
    $accountRow.classList.toggle('hidden', !email);
    if (email) $accountEmail.textContent = email;
    /* re-pull user data whenever auth flips, then offer to resume that user's session */
    Promise.all([loadPacks(), loadMarks()]).then(() => {
      renderPacks();
      tryResumeOrStart();
    });
  }
```

Replace the boot sequence at the end of the file (currently):

```js
  /* ── Boot ── */
  loadTheme();
  (async () => {
    await loadQuestions();
    await Promise.all([loadPacks(), loadMarks()]);
    resetGame();
    toggleScore(true);
    updateDeckCount();
  })();
```

with:

```js
  /* ── Boot ── */
  loadTheme();
  (async () => {
    await loadQuestions();
    await Promise.all([loadPacks(), loadMarks()]);
    await tryResumeOrStart();
    toggleScore(true);
    updateDeckCount();
  })();
```

- [ ] **Step 6: Verify syntax**

Run: `node --check app.js`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add index.html style.css app.js
git commit -m "feat: resume-vs-start-fresh prompt on the empty-state screen"
```

---

### Task 6: End-to-end verification and regression check

**Files:** none (verification only).

**Interfaces:** none — this task exercises the full stack built in Tasks 1-5.

- [ ] **Step 1: Run the full automated test suite**

Run: `python3 -m unittest test_server -v 2>&1 | tail -55`
Expected: all tests pass (41 total from Task 1), `OK`.

- [ ] **Step 2: Syntax-check every changed JS file one more time**

Run: `node --check app.js && node --check store-server.js && node --check store-supabase.js && echo ALL_OK`
Expected: `ALL_OK`.

- [ ] **Step 3: Manual browser verification**

Start the server: `python3 server.py &`, then open `http://localhost:8080` in a browser and walk through:

1. Draw 3-4 cards, answering at least one and skipping at least one. Note the score and remaining count.
2. Reload the page. Confirm the empty-state screen now shows the resume prompt ("You have a game in progress — N cards left, score S.") with the correct N and S from step 1, instead of the normal "Draw a Card" button.
3. Click **Resume**. Confirm: the draw button reappears (or, if a card was on-screen when you reloaded, that same card reappears), the score matches, and the answered sidebar shows the cards you already answered. Draw several more cards and confirm none of them repeat a card from your discard pile.
4. Reload again mid-round, this time click **Start Fresh**. Confirm a normal fresh shuffle starts (score 0, empty answered sidebar), and that reloading once more does not show a stale resume prompt from the discarded session.
5. Play a full deck down to the game-over screen. Reload the page. Confirm you get a normal fresh shuffle with no resume prompt (a finished game has nothing to resume).
6. Open the question-pack manager, disable a pack that had a question sitting in your just-started deck, and reload. Confirm the resume prompt's count reflects that question being dropped (one fewer than before), and that drawing through the deck never surfaces it.

Stop the server: `kill %1`

- [ ] **Step 4: Update the design spec's Testing section status (optional but recommended)**

If all manual checks in Step 3 pass, no code changes are needed — this step is just confirmation that `docs/superpowers/specs/2026-07-10-resume-session-design.md`'s "Testing" section is now fully satisfied by Tasks 1-6.
