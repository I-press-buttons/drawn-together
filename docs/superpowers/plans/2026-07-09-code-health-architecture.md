# Code Health & Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Couple Questions game — split the monolithic `index.html`, consolidate question data into `questions.json`, harden `server.py`, and add stdlib tests — with zero behavior/UX changes.

**Architecture:** A static frontend (`index.html` + `style.css` + `app.js` + `questions.json`) served by a dependency-free Python stdlib server (`server.py`) that also exposes a JSON CRUD API for question packs persisted to `question_packs.json`. Tests spin up the real server on an ephemeral port with a temp data file.

**Tech Stack:** Python 3 stdlib only (`http.server`, `json`, `threading`, `unittest`, `urllib`, `http.client`), vanilla HTML/CSS/JS (plain script, no ES modules).

## Global Constraints

- **Zero dependencies:** Python stdlib only; no pip installs, no pytest, no Node, no bundler.
- **No behavior/UX/visual changes:** the game must look and play exactly as before.
- **Plain script:** `app.js` is a classic script (no `type="module"`).
- **Tests run via:** `python3 -m unittest test_server.py -v`
- **Working directory:** repo root `the repo root` (git repo already initialized; one commit with the design spec exists — do NOT run `git init`).
- **Commit messages** end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## Spec deviation note

The spec says "git init" — that already happened (spec commit `67c04c8`). The source files are still untracked, so Task 1 commits the pre-refactor baseline instead, which makes every later diff reviewable.

Also: `do_DELETE` in `server.py` has a real bug — the `Pack not found` 404 for `/api/packs/N/questions/M` is missing a `return`, so the handler writes a *second* 404 response into the same socket. Task 3 fixes it (it's a hardening-class defect, invisible to clients only because the extra bytes fall outside the first response's `Content-Length`).

---

### Task 1: Baseline commit & data cleanup

**Files:**
- Modify: `question_packs.json` (reset to `[]`)
- Modify: `.gitignore` (add `.claude/settings.local.json`)
- Commit (untracked → tracked): `index.html`, `server.py`, `question_packs.json`, `Couple_Question_Game.txt`, `PRODUCT.md`, `.gitignore`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a committed baseline of the current app; later tasks produce reviewable diffs against it. `question_packs.json` contains `[]`.

- [ ] **Step 1: Reset the pack data file**

Overwrite `question_packs.json` with exactly:

```json
[]
```

(This removes the junk `"Whatdoyodddddddd"` test pack.)

- [ ] **Step 2: Ignore machine-local Claude settings**

Append to `.gitignore` so it reads:

```gitignore
.impeccable/
__pycache__/
*.pyc
.DS_Store
.claude/settings.local.json
```

- [ ] **Step 3: Verify the app still boots with empty pack data**

Run:
```bash
cd the repo root
python3 server.py &
sleep 1
curl -s http://127.0.0.1:8080/api/packs
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/
kill %1
```
Expected: `[]` then `200`.

- [ ] **Step 4: Commit the baseline**

```bash
git add .gitignore index.html server.py question_packs.json Couple_Question_Game.txt PRODUCT.md
git status --short   # confirm nothing unexpected is staged; .claude/ and .impeccable/ must NOT appear
git commit -m "chore: commit pre-refactor baseline, reset pack data

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Characterization tests for the pack CRUD API

**Files:**
- Create: `test_server.py`
- Test: `test_server.py` (run with `python3 -m unittest test_server.py -v`)

**Interfaces:**
- Consumes: `server.py` module globals `DATA_FILE` (a `pathlib.Path`) and class `GameHandler`; API routes `/api/packs`, `/api/packs/<id>`, `/api/packs/<id>/questions`, `/api/packs/<id>/questions/<qid>`.
- Produces: `test_server.py` with class `PackAPITest` and helper method `self.request(method, path, body=None) -> (status:int, data:dict|list)`. Task 3 appends more test methods to this same class and reuses `self.request` and `self.raw_request` exactly as defined here.

- [ ] **Step 1: Write the characterization tests**

These document CURRENT behavior — they must pass against the unmodified server. Create `test_server.py`:

```python
"""Tests for the pack CRUD API in server.py — stdlib only."""

import http.client
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import server


class PackAPITest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.TemporaryDirectory()
        # Point the server module at a throwaway data file.
        server.DATA_FILE = Path(cls._tmpdir.name) / "question_packs.json"
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.GameHandler)
        cls.port = cls.httpd.server_address[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls._thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls._thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls._tmpdir.cleanup()

    def setUp(self):
        server.DATA_FILE.write_text("[]")

    def request(self, method, path, body=None):
        """Return (status, parsed_json) for a request to the test server."""
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            self.base + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def raw_request(self, method, path, headers):
        """Send a request with hand-rolled headers and NO body; return (status, parsed_json)."""
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.putrequest(method, path)
            for key, value in headers.items():
                conn.putheader(key, value)
            conn.endheaders()
            res = conn.getresponse()
            return res.status, json.loads(res.read())
        finally:
            conn.close()

    def make_pack(self, name="Date Night"):
        status, pack = self.request("POST", "/api/packs", {"name": name})
        self.assertEqual(status, 201)
        return pack

    # ── Pack CRUD ──

    def test_list_packs_empty(self):
        status, packs = self.request("GET", "/api/packs")
        self.assertEqual(status, 200)
        self.assertEqual(packs, [])

    def test_create_pack(self):
        status, pack = self.request("POST", "/api/packs", {"name": "Date Night"})
        self.assertEqual(status, 201)
        self.assertEqual(pack["name"], "Date Night")
        self.assertEqual(pack["id"], 1)
        self.assertTrue(pack["enabled"])
        self.assertEqual(pack["questions"], [])
        status, packs = self.request("GET", "/api/packs")
        self.assertEqual(len(packs), 1)

    def test_create_pack_missing_name(self):
        status, err = self.request("POST", "/api/packs", {"name": "   "})
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_toggle_pack_enabled(self):
        pack = self.make_pack()
        status, updated = self.request("PUT", f"/api/packs/{pack['id']}", {"enabled": False})
        self.assertEqual(status, 200)
        self.assertFalse(updated["enabled"])

    def test_rename_pack(self):
        pack = self.make_pack()
        status, updated = self.request("PUT", f"/api/packs/{pack['id']}", {"name": "  New Name  "})
        self.assertEqual(status, 200)
        self.assertEqual(updated["name"], "New Name")

    def test_update_unknown_pack_404(self):
        status, err = self.request("PUT", "/api/packs/999", {"enabled": False})
        self.assertEqual(status, 404)

    def test_delete_pack(self):
        pack = self.make_pack()
        status, body = self.request("DELETE", f"/api/packs/{pack['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})
        status, packs = self.request("GET", "/api/packs")
        self.assertEqual(packs, [])

    # ── Question CRUD ──

    def test_add_question(self):
        pack = self.make_pack()
        status, q = self.request(
            "POST", f"/api/packs/{pack['id']}/questions",
            {"text": "What made you smile today?", "rarity": "rare", "category": "Custom"},
        )
        self.assertEqual(status, 201)
        self.assertEqual(q["id"], 1)
        self.assertEqual(q["text"], "What made you smile today?")
        self.assertEqual(q["rarity"], "rare")
        status, packs = self.request("GET", "/api/packs")
        self.assertEqual(len(packs[0]["questions"]), 1)

    def test_add_question_missing_text(self):
        pack = self.make_pack()
        status, err = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "  "})
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_add_question_unknown_pack_404(self):
        status, err = self.request("POST", "/api/packs/999/questions", {"text": "Hello?"})
        self.assertEqual(status, 404)

    def test_delete_question(self):
        pack = self.make_pack()
        _, q = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "Q?"})
        status, body = self.request("DELETE", f"/api/packs/{pack['id']}/questions/{q['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})
        status, packs = self.request("GET", "/api/packs")
        self.assertEqual(packs[0]["questions"], [])

    def test_delete_question_unknown_pack_404(self):
        status, err = self.request("DELETE", "/api/packs/999/questions/1")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests — they must pass against the current server**

Run: `python3 -m unittest test_server.py -v`
Expected: all 12 tests PASS (`OK`). These are characterization tests of existing behavior, so a failure means the test is wrong, not the server — fix the test.

- [ ] **Step 3: Commit**

```bash
git add test_server.py
git commit -m "test: add characterization tests for pack CRUD API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Backend hardening (lock, body cap, length limits, missing return)

**Files:**
- Modify: `server.py`
- Test: `test_server.py` (append methods to `PackAPITest`)

**Interfaces:**
- Consumes: `PackAPITest` with helpers `self.request` and `self.raw_request` from Task 2.
- Produces: `server.py` module constants `MAX_BODY_BYTES = 1_000_000`, `MAX_NAME_LEN = 60`, `MAX_QUESTION_LEN = 300`, module lock `PACKS_LOCK`; `read_json_body(handler)` now returns `None` after sending a 413 itself when the body is oversized (callers must check `if body is None: return`). No task after this consumes these — this is the final server change.

- [ ] **Step 1: Write the failing hardening tests**

Append inside the `PackAPITest` class in `test_server.py`:

```python
    # ── Hardening ──

    def test_oversized_body_rejected_413(self):
        # Claim a huge body via Content-Length without sending it; the
        # server must reject from the header alone, before reading.
        status, err = self.raw_request(
            "POST", "/api/packs",
            {"Content-Type": "application/json", "Content-Length": str(2_000_000)},
        )
        self.assertEqual(status, 413)
        self.assertIn("error", err)

    def test_pack_name_too_long_400(self):
        status, err = self.request("POST", "/api/packs", {"name": "x" * 61})
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_rename_too_long_400(self):
        pack = self.make_pack()
        status, err = self.request("PUT", f"/api/packs/{pack['id']}", {"name": "x" * 61})
        self.assertEqual(status, 400)
        _, packs = self.request("GET", "/api/packs")
        self.assertEqual(packs[0]["name"], "Date Night")  # unchanged

    def test_question_text_too_long_400(self):
        pack = self.make_pack()
        status, err = self.request(
            "POST", f"/api/packs/{pack['id']}/questions", {"text": "x" * 301}
        )
        self.assertEqual(status, 400)

    def test_concurrent_pack_creates_do_not_lose_writes(self):
        errors = []

        def create(i):
            try:
                status, _ = self.request("POST", "/api/packs", {"name": f"Pack {i}"})
                if status != 201:
                    errors.append(status)
            except Exception as e:  # noqa: BLE001 — collect for assertion
                errors.append(e)

        threads = [threading.Thread(target=create, args=(i,)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [])
        status, packs = self.request("GET", "/api/packs")
        self.assertEqual(len(packs), 10)
        ids = [p["id"] for p in packs]
        self.assertEqual(len(set(ids)), 10, f"duplicate ids: {ids}")
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `python3 -m unittest test_server.py -v`
Expected: the 12 Task-2 tests still PASS; `test_oversized_body_rejected_413`, `test_pack_name_too_long_400`, `test_rename_too_long_400`, `test_question_text_too_long_400` FAIL (server currently accepts these). `test_concurrent_pack_creates_do_not_lose_writes` may pass or fail intermittently (it's a race) — that's expected pre-fix.

- [ ] **Step 3: Implement the hardening in `server.py`**

3a. Add imports/constants. Change the import block and add constants after `DATA_FILE`:

```python
import http.server
import json
import os
import re
import threading
from pathlib import Path

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", 8080))
DATA_FILE = Path(__file__).parent / "question_packs.json"

MAX_BODY_BYTES = 1_000_000   # reject request bodies larger than ~1 MB
MAX_NAME_LEN = 60            # matches maxlength on #newPackName in index.html
MAX_QUESTION_LEN = 300       # matches maxlength on the pack-add-input in index.html

# Serializes every load_packs() -> mutate -> save_packs() sequence so two
# clients editing packs at once can't overwrite each other's writes.
PACKS_LOCK = threading.Lock()
```

(Note: the existing `import hashlib` is unused — delete it while here. `import re` stays.)

3b. Replace `read_json_body` with a self-rejecting version:

```python
def read_json_body(handler):
    """Read and parse the JSON request body.

    Sends a 413 and returns None if Content-Length exceeds MAX_BODY_BYTES,
    so callers must bail out with `if body is None: return`.
    """
    length = int(handler.headers.get("Content-Length", 0))
    if length > MAX_BODY_BYTES:
        json_response(handler, {"error": "Request body too large"}, 413)
        return None
    if length == 0:
        return {}
    return json.loads(handler.rfile.read(length))
```

3c. Rewrite `do_POST` — body-check, length validation, and lock:

```python
    def do_POST(self):
        # ── Create a new pack ──
        if self.path == "/api/packs":
            body = read_json_body(self)
            if body is None:
                return
            name = body.get("name", "").strip()
            if not name:
                json_response(self, {"error": "Pack name required"}, 400)
                return
            if len(name) > MAX_NAME_LEN:
                json_response(self, {"error": f"Pack name must be {MAX_NAME_LEN} characters or fewer"}, 400)
                return
            with PACKS_LOCK:
                packs = load_packs()
                new_pack = {
                    "id": _next_id(packs),
                    "name": name,
                    "enabled": True,
                    "questions": [],
                }
                packs.append(new_pack)
                save_packs(packs)
            json_response(self, new_pack, 201)
            return

        # ── Add question to a pack ──
        m = re.match(r"^/api/packs/(\d+)/questions$", self.path)
        if m:
            pack_id = int(m.group(1))
            body = read_json_body(self)
            if body is None:
                return
            text = body.get("text", "").strip()
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
                    q = {
                        "id": _next_id(pack.get("questions", [])),
                        "text": text,
                        "rarity": body.get("rarity", "common"),
                        "category": body.get("category", "Custom"),
                    }
                    pack.setdefault("questions", []).append(q)
                    save_packs(packs)
                    json_response(self, q, 201)
                    return
            json_response(self, {"error": "Pack not found"}, 404)
            return

        json_response(self, {"error": "Not found"}, 404)
```

3d. Rewrite `do_PUT` — body-check, rename length validation, lock:

```python
    def do_PUT(self):
        # ── Update a pack (toggle enabled, rename) ──
        m = re.match(r"^/api/packs/(\d+)$", self.path)
        if m:
            pack_id = int(m.group(1))
            body = read_json_body(self)
            if body is None:
                return
            if "name" in body and len(body["name"].strip()) > MAX_NAME_LEN:
                json_response(self, {"error": f"Pack name must be {MAX_NAME_LEN} characters or fewer"}, 400)
                return
            with PACKS_LOCK:
                packs = load_packs()
                for pack in packs:
                    if pack["id"] != pack_id:
                        continue
                    if "enabled" in body:
                        pack["enabled"] = bool(body["enabled"])
                    if "name" in body:
                        pack["name"] = body["name"].strip()
                    save_packs(packs)
                    json_response(self, pack)
                    return
            json_response(self, {"error": "Pack not found"}, 404)
            return

        json_response(self, {"error": "Not found"}, 404)
```

3e. Rewrite `do_DELETE` — lock, and fix the missing `return` after the question-delete 404 (currently the handler falls through and writes a second 404 response into the same socket):

```python
    def do_DELETE(self):
        # ── Delete entire pack ──
        m = re.match(r"^/api/packs/(\d+)$", self.path)
        if m:
            pack_id = int(m.group(1))
            with PACKS_LOCK:
                packs = load_packs()
                packs = [p for p in packs if p["id"] != pack_id]
                save_packs(packs)
            json_response(self, {"ok": True})
            return

        # ── Delete a question from a pack ──
        m = re.match(r"^/api/packs/(\d+)/questions/(\d+)$", self.path)
        if m:
            pack_id, qid = int(m.group(1)), int(m.group(2))
            with PACKS_LOCK:
                packs = load_packs()
                for pack in packs:
                    if pack["id"] != pack_id:
                        continue
                    pack["questions"] = [q for q in pack["questions"] if q["id"] != qid]
                    save_packs(packs)
                    json_response(self, {"ok": True})
                    return
            json_response(self, {"error": "Pack not found"}, 404)
            return

        json_response(self, {"error": "Not found"}, 404)
```

(Note the two behavior-preserving quirks kept on purpose: deleting an unknown pack still returns `{"ok": true}` — idempotent delete — and `read_json_body` for add-question now runs *before* the pack-exists check, which changes nothing observable since a missing pack still 404s.)

- [ ] **Step 4: Run all tests to verify they pass**

Run: `python3 -m unittest test_server.py -v`
Expected: all 17 tests PASS (`OK`). Run the concurrency test a few extra times to shake out flakiness: `for i in 1 2 3; do python3 -m unittest test_server.PackAPITest.test_concurrent_pack_creates_do_not_lose_writes; done` — all `OK`.

- [ ] **Step 5: Commit**

```bash
git add server.py test_server.py
git commit -m "feat: harden server — write lock, 1MB body cap, length limits, fix double 404

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Split index.html into style.css and app.js

**Files:**
- Create: `style.css`, `app.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: committed baseline `index.html` (exactly one `<style>` block at lines ~7–1042 and one `<script>` block at lines ~1179–1964).
- Produces: `app.js` containing the entire game script unchanged (Task 5 edits `parseQuestions`, the `QUESTIONS` const, and the boot block inside it); `index.html` referencing `style.css` and `app.js`.

- [ ] **Step 1: Split mechanically with a script**

Don't hand-copy 2000 lines. Run this from the repo root:

```bash
python3 - <<'EOF'
import re
from pathlib import Path

src = Path("index.html").read_text()

style = re.findall(r"<style>\n(.*?)</style>\n", src, re.DOTALL)
script = re.findall(r"<script>\n(.*?)</script>\n", src, re.DOTALL)
assert len(style) == 1, f"expected exactly 1 style block, found {len(style)}"
assert len(script) == 1, f"expected exactly 1 script block, found {len(script)}"

Path("style.css").write_text(style[0])
Path("app.js").write_text(script[0])

html = re.sub(r"<style>\n.*?</style>\n", '<link rel="stylesheet" href="style.css">\n', src, flags=re.DOTALL)
html = re.sub(r"<script>\n.*?</script>\n", '<script src="app.js" defer></script>\n', html, flags=re.DOTALL)
Path("index.html").write_text(html)
print("split ok")
EOF
```

Expected output: `split ok`.

- [ ] **Step 2: Verify nothing was lost**

```bash
grep -c "" index.html style.css app.js          # index.html should be ~130 lines; css ~1035; js ~785
grep -n "<style>\|<script>" index.html          # only: <script src="app.js" defer></script>
grep -n "parseQuestions\|RARITY" index.html     # no output — script fully moved out
head -1 style.css                               # the box-sizing reset rule
head -2 app.js                                  # "/* ── Question Data ── */" then "const QUESTIONS = [];"
```

- [ ] **Step 3: Verify the split app is served and works**

```bash
python3 server.py &
sleep 1
for p in / /style.css /app.js; do curl -s -o /dev/null -w "$p %{http_code}\n" http://127.0.0.1:8080$p; done
kill %1
```
Expected: `200` for all three. Then open `http://127.0.0.1:8080/` in a browser (or note for the human to): the game should render styled and deal cards exactly as before, with no console errors.

- [ ] **Step 4: Run the server tests (must still pass)**

Run: `python3 -m unittest test_server.py -v`
Expected: all 17 PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html style.css app.js
git commit -m "refactor: split index.html into style.css and app.js

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Consolidate question data into questions.json

**Files:**
- Create: `questions.json`
- Modify: `app.js`
- Delete: `Couple_Question_Game.txt`

**Interfaces:**
- Consumes: `app.js` from Task 4 — specifically `const QUESTIONS = [];`, the `parseQuestions()` function (from the `/* ── Parse game data ── */` comment to just before `/* ── Game State ── */`), and the boot block at the bottom (`parseQuestions(); loadTheme(); (async () => { await loadPacks(); ... })();`).
- Produces: `questions.json` — a JSON array of `{"text": str, "rarity": str, "category": str}`; `app.js` function `loadQuestions()` that populates the existing `QUESTIONS` array from it at boot. Nothing after this task consumes these.

- [ ] **Step 1: Generate questions.json from the template string in app.js**

This ports `parseQuestions()`'s exact logic to Python so the JSON is provably identical to what the JS produced. Run from the repo root:

```bash
python3 - <<'EOF'
import json
import re
from pathlib import Path

src = Path("app.js").read_text()
m = re.search(r"const raw = `(.*?)`;", src, re.DOTALL)
assert m, "template string not found"

sections = re.split(r"\n(?=[A-Z][A-Z ]+(?:QUESTIONS|US - [A-Z]+))", m.group(1))
category_map = {
    "COMMON QUESTIONS":    {"rarity": "common",    "category": "General"},
    "UNCOMMON QUESTIONS":  {"rarity": "uncommon",  "category": "General"},
    "RARE QUESTIONS":      {"rarity": "rare",      "category": "General"},
    "EPIC QUESTIONS":      {"rarity": "epic",      "category": "General"},
    "LEGENDARY QUESTIONS": {"rarity": "legendary", "category": "General"},
    "FUTURE US - COMMON":    {"rarity": "common",    "category": "Future Us"},
    "FUTURE US - UNCOMMON":  {"rarity": "uncommon",  "category": "Future Us"},
    "FUTURE US - RARE":      {"rarity": "rare",      "category": "Future Us"},
    "FUTURE US - EPIC":      {"rarity": "epic",      "category": "Future Us"},
    "FUTURE US - LEGENDARY": {"rarity": "legendary", "category": "Future Us"},
    "MYTHIC QUESTIONS":    {"rarity": "mythic",    "category": "General"},
}

questions = []
for section in sections:
    lines = section.strip().split("\n")
    config = category_map.get(lines[0].strip())
    if not config:
        continue
    for line in lines[1:]:
        qm = re.match(r"^\d+\.\s+(.+)", line)
        if qm:
            questions.append({"text": qm.group(1), **config})

Path("questions.json").write_text(
    json.dumps(questions, indent=2, ensure_ascii=False) + "\n"
)
print(f"{len(questions)} questions")
EOF
```

Expected output: `108 questions` (the spec's count). If it differs, STOP and diff against the count in the browser (`QUESTIONS.length` on the pre-change app) before proceeding.

- [ ] **Step 2: Cross-check against the text file before deleting it**

```bash
grep -cE '^[0-9]+\.' Couple_Question_Game.txt
python3 -c "import json; print(len(json.load(open('questions.json'))))"
```
Expected: both print the same number (108). A mismatch means the txt file and the JS template had drifted — report it to the user rather than silently picking one.

- [ ] **Step 3: Replace parseQuestions() with loadQuestions() in app.js**

Run from the repo root (surgical text replacement — the parse function plus its 128-line template literal is easiest to remove by anchor comments):

```bash
python3 - <<'EOF'
from pathlib import Path

path = Path("app.js")
src = path.read_text()

start = src.index("  /* ── Parse game data ── */")
end = src.index("  /* ── Game State ── */")
loader = '''  /* ── Load question data ── */
  async function loadQuestions() {
    try {
      const res = await fetch('questions.json');
      if (res.ok) QUESTIONS.push(...(await res.json()));
    } catch (e) { /* fetch failed — deck stays empty, packs may still load */ }
  }

'''
src = src[:start] + loader + src[end:]

old_boot = """  /* ── Boot ── */
  parseQuestions();
  loadTheme();
  (async () => {
    await loadPacks();"""
new_boot = """  /* ── Boot ── */
  loadTheme();
  (async () => {
    await loadQuestions();
    await loadPacks();"""
assert old_boot in src, "boot block not found"
src = src.replace(old_boot, new_boot)

path.write_text(src)
print("app.js updated")
EOF
grep -n "parseQuestions\|const raw" app.js   # expect: no output
grep -n "loadQuestions" app.js               # expect: the definition + the boot call
```

The `QUESTIONS` const and everything that reads it (e.g. `[...QUESTIONS, ...extra]` in the deck builder) are untouched — the array is just filled by fetch instead of parsing, and the existing async boot guarantees it's populated before `resetGame()` runs.

- [ ] **Step 4: Verify in the running app**

```bash
python3 server.py &
sleep 1
curl -s -o /dev/null -w "questions.json %{http_code}\n" http://127.0.0.1:8080/questions.json
curl -s http://127.0.0.1:8080/questions.json | python3 -c "import json,sys; qs=json.load(sys.stdin); print(len(qs), qs[0])"
kill %1
python3 -m unittest test_server.py -v
```
Expected: `200`; `108 {'text': 'What was your favorite childhood TV show?', 'rarity': 'common', 'category': 'General'}`; all 17 tests PASS. Then open `http://127.0.0.1:8080/` in a browser: deck count matches the pre-change app and cards deal normally.

- [ ] **Step 5: Delete the now-redundant text file and commit**

```bash
git rm Couple_Question_Game.txt
git add app.js questions.json
git commit -m "refactor: single source of truth for questions in questions.json

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- `python3 -m unittest test_server.py -v` → 17 tests, `OK`.
- `python3 server.py`, open in browser: game plays identically (deal, skip, answer, score, theme toggle, pack manager create/toggle/delete).
- `git status` → clean tree; `git log --oneline` → 5 new commits on top of the spec commit.
