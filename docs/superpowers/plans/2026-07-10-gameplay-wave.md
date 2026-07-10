# Gameplay Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add favorites ("greatest hits"), retire-question, a warmer game-over screen, a legendary/mythic reveal, question editing, pack export/import, and an exportable Docker image — per `docs/superpowers/specs/2026-07-10-gameplay-wave-design.md`.

**Architecture:** Stable question identity (`b1`–`b108` for base questions, `p<packId>-<qid>` for pack questions) with personal marks stored server-side in a new `user_data.json` under a `DATA_DIR` env-controlled directory. Server grows a marks API and a question-edit endpoint; the frontend grows card mark buttons, pack-manager sections, session stats, and client-side export/import. Docker wraps it all with `/data` as the volume.

**Tech Stack:** Python 3 stdlib only; vanilla HTML/CSS/JS (plain script); Docker (`python:3.12-slim`, no package installs).

## Global Constraints

- Zero dependencies: Python stdlib only; no pip/pytest/Node/bundler.
- Plain script `app.js`, no ES modules.
- Tests: `python3 -m unittest test_server.py -v` (all pre-existing 18 must stay green).
- Error shape: `{"error": "..."}` JSON; limits: `MAX_BODY_BYTES = 1_000_000`, `MAX_NAME_LEN = 60`, `MAX_QUESTION_LEN = 300` (already in `server.py`).
- Mark key format: `^(b\d+|p\d+-\d+)$`. Mark lists: exactly `favorites` and `retired`.
- New UI: keyboard operable, `aria-label`s, color never sole differentiator, `prefers-reduced-motion` respected.
- Work on branch `gameplay-wave`; commit after every task; commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Server — DATA_DIR, user_data storage, marks API

**Files:**
- Modify: `server.py` (imports/constants block; `do_GET`; `do_POST`; `do_DELETE`)
- Modify: `.gitignore` (add `user_data.json`)
- Test: `test_server.py`

**Interfaces:**
- Consumes: existing `json_response(handler, data, status)`, `PACKS_LOCK`, `GameHandler`.
- Produces: module globals `DATA_DIR` (Path from env), `USER_DATA_FILE` (Path), `MARK_KEY_RE`, `MARK_LISTS = ("favorites", "retired")`; functions `load_user_data() -> dict` and `save_user_data(dict)`; routes `GET /api/marks`, `POST|DELETE /api/marks/(favorites|retired)/<qkey>` all returning the full `{"favorites": [...], "retired": [...]}` object. Tasks 2–5 rely on these exact names.

- [ ] **Step 1: Write the failing tests**

In `test_server.py`: add imports at top — `import os`, `import subprocess`, `import sys` (keep existing imports). In `setUpClass`, after the `server.DATA_FILE` line, add:

```python
        server.USER_DATA_FILE = Path(cls._tmpdir.name) / "user_data.json"
```

In `setUp`, add:

```python
        server.USER_DATA_FILE.write_text('{"favorites": [], "retired": []}')
```

Add test methods inside `PackAPITest`:

```python
    # ── Marks ──

    def test_get_marks_empty(self):
        status, marks = self.request("GET", "/api/marks")
        self.assertEqual(status, 200)
        self.assertEqual(marks, {"favorites": [], "retired": []})

    def test_add_and_remove_favorite(self):
        status, marks = self.request("POST", "/api/marks/favorites/b12")
        self.assertEqual(status, 200)
        self.assertEqual(marks["favorites"], ["b12"])
        # idempotent add
        status, marks = self.request("POST", "/api/marks/favorites/b12")
        self.assertEqual(marks["favorites"], ["b12"])
        status, marks = self.request("DELETE", "/api/marks/favorites/b12")
        self.assertEqual(status, 200)
        self.assertEqual(marks["favorites"], [])
        # idempotent remove
        status, marks = self.request("DELETE", "/api/marks/favorites/b12")
        self.assertEqual(status, 200)

    def test_retired_list_independent_of_favorites(self):
        self.request("POST", "/api/marks/favorites/b1")
        status, marks = self.request("POST", "/api/marks/retired/p3-2")
        self.assertEqual(marks, {"favorites": ["b1"], "retired": ["p3-2"]})

    def test_malformed_mark_key_400(self):
        for bad in ("x9", "b", "p3", "p3-2-1", "b1;rm"):
            status, err = self.request("POST", f"/api/marks/favorites/{bad}")
            self.assertEqual(status, 400, f"key {bad!r} should be rejected")
            self.assertIn("error", err)

    def test_unknown_mark_list_404(self):
        status, err = self.request("POST", "/api/marks/loved/b1")
        self.assertEqual(status, 404)

    def test_marks_persist_to_user_data_file(self):
        self.request("POST", "/api/marks/retired/b40")
        on_disk = json.loads(server.USER_DATA_FILE.read_text())
        self.assertEqual(on_disk["retired"], ["b40"])

    def test_data_dir_env_override(self):
        out = subprocess.check_output(
            [sys.executable, "-c",
             "import server; print(server.DATA_FILE); print(server.USER_DATA_FILE)"],
            env={**os.environ, "DATA_DIR": "/tmp/cq-data"},
            cwd=str(Path(__file__).parent),
        ).decode().strip().splitlines()
        self.assertEqual(out[0], "/tmp/cq-data/question_packs.json")
        self.assertEqual(out[1], "/tmp/cq-data/user_data.json")
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `python3 -m unittest test_server.py 2>&1 | tail -4`
Expected: FAILED — the marks tests 404 (routes missing) and `test_data_dir_env_override` errors (`USER_DATA_FILE` undefined). The 18 existing tests still pass.

- [ ] **Step 3: Implement in `server.py`**

3a. Replace the `DATA_FILE = ...` line with:

```python
DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent))
DATA_FILE = DATA_DIR / "question_packs.json"
USER_DATA_FILE = DATA_DIR / "user_data.json"
```

3b. After the `PACKS_LOCK` definition add:

```python
MARK_LISTS = ("favorites", "retired")
MARK_KEY_RE = re.compile(r"^(b\d+|p\d+-\d+)$")
```

3c. After `save_packs` add:

```python
def load_user_data():
    if USER_DATA_FILE.exists():
        try:
            data = json.loads(USER_DATA_FILE.read_text())
            return {k: list(data.get(k, [])) for k in MARK_LISTS}
        except (json.JSONDecodeError, OSError):
            pass
    return {k: [] for k in MARK_LISTS}


def save_user_data(data):
    USER_DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def handle_mark_change(handler, path, add):
    """Route helper for POST/DELETE /api/marks/<list>/<qkey>. Returns True if handled."""
    m = re.match(r"^/api/marks/([^/]+)/([^/]+)$", path)
    if not m:
        return False
    list_name, qkey = m.group(1), m.group(2)
    if list_name not in MARK_LISTS:
        json_response(handler, {"error": "Unknown mark list"}, 404)
        return True
    if not MARK_KEY_RE.match(qkey):
        json_response(handler, {"error": "Invalid question key"}, 400)
        return True
    with PACKS_LOCK:
        data = load_user_data()
        if add and qkey not in data[list_name]:
            data[list_name].append(qkey)
            save_user_data(data)
        elif not add and qkey in data[list_name]:
            data[list_name].remove(qkey)
            save_user_data(data)
    json_response(handler, data)
    return True
```

3d. In `do_GET`, before the static-files fallthrough:

```python
        # ── User marks (favorites / retired) ──
        if self.path == "/api/marks":
            json_response(self, load_user_data())
            return
```

3e. In `do_POST`, immediately before the final `json_response(self, {"error": "Not found"}, 404)`:

```python
        # ── Add a mark ──
        if handle_mark_change(self, self.path, add=True):
            return
```

3f. In `do_DELETE`, immediately before the final `json_response(self, {"error": "Not found"}, 404)`:

```python
        # ── Remove a mark ──
        if handle_mark_change(self, self.path, add=False):
            return
```

3g. Append `user_data.json` as a new line at the end of `.gitignore`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest test_server.py 2>&1 | tail -3`
Expected: `Ran 25 tests` … `OK`.

- [ ] **Step 5: Commit**

```bash
git add server.py test_server.py .gitignore
git commit -m "feat: DATA_DIR env, user_data.json storage, marks API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Server — question edit endpoint + mark cleanup on deletes

**Files:**
- Modify: `server.py` (`do_PUT`, `do_DELETE`)
- Test: `test_server.py`

**Interfaces:**
- Consumes: Task 1's `load_user_data`/`save_user_data`/`MARK_LISTS`; existing `read_json_body` (returns `None` after self-sent 413), `MAX_QUESTION_LEN`, `PACKS_LOCK`.
- Produces: `PUT /api/packs/<id>/questions/<qid>` accepting any of `{"text","rarity","category"}`, returning the updated question dict; deletes of questions/packs strip orphaned marks. Frontend Task 8 calls this endpoint.

- [ ] **Step 1: Write the failing tests**

Add inside `PackAPITest`:

```python
    # ── Question editing ──

    def test_edit_question_text_and_rarity(self):
        pack = self.make_pack()
        _, q = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "Old?"})
        status, updated = self.request(
            "PUT", f"/api/packs/{pack['id']}/questions/{q['id']}",
            {"text": "  New?  ", "rarity": "mythic"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(updated["text"], "New?")
        self.assertEqual(updated["rarity"], "mythic")
        _, packs = self.request("GET", "/api/packs")
        self.assertEqual(packs[0]["questions"][0]["text"], "New?")

    def test_edit_question_partial_category_only(self):
        pack = self.make_pack()
        _, q = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "Q?"})
        status, updated = self.request(
            "PUT", f"/api/packs/{pack['id']}/questions/{q['id']}", {"category": "Future Us"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(updated["category"], "Future Us")
        self.assertEqual(updated["text"], "Q?")

    def test_edit_question_empty_text_400(self):
        pack = self.make_pack()
        _, q = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "Q?"})
        status, err = self.request(
            "PUT", f"/api/packs/{pack['id']}/questions/{q['id']}", {"text": "   "},
        )
        self.assertEqual(status, 400)

    def test_edit_question_too_long_400(self):
        pack = self.make_pack()
        _, q = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "Q?"})
        status, err = self.request(
            "PUT", f"/api/packs/{pack['id']}/questions/{q['id']}", {"text": "x" * 301},
        )
        self.assertEqual(status, 400)

    def test_edit_unknown_question_404(self):
        pack = self.make_pack()
        status, err = self.request("PUT", f"/api/packs/{pack['id']}/questions/99", {"text": "Q?"})
        self.assertEqual(status, 404)
        status, err = self.request("PUT", "/api/packs/999/questions/1", {"text": "Q?"})
        self.assertEqual(status, 404)

    # ── Mark cleanup ──

    def test_deleting_question_removes_its_marks(self):
        pack = self.make_pack()
        _, q = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "Q?"})
        qkey = f"p{pack['id']}-{q['id']}"
        self.request("POST", f"/api/marks/favorites/{qkey}")
        self.request("POST", "/api/marks/favorites/b7")
        self.request("DELETE", f"/api/packs/{pack['id']}/questions/{q['id']}")
        _, marks = self.request("GET", "/api/marks")
        self.assertEqual(marks["favorites"], ["b7"])

    def test_deleting_pack_removes_all_its_marks(self):
        pack = self.make_pack()
        _, q1 = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "A?"})
        _, q2 = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "B?"})
        self.request("POST", f"/api/marks/favorites/p{pack['id']}-{q1['id']}")
        self.request("POST", f"/api/marks/retired/p{pack['id']}-{q2['id']}")
        self.request("POST", "/api/marks/retired/b3")
        self.request("DELETE", f"/api/packs/{pack['id']}")
        _, marks = self.request("GET", "/api/marks")
        self.assertEqual(marks, {"favorites": [], "retired": ["b3"]})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `python3 -m unittest test_server.py 2>&1 | tail -4`
Expected: FAILED — edit tests get 404 (route missing), cleanup tests find leftover marks.

- [ ] **Step 3: Implement in `server.py`**

3a. In `do_PUT`, before the final `json_response(self, {"error": "Not found"}, 404)`:

```python
        # ── Edit a question in a pack ──
        m = re.match(r"^/api/packs/(\d+)/questions/(\d+)$", self.path)
        if m:
            pack_id, qid = int(m.group(1)), int(m.group(2))
            body = read_json_body(self)
            if body is None:
                return
            text = None
            if "text" in body:
                text = body["text"].strip()
                if not text:
                    json_response(self, {"error": "Question text required"}, 400)
                    return
                if len(text) > MAX_QUESTION_LEN:
                    json_response(self, {"error": f"Question text must be {MAX_QUESTION_LEN} characters or fewer"}, 400)
                    return
            with PACKS_LOCK:
                packs = load_packs()
                for pack in packs:
                    if pack["id"] != pack_id:
                        continue
                    for q in pack.get("questions", []):
                        if q["id"] != qid:
                            continue
                        if text is not None:
                            q["text"] = text
                        if "rarity" in body:
                            q["rarity"] = body["rarity"]
                        if "category" in body:
                            q["category"] = body["category"]
                        save_packs(packs)
                        json_response(self, q)
                        return
            json_response(self, {"error": "Question not found"}, 404)
            return
```

3b. Add a module-level helper after `save_user_data`:

```python
def remove_marks(predicate):
    """Drop every mark key matching predicate from both lists. Caller holds PACKS_LOCK."""
    data = load_user_data()
    changed = False
    for lst in MARK_LISTS:
        kept = [k for k in data[lst] if not predicate(k)]
        if len(kept) != len(data[lst]):
            data[lst] = kept
            changed = True
    if changed:
        save_user_data(data)
```

3c. In `do_DELETE`, inside the delete-pack branch, extend the `with PACKS_LOCK:` block:

```python
            with PACKS_LOCK:
                packs = load_packs()
                packs = [p for p in packs if p["id"] != pack_id]
                save_packs(packs)
                prefix = f"p{pack_id}-"
                remove_marks(lambda k: k.startswith(prefix))
```

3d. In `do_DELETE`, inside the delete-question branch, after `save_packs(packs)` and before `json_response(self, {"ok": True})`:

```python
                    qkey = f"p{pack_id}-{qid}"
                    remove_marks(lambda k: k == qkey)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest test_server.py 2>&1 | tail -3`
Expected: `Ran 32 tests` … `OK`.

- [ ] **Step 5: Commit**

```bash
git add server.py test_server.py
git commit -m "feat: question edit endpoint + mark cleanup on deletes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Question identity + marks plumbing in the frontend

**Files:**
- Modify: `questions.json` (add ids `b1`–`b108`)
- Modify: `app.js` (`loadQuestions`, `getAllQuestions`, new marks state/API helpers, boot block)

**Interfaces:**
- Consumes: Task 1's marks API.
- Produces: every deck card object carries `qkey` (string); globals `marks` (`{favorites: [], retired: []}`), `sessionHearts` (int); functions `loadMarks()`, `setMark(listName, qkey, on) -> Promise<bool>`, `isFavorite(qkey)`, `isRetired(qkey)`, `findQuestionByKey(qkey) -> {text, rarity, category, qkey} | null`. Tasks 4–6 rely on these exact names.

- [ ] **Step 1: Add stable ids to questions.json**

```bash
python3 - <<'EOF'
import json
from pathlib import Path
qs = json.loads(Path("questions.json").read_text())
qs = [{"id": f"b{i}", "text": q["text"], "rarity": q["rarity"], "category": q["category"]}
      for i, q in enumerate(qs, 1)]
Path("questions.json").write_text(json.dumps(qs, indent=2, ensure_ascii=False) + "\n")
print(qs[0]["id"], qs[-1]["id"], len(qs))
EOF
```

Expected output: `b1 b108 108`.

- [ ] **Step 2: Plumb qkeys and marks through app.js**

2a. Replace the body of `loadQuestions` so base questions carry `qkey`:

```js
  async function loadQuestions() {
    try {
      const res = await fetch('questions.json');
      if (res.ok) QUESTIONS.push(...(await res.json()).map(q => ({ ...q, qkey: q.id })));
    } catch (e) { /* fetch failed — deck stays empty, packs may still load */ }
  }
```

2b. After the `let questionPacks = [];` line, add the marks layer:

```js
  /* ── User marks (favorites / retired, server-side) ── */
  let marks = { favorites: [], retired: [] };
  let sessionHearts = 0;

  async function loadMarks() {
    try {
      const res = await fetch('/api/marks');
      if (res.ok) marks = await res.json();
    } catch (e) { /* keep empty defaults */ }
  }

  function isFavorite(qkey) { return marks.favorites.includes(qkey); }
  function isRetired(qkey) { return marks.retired.includes(qkey); }

  /* Optimistic toggle: mutate locally, revert if the server rejects. */
  async function setMark(listName, qkey, on) {
    const list = marks[listName];
    const had = list.includes(qkey);
    if (on && !had) list.push(qkey);
    if (!on && had) marks[listName] = list.filter(k => k !== qkey);
    try {
      const res = await fetch(`/api/marks/${listName}/${qkey}`, { method: on ? 'POST' : 'DELETE' });
      if (res.ok) { marks = await res.json(); return true; }
    } catch (e) { /* fall through to revert */ }
    await loadMarks();
    showToast("Couldn't save that — check the server");
    return false;
  }

  function findQuestionByKey(qkey) {
    if (qkey.startsWith('b')) return QUESTIONS.find(q => q.qkey === qkey) || null;
    const m = qkey.match(/^p(\d+)-(\d+)$/);
    if (!m) return null;
    const pack = questionPacks.find(p => p.id === parseInt(m[1]));
    const q = pack && pack.questions.find(x => x.id === parseInt(m[2]));
    return q ? { text: q.text, rarity: q.rarity, category: q.category || 'Custom', qkey } : null;
  }
```

2c. Replace `getAllQuestions` so pack questions carry `qkey` and retired questions never enter the deck:

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
```

2d. In the boot block, load marks alongside packs:

```js
  (async () => {
    await loadQuestions();
    await Promise.all([loadPacks(), loadMarks()]);
    resetGame();
    toggleScore(true);
    updateDeckCount();
  })();
```

- [ ] **Step 3: Verify**

```bash
node --check app.js && echo "syntax OK"
python3 -m unittest test_server.py 2>&1 | tail -3
python3 server.py & sleep 1
curl -s http://127.0.0.1:8080/questions.json | python3 -c "import json,sys; qs=json.load(sys.stdin); assert qs[0]['id']=='b1' and qs[107]['id']=='b108'; print('ids OK')"
curl -s http://127.0.0.1:8080/api/marks
kill %1
```
Expected: `syntax OK`, tests `OK`, `ids OK`, `{"favorites": [], "retired": []}`.

- [ ] **Step 4: Commit**

```bash
git add questions.json app.js
git commit -m "feat: stable question ids + marks state in frontend

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Card UI — heart, retire with undo

**Files:**
- Modify: `index.html` (card markup)
- Modify: `app.js` (DOM refs, `renderCard`, new handlers, `showToast`)
- Modify: `style.css` (mark buttons, toast action)

**Interfaces:**
- Consumes: Task 3's `setMark`, `isFavorite`, `marks`, `sessionHearts`; existing `currentCard`, `deck`, `updateUI`, `showEmptyState`, `showToast`, `$drawBtn`.
- Produces: `showToast(msg, action)` where `action` is optional `{label: string, fn: function}` — Task 5 does not use it, but it becomes the house toast API. `sessionHearts` incremented on heart-on. `retireCurrentCard()` used only here.

- [ ] **Step 1: Card markup**

In `index.html`, replace the `card-rarity` div inside `#activeCard` with:

```html
        <div class="card-rarity">
          <span class="rarity-dot" id="rarityDot"></span>
          <span class="rarity-label" id="rarityLabel"></span>
          <span class="card-marks">
            <button class="card-mark-btn" id="favBtn" aria-pressed="false" aria-label="Save to greatest hits" title="Save to greatest hits">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21C7 16.5 3 13.2 3 8.9 3 6.2 5.2 4 7.9 4c1.6 0 3.1.8 4.1 2.1C13 4.8 14.5 4 16.1 4 18.8 4 21 6.2 21 8.9c0 4.3-4 7.6-9 12.1z"/></svg>
            </button>
            <button class="card-mark-btn" id="retireBtn" aria-label="Never show this question again" title="Never show again">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            </button>
          </span>
        </div>
```

- [ ] **Step 2: CSS**

Append to `style.css`:

```css
/* ── Card mark buttons (favorite / retire) ── */
.card-marks {
  margin-left: auto;
  display: flex;
  gap: 0.25rem;
}
.card-mark-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.375rem;
  border-radius: 0.5rem;
  color: var(--text-muted, currentColor);
  opacity: 0.55;
  line-height: 0;
}
.card-mark-btn svg { width: 1.125rem; height: 1.125rem; }
.card-mark-btn:hover, .card-mark-btn:focus-visible { opacity: 1; }
.card-mark-btn.active {
  opacity: 1;
  color: var(--primary);
}
.card-mark-btn.active svg { fill: currentColor; }

/* ── Toast action button (e.g. Undo) ── */
.toast-action {
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
  margin-left: 0.75rem;
  padding: 0;
}
```

(If `--text-muted` doesn't exist in `style.css`, the `currentColor` fallback inside `var()` covers it.)

- [ ] **Step 3: Wire up in app.js**

3a. Add DOM refs after `$cardCategory`:

```js
  const $favBtn       = document.getElementById('favBtn');
  const $retireBtn    = document.getElementById('retireBtn');
```

3b. At the end of `renderCard()` (after the animate-in lines), add:

```js
    $favBtn.classList.toggle('active', isFavorite(currentCard.qkey));
    $favBtn.setAttribute('aria-pressed', isFavorite(currentCard.qkey) ? 'true' : 'false');
```

3c. Replace `showToast` with an action-capable version:

```js
  function showToast(msg, action) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    if (action) {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => { el.remove(); action.fn(); });
      el.appendChild(btn);
    }
    document.body.appendChild(el);
    el.addEventListener('animationend', (e) => {
      if (e.animationName === 'toastOut') el.remove();
    });
  }
```

3d. Add handlers next to the other card button listeners (`$skipBtn` etc.):

```js
  $favBtn.addEventListener('click', async () => {
    if (!currentCard) return;
    const on = !isFavorite(currentCard.qkey);
    $favBtn.classList.toggle('active', on);
    $favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (await setMark('favorites', currentCard.qkey, on)) {
      if (on) { sessionHearts++; showToast('Saved to your greatest hits'); }
    } else {
      renderCard();
    }
  });

  $retireBtn.addEventListener('click', () => {
    if (currentCard) retireCurrentCard();
  });

  function retireCurrentCard() {
    const card = currentCard;
    currentCard = null;
    setMark('retired', card.qkey, true);

    $cardStage.classList.remove('animate-in');
    $cardStage.classList.add('animate-out');
    setTimeout(() => {
      updateUI();
      showEmptyState();
      $drawBtn.focus();
      showToast('Retired — it won\'t come up again', {
        label: 'Undo',
        fn: async () => {
          if (await setMark('retired', card.qkey, false)) {
            deck.splice(Math.floor(Math.random() * (deck.length + 1)), 0, card);
            updateUI();
          }
        },
      });
    }, 300);
  }
```

- [ ] **Step 4: Verify**

```bash
node --check app.js && echo "syntax OK"
python3 server.py & sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/
kill %1
```
Expected: `syntax OK`, `200`. Manual: draw a card → heart it (fills, toast), retire one (card leaves, Undo works, `user_data.json` updates, question absent from next full round).

- [ ] **Step 5: Commit**

```bash
git add index.html app.js style.css
git commit -m "feat: heart and retire controls on the card, undo toast

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Pack manager — Greatest Hits & Retired sections, favorites round

**Files:**
- Modify: `app.js` (`renderPacks`, `bindPackEvents`, `resetGame`)
- Modify: `style.css` (section styles)

**Interfaces:**
- Consumes: Task 3's `marks`, `findQuestionByKey`, `setMark`, `isRetired`; existing `renderPacks`, `closeModal`, `shuffle`, `RARITY`, `escapeHTML`.
- Produces: `resetGame(customDeck)` — optional array of card objects (guarded against being called as an event handler); `startFavoritesRound()`. Task 6 relies on `resetGame` still resetting session stats.

- [ ] **Step 1: Section rendering**

In `renderPacks()`, after the custom-packs `for` loop and before `container.innerHTML = html;`, add:

```js
    /* Greatest hits (favorites) */
    const favs = marks.favorites.map(findQuestionByKey).filter(Boolean);
    html += `
      <div class="pack-card marks-section">
        <div class="pack-header">
          <span class="marks-section-icon" aria-hidden="true">♥</span>
          <span class="pack-name">Greatest Hits</span>
          <span class="pack-count">${favs.length} ${favs.length === 1 ? 'question' : 'questions'}</span>
        </div>
        <div class="pack-body open">
          <div class="pack-questions">
            ${favs.length === 0 ? '<p class="pack-q-empty">Heart a question mid-game to save it here</p>' : ''}
            ${favs.map(q => {
              const r = RARITY[q.rarity];
              return `<div class="pack-q">
                <span class="pack-q-text" title="${escapeAttr(q.text)}">${escapeHTML(q.text)}</span>
                <span class="pack-q-rarity" style="color:${r.color}">${r.label}</span>
                <button class="pack-q-del" data-unfav="${q.qkey}" aria-label="Remove from greatest hits">&times;</button>
              </div>`;
            }).join('')}
          </div>
          ${favs.length > 0 ? '<button class="btn btn-ghost marks-play-btn" id="playFavsBtn">Play favorites round</button>' : ''}
        </div>
      </div>
    `;

    /* Retired questions */
    const retired = marks.retired.map(findQuestionByKey).filter(Boolean);
    if (retired.length > 0) {
      html += `
        <div class="pack-card marks-section">
          <div class="pack-header">
            <span class="marks-section-icon" aria-hidden="true">⊘</span>
            <span class="pack-name">Retired</span>
            <span class="pack-count">${retired.length}</span>
          </div>
          <div class="pack-body open">
            <div class="pack-questions">
              ${retired.map(q => `<div class="pack-q">
                <span class="pack-q-text" title="${escapeAttr(q.text)}">${escapeHTML(q.text)}</span>
                <button class="btn-restore" data-restore="${q.qkey}">Restore</button>
              </div>`).join('')}
            </div>
          </div>
        </div>
      `;
    }
```

Add `escapeAttr` right after `escapeHTML`:

```js
  function escapeAttr(str) {
    return escapeHTML(str).replace(/"/g, '&quot;');
  }
```

- [ ] **Step 2: Bind the new controls**

At the end of `bindPackEvents()`, add:

```js
    /* Un-favorite from greatest hits */
    document.querySelectorAll('[data-unfav]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await setMark('favorites', btn.dataset.unfav, false);
        renderPacks();
      });
    });

    /* Restore a retired question */
    document.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await setMark('retired', btn.dataset.restore, false);
        renderPacks();
      });
    });

    /* Play favorites round */
    const playFavs = document.getElementById('playFavsBtn');
    if (playFavs) playFavs.addEventListener('click', startFavoritesRound);
```

- [ ] **Step 3: Favorites round + resetGame parameter**

3a. Change the `resetGame` signature and first line:

```js
  function resetGame(customDeck) {
    deck = shuffle(Array.isArray(customDeck) ? customDeck : getAllQuestions());
```

(The `Array.isArray` guard matters: `resetGame` is used directly as a click handler, which passes a MouseEvent.)

3b. Add after `resetGame`:

```js
  function startFavoritesRound() {
    const favs = marks.favorites.map(findQuestionByKey)
      .filter(q => q && !isRetired(q.qkey));
    if (favs.length === 0) return;
    closeModal();
    resetGame(favs);
    showToast(`Favorites round — ${favs.length} greatest hit${favs.length === 1 ? '' : 's'}`);
  }
```

- [ ] **Step 4: CSS**

Append to `style.css`:

```css
/* ── Greatest Hits / Retired sections ── */
.marks-section-icon {
  font-size: 0.875rem;
  opacity: 0.7;
  width: 1.5rem;
  text-align: center;
}
.marks-play-btn {
  width: 100%;
  margin-top: 0.5rem;
}
.btn-restore {
  background: none;
  border: 1px solid currentColor;
  border-radius: 0.375rem;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  padding: 0.125rem 0.5rem;
  opacity: 0.7;
}
.btn-restore:hover, .btn-restore:focus-visible { opacity: 1; }
```

- [ ] **Step 5: Verify + commit**

```bash
node --check app.js && echo "syntax OK"
python3 -m unittest test_server.py 2>&1 | tail -3
git add app.js style.css
git commit -m "feat: greatest hits and retired sections, favorites round

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Manual: heart two questions → both listed under Greatest Hits; Play favorites round deals only them; restore a retired question returns it to future decks.

---

### Task 6: Game-over moment

**Files:**
- Modify: `index.html` (game-over block)
- Modify: `app.js` (session stats, `showGameOver`, `resetGame`, `answerCard`)

**Interfaces:**
- Consumes: `sessionHearts` (Task 3/4), existing `questionsAnswered`, `RARITY`, `escapeHTML`.
- Produces: global `rarestAnswered` (card object or null). Nothing downstream consumes it.

- [ ] **Step 1: Markup**

In `index.html`, inside `#gameOver`, give the sub-copy an id and add an extra-stats line — replace the heading/sub/finalScores block with:

```html
      <div class="game-over-icon">🕯️</div>
      <h2 class="game-over-heading">Deck's empty</h2>
      <p class="game-over-sub" id="gameOverSub">
        You made it through every question.<br>Here's to many more conversations.
      </p>
      <div class="final-scores" id="finalScores"></div>
      <p class="game-over-sub" id="gameOverExtra"></p>
      <button class="btn btn-primary" id="resetBtn">One more round</button>
```

- [ ] **Step 2: Track and show session stats**

2a. In `app.js`, after `let questionsAnswered = 0;` add:

```js
  let rarestAnswered = null;
```

2b. In `answerCard()`, right after `questionsAnswered++;` add:

```js
    if (!rarestAnswered || RARITY[currentCard.rarity].points > RARITY[rarestAnswered.rarity].points) {
      rarestAnswered = currentCard;
    }
```

2c. In `resetGame()`, after `questionsAnswered = 0;` add:

```js
    rarestAnswered = null;
    sessionHearts = 0;
```

2d. In `showGameOver()`, at the end of the function add:

```js
    document.getElementById('gameOverSub').innerHTML =
      `You made it through <strong>${questionsAnswered}</strong> question${questionsAnswered === 1 ? '' : 's'} together.<br>Here's to many more conversations.`;

    let extra = '';
    if (rarestAnswered) {
      const r = RARITY[rarestAnswered.rarity];
      extra += `Rarest catch: “${escapeHTML(rarestAnswered.text)}” <span style="color:${r.color}">(${r.label})</span>`;
    }
    if (sessionHearts > 0) {
      extra += `${extra ? '<br>' : ''}You saved ${sessionHearts} to your greatest hits.`;
    }
    document.getElementById('gameOverExtra').innerHTML = extra;
```

- [ ] **Step 3: Verify + commit**

```bash
node --check app.js && echo "syntax OK"
git add index.html app.js
git commit -m "feat: warmer game-over moment with session stats

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Manual: play a tiny favorites round to the end — the game-over screen shows the count, rarest catch with rarity color, hearts line, and a "One more round" button.

---

### Task 7: Legendary/mythic reveal

**Files:**
- Modify: `style.css` only.

**Interfaces:**
- Consumes: existing `.card[data-rarity]` attribute (set in `renderCard`), `.card-stage.animate-in` class, `--legendary`/`--mythic` CSS vars.
- Produces: nothing downstream.

- [ ] **Step 1: CSS**

Append to `style.css`:

```css
/* ── Legendary / Mythic reveal ── */
/* Static glow: always present so rarity reads even with reduced motion */
.card[data-rarity="legendary"] { box-shadow: 0 0 0 1px var(--legendary), 0 0 18px -2px var(--legendary); }
.card[data-rarity="mythic"]    { box-shadow: 0 0 0 1px var(--mythic),    0 0 18px -2px var(--mythic); }

@media (prefers-reduced-motion: no-preference) {
  .card-stage.animate-in .card[data-rarity="legendary"] {
    animation: rarityReveal 0.9s ease-out;
    --reveal-color: var(--legendary);
  }
  .card-stage.animate-in .card[data-rarity="mythic"] {
    animation: rarityReveal 0.9s ease-out;
    --reveal-color: var(--mythic);
  }
  @keyframes rarityReveal {
    0%   { box-shadow: 0 0 0 1px var(--reveal-color), 0 0 42px 6px var(--reveal-color); transform: scale(1.03); }
    100% { box-shadow: 0 0 0 1px var(--reveal-color), 0 0 18px -2px var(--reveal-color); transform: scale(1); }
  }
}
```

- [ ] **Step 2: Verify + commit**

Manual: draw until a legendary/mythic appears (or temporarily heart one and play a favorites round) — glow settles in under a second; with macOS "Reduce Motion" on, only the static glow shows. Common/rare cards look unchanged.

```bash
git add style.css
git commit -m "feat: legendary and mythic reveal glow

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Question editing UI

**Files:**
- Modify: `app.js` (`renderPacks` question rows, `bindPackEvents`, new `updateQuestion` API helper)
- Modify: `style.css` (edit form styles)

**Interfaces:**
- Consumes: Task 2's `PUT /api/packs/<id>/questions/<qid>`; `escapeAttr` (Task 5); existing `RARITY`, `renderPacks`.
- Produces: `updateQuestion(packId, qid, fields) -> Promise<object|null>`; module state `editingQ` (string `"packId-qid"` or null).

- [ ] **Step 1: API helper**

In `app.js`, after `deleteQuestionFromPack`, add:

```js
  async function updateQuestion(packId, qid, fields) {
    const res = await fetch(`${API_BASE}/${packId}/questions/${qid}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(fields),
    });
    if (res.ok) {
      const updated = await res.json();
      const pack = questionPacks.find(p => p.id === packId);
      if (pack) {
        const idx = pack.questions.findIndex(q => q.id === qid);
        if (idx !== -1) pack.questions[idx] = updated;
      }
      return updated;
    }
    return null;
  }
```

- [ ] **Step 2: Row rendering with edit mode**

2a. After `let openPackId = null;` add:

```js
  let editingQ = null;   /* "packId-qid" while a question row is in edit mode */
```

2b. In `renderPacks()`, replace the question-row template (the `pack.questions.map(q => { ... })` callback) with:

```js
              ${pack.questions.map(q => {
                const r = RARITY[q.rarity];
                if (editingQ === `${pack.id}-${q.id}`) {
                  return `<form class="pack-q pack-q-edit" data-edit-form="${pack.id}-${q.id}" autocomplete="off">
                    <input class="pack-add-input" type="text" maxlength="300" value="${escapeAttr(q.text)}" required>
                    <div class="pack-add-meta">
                      <select>${Object.entries(RARITY).map(([k, v]) =>
                        `<option value="${k}" ${k === q.rarity ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
                      <select>${['General', 'Future Us', 'Custom'].map(c =>
                        `<option ${c === (q.category || 'Custom') ? 'selected' : ''}>${c}</option>`).join('')}</select>
                    </div>
                    <div class="pack-q-edit-actions">
                      <button class="pack-add-btn" type="submit">Save</button>
                      <button class="btn-restore" type="button" data-cancel-edit>Cancel</button>
                    </div>
                  </form>`;
                }
                return `<div class="pack-q">
                  <span class="pack-q-text" title="${escapeAttr(q.text)}">${escapeHTML(q.text)}</span>
                  <span class="pack-q-rarity" style="color:${r.color}">${r.label}</span>
                  <button class="pack-q-edit-btn" data-edit="${pack.id}-${q.id}" aria-label="Edit question">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  </button>
                  <button class="pack-q-del" data-pack="${pack.id}" data-qid="${q.id}" aria-label="Delete question">&times;</button>
                </div>`;
              }).join('')}
```

- [ ] **Step 3: Bind edit events**

At the end of `bindPackEvents()`, add:

```js
    /* Enter edit mode */
    document.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        editingQ = btn.dataset.edit;
        renderPacks();
        const form = document.querySelector('[data-edit-form]');
        if (form) form.querySelector('input').focus();
      });
    });

    /* Cancel edit */
    document.querySelectorAll('[data-cancel-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingQ = null;
        renderPacks();
      });
    });

    /* Save edit */
    document.querySelectorAll('[data-edit-form]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const [packId, qid] = form.dataset.editForm.split('-').map(Number);
        const text = form.querySelector('input').value.trim();
        if (!text) return;
        const selects = form.querySelectorAll('select');
        const updated = await updateQuestion(packId, qid, {
          text, rarity: selects[0].value, category: selects[1].value,
        });
        if (!updated) { showToast("Couldn't save the edit"); return; }
        editingQ = null;
        renderPacks();
      });
    });
```

- [ ] **Step 4: CSS**

Append to `style.css`:

```css
/* ── Question edit ── */
.pack-q-edit { flex-direction: column; align-items: stretch; gap: 0.375rem; }
.pack-q-edit-actions { display: flex; gap: 0.5rem; }
.pack-q-edit-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  color: inherit;
  opacity: 0.5;
  line-height: 0;
}
.pack-q-edit-btn svg { width: 0.875rem; height: 0.875rem; }
.pack-q-edit-btn:hover, .pack-q-edit-btn:focus-visible { opacity: 1; }
```

- [ ] **Step 5: Verify + commit**

```bash
node --check app.js && echo "syntax OK"
python3 -m unittest test_server.py 2>&1 | tail -3
git add app.js style.css
git commit -m "feat: inline question editing in the pack manager

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Manual: edit a pack question's text and rarity → row updates, survives reload; a favorited question keeps its heart after editing (id-keyed).

---

### Task 9: Pack export / import

**Files:**
- Modify: `index.html` (modal footer buttons)
- Modify: `app.js` (export/import functions + listeners)

**Interfaces:**
- Consumes: existing `createPack`, `addQuestionToPack`, `questionPacks`, `RARITY`, `showToast`, `renderPacks`.
- Produces: `exportPacks()`, `importPacks(file)`. File format: array of `{name, questions: [{text, rarity, category}]}`.

- [ ] **Step 1: Markup**

In `index.html`, after the closing `</form>` of `#newPackForm`, add:

```html
      <!-- Export / import -->
      <div style="display:flex;gap:0.5rem;margin-top:0.75rem">
        <button class="btn btn-ghost" id="exportPacksBtn" style="flex:1">Export packs</button>
        <button class="btn btn-ghost" id="importPacksBtn" style="flex:1">Import packs</button>
        <input type="file" id="importPacksFile" accept=".json,application/json" hidden>
      </div>
```

- [ ] **Step 2: app.js functions + listeners**

Add after the `$newPackForm` submit listener:

```js
  /* ── Pack export / import ── */
  function exportPacks() {
    const data = questionPacks.map(p => ({
      name: p.name,
      questions: p.questions.map(q => ({
        text: q.text, rarity: q.rarity, category: q.category || 'Custom',
      })),
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'couple-questions-packs.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importPacks(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) {
      showToast('Import failed: not valid JSON'); return;
    }
    const ok = Array.isArray(data) && data.every(p =>
      typeof p.name === 'string' && Array.isArray(p.questions) &&
      p.questions.every(q => q && typeof q.text === 'string'));
    if (!ok) { showToast('Import failed: unrecognized file format'); return; }

    for (const p of data) {
      const pack = await createPack(p.name);
      if (!pack) { showToast(`Import stopped: couldn't create "${p.name}"`); renderPacks(); return; }
      for (const q of p.questions) {
        const added = await addQuestionToPack(
          pack.id, q.text, RARITY[q.rarity] ? q.rarity : 'common', q.category || 'Custom');
        if (!added) { showToast('Import stopped: a question was rejected'); renderPacks(); return; }
      }
    }
    renderPacks();
    showToast(`Imported ${data.length} pack${data.length === 1 ? '' : 's'}`);
  }

  document.getElementById('exportPacksBtn').addEventListener('click', exportPacks);
  document.getElementById('importPacksBtn').addEventListener('click', () => {
    document.getElementById('importPacksFile').click();
  });
  document.getElementById('importPacksFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importPacks(e.target.files[0]);
    e.target.value = '';
  });
```

- [ ] **Step 3: Verify + commit**

```bash
node --check app.js && echo "syntax OK"
git add index.html app.js
git commit -m "feat: pack export and import as JSON

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Manual: export → file downloads; delete a pack; import the file → pack returns with fresh ids; importing a garbage file shows an error toast and creates nothing.

---

### Task 10: Exportable Docker + README

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `README.md`

**Interfaces:**
- Consumes: Task 1's `DATA_DIR` env support in `server.py`.
- Produces: image `couple-questions` exposing 8080 with `/data` volume.

- [ ] **Step 1: Dockerfile**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY server.py index.html style.css app.js questions.json ./
ENV DATA_DIR=/data
RUN mkdir -p /data
VOLUME /data
EXPOSE 8080
CMD ["python3", "server.py"]
```

- [ ] **Step 2: .dockerignore**

```
.git
.claude
.impeccable
docs
test_server.py
question_packs.json
user_data.json
__pycache__
*.pyc
.DS_Store
README.md
PRODUCT.md
Dockerfile
.dockerignore
.gitignore
```

- [ ] **Step 3: README.md**

```markdown
# Couple Questions

A zero-dependency party card game: draw question cards of increasing rarity
and talk. Static frontend + Python stdlib server; user-created question
packs and favorites persist as JSON.

## Run locally

    python3 server.py
    # open http://localhost:8080

Data files (`question_packs.json`, `user_data.json`) are written next to
`server.py`, or to `$DATA_DIR` if set.

## Tests

    python3 -m unittest test_server.py

## Docker

Build and run (packs/favorites persist in a named volume):

    docker build -t couple-questions .
    docker run -d --name couple-questions -p 8080:8080 \
      -v couple-questions-data:/data couple-questions

Export the image to carry it to another machine:

    docker save couple-questions | gzip > couple-questions.tar.gz
    # on the target machine:
    docker load < couple-questions.tar.gz
```

- [ ] **Step 4: Verify**

```bash
docker build -t couple-questions . && docker run -d --rm --name cq-test -p 8090:8080 couple-questions
sleep 2
curl -s -o /dev/null -w "index %{http_code}\n" http://127.0.0.1:8090/
curl -s -X POST http://127.0.0.1:8090/api/marks/favorites/b1
docker stop cq-test
```
Expected: `index 200` and `{"favorites": ["b1"], "retired": []}`. If the Docker daemon isn't available, note it and leave verification for the user.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore README.md
git commit -m "feat: exportable Docker image with /data volume, README

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- `python3 -m unittest test_server.py -v` → 32 tests, `OK`; `node --check app.js`.
- Manual checklist in the browser (hard-refresh once): heart + toast; retire + undo; retired excluded from new rounds; Greatest Hits/Retired sections; favorites round; game-over stats; legendary/mythic glow (and reduced-motion static variant); edit question; export/import round-trip.
- Docker: build, run with volume, `docker save`/`load` round-trip.
- Merge `gameplay-wave` → `main` after tests pass on the merged result.
