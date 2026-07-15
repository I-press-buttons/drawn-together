# Pack Deletion + Move Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a delete-pack button (inline confirmation, live-deck cleanup) and multi-select "move questions to another pack" (marks preserved) to the pack editor.

**Architecture:** `app.js` is backend-agnostic and only talks to `window.store`. Pack deletion already exists in both stores and `server.py` — it only needs UI + live-pile cleanup. Moving questions needs a new store method `moveQuestions(fromPackId, toPackId, qids)` implemented in **both** `store-server.js` (new `server.py` route) and `store-supabase.js` (pack_id update + mark rewrite), plus checkbox/move-bar UI.

**Tech Stack:** Vanilla JS/HTML/CSS, Python stdlib server, `unittest`. No frameworks, no build step, no new dependencies, no new files.

**Spec:** `docs/superpowers/specs/2026-07-15-pack-delete-and-move-questions-design.md`

## Global Constraints

- Zero dependencies; vanilla JS; no new files (Dockerfile / Pages workflow must not need changes).
- Any store-interface change must be made in BOTH `store-server.js` and `store-supabase.js` with the identical signature.
- **No generic `.hidden` rule exists in style.css.** Anything JS toggles with `.hidden` needs its own scoped rule. (This plan avoids new `.hidden` toggles entirely — visibility is handled by re-rendering HTML.)
- Supabase ids are **uuids containing dashes** — never parse a qkey by splitting on `-`; always build/strip using the known `p<packId>-` prefix.
- `server.py` question ids are **per-pack integers** (`_next_id`); moving can collide and must reassign.
- Marks (favorites/retired) reference questions as `p<packId>-<questionId>`.
- UI copy/tone per PRODUCT.md: plain, adult, no gamification; WCAG AA; `aria-label` on icon-only buttons.
- Commit after each task. Push `main` after committing (repo policy). End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run the full suite with `python3 -m unittest test_server.py` from the repo root.

---

### Task 1: `server.py` move route + tests

**Files:**
- Modify: `server.py` (add route in `do_POST`, after the "Add question to a pack" block that ends near line 220)
- Test: `test_server.py` (append tests inside `PackAPITest`)

**Interfaces:**
- Produces: `POST /api/packs/<fromId>/questions/move` with JSON body `{"toPackId": int, "qids": [int, ...]}` → `200 {"moved": [{"oldQkey": str, "newQkey": str, "question": {id, text, rarity, category}}]}`. Errors: 400 (bad body / move-to-self), 404 (unknown pack or qid not in source; all-or-nothing — nothing moves on 404). Marks in `user_data.json` are rewritten old→new qkey preserving list membership.

- [ ] **Step 1: Write the failing tests**

Append inside `PackAPITest` in `test_server.py` (after `test_delete_question_unknown_pack_404`):

```python
    # ── Moving questions between packs ──

    def make_move_fixture(self):
        """Source pack with 3 questions + empty target pack."""
        src = self.make_pack("Source")
        dst = self.make_pack("Target")
        qs = []
        for text in ["Q one?", "Q two?", "Q three?"]:
            _, q = self.request("POST", f"/api/packs/{src['id']}/questions", {"text": text})
            qs.append(q)
        return src, dst, qs

    def test_move_questions(self):
        src, dst, qs = self.make_move_fixture()
        status, body = self.request(
            "POST", f"/api/packs/{src['id']}/questions/move",
            {"toPackId": dst["id"], "qids": [qs[0]["id"], qs[2]["id"]]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(body["moved"]), 2)
        self.assertEqual(body["moved"][0]["oldQkey"], f"p{src['id']}-{qs[0]['id']}")
        self.assertEqual(body["moved"][0]["question"]["text"], "Q one?")
        _, packs = self.request("GET", "/api/packs")
        by_id = {p["id"]: p for p in packs}
        self.assertEqual([q["text"] for q in by_id[src["id"]]["questions"]], ["Q two?"])
        self.assertEqual(
            [q["text"] for q in by_id[dst["id"]]["questions"]], ["Q one?", "Q three?"])

    def test_move_reassigns_colliding_ids(self):
        src, dst, qs = self.make_move_fixture()
        _, existing = self.request(
            "POST", f"/api/packs/{dst['id']}/questions", {"text": "Existing?"})
        # qs[0] has id 1, which collides with `existing` (also id 1) in the target
        status, body = self.request(
            "POST", f"/api/packs/{src['id']}/questions/move",
            {"toPackId": dst["id"], "qids": [qs[0]["id"]]},
        )
        self.assertEqual(status, 200)
        moved_q = body["moved"][0]["question"]
        self.assertNotEqual(moved_q["id"], existing["id"])
        self.assertEqual(body["moved"][0]["newQkey"], f"p{dst['id']}-{moved_q['id']}")

    def test_move_rewrites_marks(self):
        src, dst, qs = self.make_move_fixture()
        self.request("POST", f"/api/marks/favorites/p{src['id']}-{qs[0]['id']}")
        self.request("POST", f"/api/marks/retired/p{src['id']}-{qs[1]['id']}")
        _, body = self.request(
            "POST", f"/api/packs/{src['id']}/questions/move",
            {"toPackId": dst["id"], "qids": [qs[0]["id"], qs[1]["id"]]},
        )
        _, marks = self.request("GET", "/api/marks")
        self.assertEqual(marks["favorites"], [body["moved"][0]["newQkey"]])
        self.assertEqual(marks["retired"], [body["moved"][1]["newQkey"]])

    def test_move_to_same_pack_400(self):
        src, dst, qs = self.make_move_fixture()
        status, err = self.request(
            "POST", f"/api/packs/{src['id']}/questions/move",
            {"toPackId": src["id"], "qids": [qs[0]["id"]]},
        )
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_move_empty_or_missing_qids_400(self):
        src, dst, qs = self.make_move_fixture()
        for bad_body in ({"toPackId": dst["id"], "qids": []},
                         {"toPackId": dst["id"]},
                         {"qids": [qs[0]["id"]]}):
            status, err = self.request(
                "POST", f"/api/packs/{src['id']}/questions/move", bad_body)
            self.assertEqual(status, 400)

    def test_move_unknown_pack_404(self):
        src, dst, qs = self.make_move_fixture()
        status, _ = self.request(
            "POST", "/api/packs/999/questions/move",
            {"toPackId": dst["id"], "qids": [qs[0]["id"]]})
        self.assertEqual(status, 404)
        status, _ = self.request(
            "POST", f"/api/packs/{src['id']}/questions/move",
            {"toPackId": 999, "qids": [qs[0]["id"]]})
        self.assertEqual(status, 404)

    def test_move_unknown_qid_is_all_or_nothing_404(self):
        src, dst, qs = self.make_move_fixture()
        status, _ = self.request(
            "POST", f"/api/packs/{src['id']}/questions/move",
            {"toPackId": dst["id"], "qids": [qs[0]["id"], 999]})
        self.assertEqual(status, 404)
        _, packs = self.request("GET", "/api/packs")
        by_id = {p["id"]: p for p in packs}
        self.assertEqual(len(by_id[src["id"]]["questions"]), 3)  # nothing moved
        self.assertEqual(by_id[dst["id"]]["questions"], [])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest test_server.py -v 2>&1 | tail -20`
Expected: the 7 new `test_move_*` tests FAIL (404 "Not found" instead of expected statuses); all pre-existing tests still PASS.

- [ ] **Step 3: Implement the route**

In `server.py`, inside `do_POST`, insert between the "Add question to a pack" block (`json_response(self, {"error": "Pack not found"}, 404); return`) and the "Add a mark" block:

```python
        # ── Move questions to another pack ──
        m = re.match(r"^/api/packs/(\d+)/questions/move$", self.path)
        if m:
            from_id = int(m.group(1))
            body = read_json_body(self)
            if body is None:
                return
            to_id = body.get("toPackId")
            qids = body.get("qids")
            if not isinstance(to_id, int) or not isinstance(qids, list) or not qids \
                    or not all(isinstance(q, int) for q in qids):
                json_response(self, {"error": "toPackId and a non-empty qids list required"}, 400)
                return
            if to_id == from_id:
                json_response(self, {"error": "Source and target pack are the same"}, 400)
                return
            qids = list(dict.fromkeys(qids))  # de-dupe, keep order
            with PACKS_LOCK:
                packs = load_packs()
                src = next((p for p in packs if p["id"] == from_id), None)
                dst = next((p for p in packs if p["id"] == to_id), None)
                if src is None or dst is None:
                    json_response(self, {"error": "Pack not found"}, 404)
                    return
                by_id = {q["id"]: q for q in src.get("questions", [])}
                if any(qid not in by_id for qid in qids):
                    json_response(self, {"error": "Question not found in source pack"}, 404)
                    return
                dst.setdefault("questions", [])
                data = load_user_data()
                marks_changed = False
                moved = []
                for qid in qids:
                    q = by_id[qid]
                    src["questions"].remove(q)
                    new_qid = qid
                    if any(t["id"] == new_qid for t in dst["questions"]):
                        new_qid = _next_id(dst["questions"])
                    q = {**q, "id": new_qid}
                    dst["questions"].append(q)
                    old_qkey, new_qkey = f"p{from_id}-{qid}", f"p{to_id}-{new_qid}"
                    for lst in MARK_LISTS:
                        if old_qkey in data[lst]:
                            data[lst] = [new_qkey if k == old_qkey else k for k in data[lst]]
                            marks_changed = True
                    moved.append({"oldQkey": old_qkey, "newQkey": new_qkey, "question": q})
                save_packs(packs)
                if marks_changed:
                    save_user_data(data)
            json_response(self, {"moved": moved})
            return
```

Note: `_next_id` is defined at the bottom of `server.py`; `MARK_LISTS` is an existing module constant. The all-or-nothing 404 returns *before* any mutation, and nothing is saved until `save_packs` after the loop, so a failed request never persists partial state.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest test_server.py -v 2>&1 | tail -20`
Expected: ALL tests PASS (including all pre-existing ones).

- [ ] **Step 5: Commit and push**

```bash
git add server.py test_server.py
git commit -m "feat: move-questions API route with mark rewriting

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 2: `moveQuestions` in both stores

**Files:**
- Modify: `store-server.js` (insert after `deleteQuestion`, ~line 48)
- Modify: `store-supabase.js` (insert after `deleteQuestion`, ~line 77)

**Interfaces:**
- Consumes: Task 1's `POST /api/packs/<from>/questions/move` (server backend only).
- Produces (identical in both stores): `async moveQuestions(fromPackId, toPackId, qids)` → resolves to `[{ oldQkey, newQkey, question }]` on success (`question` = `{id, text, rarity, category}` as stored in the target pack), or `null` on any failure.

- [ ] **Step 1: Add to `store-server.js`**

Insert after the `deleteQuestion` method (keep the comma-separated object style):

```js
    async moveQuestions(fromPackId, toPackId, qids) {
      try {
        const res = await fetch(`${API_BASE}/${fromPackId}/questions/move`, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ toPackId: Number(toPackId), qids: qids.map(Number) }),
        });
        const data = await json(res);
        return data ? data.moved : null;
      } catch (e) { return null; }
    },
```

- [ ] **Step 2: Add to `store-supabase.js`**

Insert after the `deleteQuestion` method. Supabase ids are uuids and stay unchanged across the move, so `newQkey` is just the new pack prefix. Never parse qkeys by splitting on `-` (uuids contain dashes).

```js
    async moveQuestions(fromPackId, toPackId, qids) {
      const { data, error } = await client.from('questions')
        .update({ pack_id: toPackId })
        .in('id', qids).eq('pack_id', fromPackId)
        .select('id, text, rarity, category');
      if (error || !data || data.length !== qids.length) return null;
      /* Rewrite marks: ids are unchanged, only the pack prefix moves. */
      const oldPrefix = `p${fromPackId}-`;
      const oldKeys = data.map(q => `${oldPrefix}${q.id}`);
      const { data: markRows } = await client.from('marks')
        .select('list, qkey').in('qkey', oldKeys);
      if (markRows && markRows.length > 0) {
        await client.from('marks').upsert(markRows.map(r => ({
          list: r.list,
          qkey: `p${toPackId}-${r.qkey.slice(oldPrefix.length)}`,
        })));
        await client.from('marks').delete().in('qkey', oldKeys);
      }
      return data.map(q => ({
        oldQkey: `${oldPrefix}${q.id}`,
        newQkey: `p${toPackId}-${q.id}`,
        question: q,
      }));
    },
```

- [ ] **Step 3: Verify syntax and run the suite**

Run: `node --check store-server.js && node --check store-supabase.js && python3 -m unittest test_server.py 2>&1 | tail -3`
Expected: no syntax errors; all tests PASS.

- [ ] **Step 4: Commit and push**

```bash
git add store-server.js store-supabase.js
git commit -m "feat: moveQuestions store method (server + supabase backends)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 3: Pack deletion UI

**Files:**
- Modify: `app.js` — state near line 285 (`let openPackId = null;`), `renderPacks()` (~line 307), `bindPackEvents()` (~line 441)
- Modify: `style.css` — after the `.pack-q-del` rules (~line 1204)

**Interfaces:**
- Consumes: existing `deletePack(packId)` helper in app.js (calls `window.store.deletePack`, already prunes `questionPacks`), existing helpers `drawCard()`, `showEmptyState()`, `updateUI()`, `renderAnsweredList()`, `saveCurrentSession()`, `loadMarks()`, `showToast(msg)`.
- Produces: `let deletingPackId = null;` module state and `purgePackFromPlay(packId)` — Task 4 does not depend on these, but the header/body render structure it creates is shared.

- [ ] **Step 1: Add state and the purge helper**

In `app.js`, right after `let editingQ = null;   /* "packId::qid" while a question row is in edit mode */` add:

```js
  let deletingPackId = null;   /* pack id with the delete-confirm strip showing */
```

After the `syncDeckWithPack` function (ends ~line 744), add:

```js
  /* Remove a deleted pack's cards from every live pile. The current card is
     replaced by the next draw (or the empty state) so play just continues. */
  function purgePackFromPlay(packId) {
    const prefix = `p${packId}-`;
    deck = deck.filter(q => !q.qkey.startsWith(prefix));
    skipped = skipped.filter(q => !q.qkey.startsWith(prefix));
    discard = discard.filter(q => !q.qkey.startsWith(prefix));
    if (currentCard && currentCard.qkey.startsWith(prefix)) {
      currentCard = null;
      if (deck.length > 0) drawCard(); else showEmptyState();
    }
    updateUI();
    renderAnsweredList();
    saveCurrentSession();
  }
```

- [ ] **Step 2: Render the trash button and confirm strip**

In `renderPacks()`, in the custom-pack template: after the chevron `<svg ...data-chevron...>` line, add (only rendered while expanded):

```js
            ${isOpen ? `<button class="pack-del-btn" data-del-pack="${pack.id}" aria-label="Delete pack: ${escapeAttr(pack.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>` : ''}
```

Immediately inside `<div class="pack-body ${isOpen ? 'open' : ''}">`, before `<div class="pack-questions">`, add:

```js
            ${String(deletingPackId) === String(pack.id) ? `<div class="pack-del-confirm" role="alertdialog" aria-label="Confirm pack deletion">
              <span class="pack-del-confirm-text">Delete &ldquo;${escapeHTML(pack.name)}&rdquo; and its ${rCount} ${rCount === 1 ? 'question' : 'questions'}? This can&rsquo;t be undone.</span>
              <div class="pack-del-confirm-actions">
                <button class="pack-del-confirm-btn" data-confirm-del="${pack.id}">Delete</button>
                <button class="btn-restore" type="button" data-cancel-del>Cancel</button>
              </div>
            </div>` : ''}
```

- [ ] **Step 3: Bind the events**

In `bindPackEvents()`: update the expand/collapse handler so toggling a pack clears any pending confirm —

```js
    /* Expand/collapse pack */
    document.querySelectorAll('.pack-header[data-pack-id]').forEach(hdr => {
      hdr.addEventListener('click', (e) => {
        const id = hdr.dataset.packId;
        openPackId = String(openPackId) === id ? null : id;
        deletingPackId = null;
        renderPacks();
      });
    });
```

Then add three new bindings (e.g. after the "Delete question from pack" block):

```js
    /* Delete pack: trash icon shows the inline confirm strip */
    document.querySelectorAll('[data-del-pack]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deletingPackId = btn.dataset.delPack;
        renderPacks();
      });
    });
    document.querySelectorAll('[data-confirm-del]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.confirmDel;
        if (await deletePack(id)) {
          purgePackFromPlay(id);
          if (String(openPackId) === String(id)) openPackId = null;
          await loadMarks();          /* backend dropped the pack's marks */
        } else {
          showToast("Couldn't delete the pack — check the connection");
        }
        deletingPackId = null;
        renderPacks();
      });
    });
    document.querySelectorAll('[data-cancel-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deletingPackId = null;
        renderPacks();
      });
    });
```

- [ ] **Step 4: Add the CSS**

In `style.css`, after the `.pack-q-del:hover` rule (~line 1204), add (the red matches the existing destructive hover `oklch(0.55 0.18 25)`):

```css
  .pack-del-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--ink-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.2s, background 0.2s;
    -webkit-tap-highlight-color: transparent;
  }
  .pack-del-btn svg { width: 0.875rem; height: 0.875rem; }
  .pack-del-btn:hover, .pack-del-btn:focus-visible {
    color: oklch(0.55 0.18 25);
    background: var(--accent-subtle);
  }

  .pack-del-confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.625rem;
    border: 1px solid oklch(0.55 0.18 25 / 0.35);
    border-radius: var(--radius-sm);
    background: var(--accent-subtle);
    font-size: 0.8125rem;
    color: var(--ink-dim);
  }
  .pack-del-confirm-text { flex: 1 1 12rem; }
  .pack-del-confirm-actions { display: flex; gap: 0.5rem; flex-shrink: 0; }
  .pack-del-confirm-btn {
    border: none;
    border-radius: var(--radius-sm);
    background: oklch(0.55 0.18 25);
    color: oklch(1 0 0);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.375rem 0.75rem;
    cursor: pointer;
  }
  .pack-del-confirm-btn:hover { background: oklch(0.5 0.18 25); }
```

- [ ] **Step 5: Verify**

Run: `node --check app.js && python3 -m unittest test_server.py 2>&1 | tail -3`
Expected: no syntax errors, all tests pass.

Then manual check: `DATA_DIR=$(mktemp -d) PORT=8199 python3 server.py` in the background, open `http://localhost:8199`, open the Packs modal, create a pack "Temp" with one question, expand it → trash icon appears right of the chevron; collapsed packs show none. Click trash → confirm strip appears; Cancel dismisses; Delete removes the pack and its cards from the remaining-count. Kill the server afterward.

- [ ] **Step 6: Commit and push**

```bash
git add app.js style.css
git commit -m "feat: delete pack from the editor with inline confirm + deck cleanup

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 4: Move-questions UI

**Files:**
- Modify: `app.js` — state near `deletingPackId`, `renderPacks()` custom-pack template, `bindPackEvents()`
- Modify: `style.css` — after the Task 3 rules

**Interfaces:**
- Consumes: `window.store.moveQuestions(fromPackId, toPackId, qids)` from Task 2; `deletingPackId` state and render structure from Task 3; existing helpers `loadPacks()`, `loadMarks()`, `shuffle()`, `isRetired(qkey)`, `updateUI()`, `renderAnsweredList()`, `saveCurrentSession()`, `showToast(msg)`.
- Produces: nothing consumed later.

- [ ] **Step 1: Add selection state**

Next to `let deletingPackId = null;` add:

```js
  let selectedQs = new Set();  /* "packId::qid" keys checked for moving */
```

(`::` is safe as a separator — Supabase uuids contain dashes but never colons.)

- [ ] **Step 2: Render checkboxes and the move bar**

In `renderPacks()`, inside the custom-pack loop, right after `const rCount = pack.questions.length;` add:

```js
      const selCount = [...selectedQs].filter(k => k.startsWith(`${pack.id}::`)).length;
      const otherPacks = questionPacks.filter(p => String(p.id) !== String(pack.id));
```

In the non-edit question row template (the `return `<div class="pack-q">...` branch), add a checkbox as the first child, before `<span class="pack-q-text">`:

```js
                  <input type="checkbox" class="pack-q-check" data-check="${pack.id}::${q.id}" ${selectedQs.has(`${pack.id}::${q.id}`) ? 'checked' : ''} aria-label="Select question for moving">
```

In the pack body, directly after the Task 3 confirm-strip expression (still before `<div class="pack-questions">`), add the move bar (only when something is selected):

```js
            ${selCount > 0 ? `<div class="pack-move-bar">
              <span class="pack-move-count">Move ${selCount}</span>
              ${otherPacks.length > 0 ? `<select class="pack-move-select" data-move-select="${pack.id}" aria-label="Destination pack">
                ${otherPacks.map(p => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('')}
              </select>
              <button class="pack-add-btn" type="button" data-move-btn="${pack.id}">Move</button>`
              : '<span class="pack-move-hint">Create another pack to move questions</span>'}
            </div>` : ''}
```

- [ ] **Step 3: Clear selections on expand/collapse**

In the expand/collapse handler (updated in Task 3), add `selectedQs.clear();` next to `deletingPackId = null;`.

- [ ] **Step 4: Add the reconciliation helper**

After `purgePackFromPlay` (Task 3), add:

```js
  /* Reconcile live piles after questions moved between packs: history cards
     (answered/skipped/current) keep playing under their new identity; deck
     membership follows the destination pack's enabled state. */
  function applyMoveToPlay(toPackId, moved) {
    const toPack = questionPacks.find(p => String(p.id) === String(toPackId));
    const destEnabled = !!(toPack && toPack.enabled);
    const destName = toPack ? toPack.name : '';
    for (const { oldQkey, newQkey, question } of moved) {
      for (const pile of [discard, skipped]) {
        for (const card of pile) {
          if (card.qkey === oldQkey) { card.qkey = newQkey; card.pack = destName; }
        }
      }
      if (currentCard && currentCard.qkey === oldQkey) {
        currentCard.qkey = newQkey;
        currentCard.pack = destName;
      }
      const newCard = {
        text: question.text,
        rarity: question.rarity,
        category: question.category || 'Custom',
        pack: destName,
        qkey: newQkey,
      };
      const idx = deck.findIndex(c => c.qkey === oldQkey);
      if (idx !== -1) {
        if (destEnabled) deck[idx] = newCard; else deck.splice(idx, 1);
      } else if (destEnabled && !isRetired(newQkey)) {
        /* source pack was disabled (card not in deck): shuffle it in unless
           it's already live as the current/answered/skipped card */
        const live = (currentCard && currentCard.qkey === newQkey)
          || discard.some(c => c.qkey === newQkey)
          || skipped.some(c => c.qkey === newQkey);
        if (!live) deck.splice(Math.floor(Math.random() * (deck.length + 1)), 0, newCard);
      }
    }
    updateUI();
    renderAnsweredList();
    saveCurrentSession();
  }
```

- [ ] **Step 5: Bind checkbox and move events**

In `bindPackEvents()`, after the Task 3 delete-pack bindings, add:

```js
    /* Select questions for moving */
    document.querySelectorAll('.pack-q-check').forEach(cb => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        if (cb.checked) selectedQs.add(cb.dataset.check);
        else selectedQs.delete(cb.dataset.check);
        renderPacks();
      });
    });

    /* Move selected questions to another pack */
    document.querySelectorAll('[data-move-btn]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const fromId = btn.dataset.moveBtn;
        const select = document.querySelector(`[data-move-select="${fromId}"]`);
        if (!select) return;
        const toId = select.value;
        const qids = [...selectedQs]
          .filter(k => k.startsWith(`${fromId}::`))
          .map(k => k.slice(`${fromId}::`.length));
        if (qids.length === 0) return;
        const moved = await window.store.moveQuestions(fromId, toId, qids);
        if (!moved) {
          showToast("Couldn't move those — check the connection");
          return;
        }
        await loadMarks();               /* backend rewrote mark qkeys */
        applyMoveToPlay(toId, moved);    /* needs fresh marks for isRetired */
        await loadPacks();               /* refresh both packs' question lists */
        selectedQs.clear();
        renderPacks();
        showToast(`Moved ${moved.length} ${moved.length === 1 ? 'question' : 'questions'}`);
      });
    });
```

- [ ] **Step 6: Add the CSS**

In `style.css`, after the Task 3 `.pack-del-confirm-btn:hover` rule, add:

```css
  .pack-q-check {
    flex-shrink: 0;
    width: 0.9375rem;
    height: 0.9375rem;
    margin: 0;
    accent-color: var(--primary);
    cursor: pointer;
  }

  .pack-move-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.625rem;
    border-radius: var(--radius-sm);
    background: var(--bg);
    font-size: 0.8125rem;
  }
  .pack-move-count {
    font-weight: 600;
    color: var(--ink-dim);
    flex-shrink: 0;
  }
  .pack-move-select {
    flex: 1;
    min-width: 0;
    font-size: 0.75rem;
    padding: 0.375rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--card-border);
    background: var(--surface-raised);
    color: var(--ink-dim);
  }
  .pack-move-hint {
    color: var(--ink-muted);
    font-size: 0.75rem;
  }
```

- [ ] **Step 7: Verify**

Run: `node --check app.js && python3 -m unittest test_server.py 2>&1 | tail -3`
Expected: no syntax errors, all tests pass.

Manual check with `DATA_DIR=$(mktemp -d) PORT=8199 python3 server.py`: create packs "A" (2 questions) and "B", expand A → rows have checkboxes; check one → move bar "Move 1 to [B] [Move]" appears; Move → question appears under B, counts update, toast shows. With only one pack, checking a row shows the "Create another pack" hint. Favorite one of A's questions mid-game, move it to B, confirm it's still in Greatest Hits. Kill the server afterward.

- [ ] **Step 8: Commit and push**

```bash
git add app.js style.css
git commit -m "feat: multi-select move questions between packs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```
