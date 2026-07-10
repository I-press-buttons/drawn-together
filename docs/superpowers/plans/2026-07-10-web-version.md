# Web Version (Supabase + GitHub Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Drawn Together as a static website on GitHub Pages where invited users sign in via email magic link and keep packs/favorites in Supabase, while the Docker/local version keeps working unchanged from the same codebase.

**Architecture:** All persistence in `app.js` moves behind a `window.store` interface. `config.js` selects the backend: the repo copy selects `store-server.js` (existing `/api` fetches); the Pages deploy swaps in `config.web.js`, selecting `store-supabase.js` (vendored supabase-js, RLS-protected tables). A GitHub Actions workflow copies the static files and deploys.

**Tech Stack:** Vanilla JS (plain scripts, NO ES modules, no build step), Python stdlib server (unchanged), supabase-js v2 UMD (vendored file), GitHub Actions Pages deploy.

## Global Constraints

- Zero build tooling: plain `<script defer>` files; no npm/bundler in the shipped app. The only third-party code is the vendored `vendor/supabase.js`.
- `python3 -m unittest test_server.py` (32 tests) must pass after every task.
- Existing behavior of the Docker/local version must not change (same UI, same API calls, same data files).
- Supabase project: URL `https://wajjncluitygfatocbba.supabase.co`, publishable key `sb_publishable_PK351PhseJSGE7C9WMeF2w_szz10snZ` (public-safe; committed).
- Question keys: base `b1`…`b108`; pack questions `p<packId>-<qid>`. With Supabase, ids are UUIDs — app.js must treat all ids as opaque strings and never parse qkeys apart.
- Name/text limits: pack names 1–60 chars, question text 1–300 chars (both backends).
- Playwright smoke script lives in `tools/` (dev-only; never copied into the Docker image or the Pages site).
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Extract the store interface (server backend) + smoke script

**Files:**
- Create: `config.js`, `store-server.js`, `tools/smoke.mjs`
- Modify: `index.html` (script tags), `app.js:59-187` (replace fetch bodies), `Dockerfile` (COPY line)

**Interfaces:**
- Produces: `window.DT_BACKEND` (string, set by config.js). `window.store` object with exactly:
  `backend` (string), `loadPacks() → Promise<Array<{id,name,enabled,questions:Array<{id,text,rarity,category}>}>>`, `createPack(name) → Promise<pack|null>`, `updatePack(id, fields) → Promise<pack|null>` (fields: `{name?, enabled?}`), `deletePack(id) → Promise<bool>`, `addQuestion(packId, {text,rarity,category}) → Promise<question|null>`, `updateQuestion(packId, qid, fields) → Promise<question|null>`, `deleteQuestion(packId, qid) → Promise<bool>`, `loadMarks() → Promise<{favorites:string[], retired:string[]}>`, `setMark(list, qkey, on) → Promise<{favorites,retired}|null>` (null = failed), `signedIn() → bool`, `userEmail() → string|null`, `onAuthChange(cb)`, `signIn(email) → Promise<bool>`, `signOut() → Promise<void>`.
- app.js keeps its existing function names (`loadPacks`, `createPack`, `togglePack`, `deletePack`, `addQuestionToPack`, `updateQuestion`, `deleteQuestionFromPack`, `loadMarks`, `setMark`) as thin wrappers that call `window.store` and update the local `questionPacks`/`marks` caches exactly as today.

- [ ] **Step 1: Create `config.js`**

```js
/* Backend selector. The GitHub Pages deploy replaces this file with
   config.web.js, which selects the "supabase" backend. */
window.DT_BACKEND = 'server';
```

- [ ] **Step 2: Create `store-server.js`** — move the raw fetch logic out of app.js verbatim:

```js
/* Store implementation backed by server.py's /api endpoints. */
(function () {
  if (window.DT_BACKEND !== 'server') return;
  const API_BASE = '/api/packs';

  async function json(res) { return res.ok ? res.json() : null; }

  window.store = {
    backend: 'server',

    async loadPacks() {
      try { return (await json(await fetch(API_BASE))) || []; }
      catch (e) { return []; }
    },
    async createPack(name) {
      const res = await fetch(API_BASE, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ name }),
      });
      return json(res);
    },
    async updatePack(id, fields) {
      const res = await fetch(`${API_BASE}/${id}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(fields),
      });
      return json(res);
    },
    async deletePack(id) {
      return (await fetch(`${API_BASE}/${id}`, { method: 'DELETE' })).ok;
    },
    async addQuestion(packId, q) {
      const res = await fetch(`${API_BASE}/${packId}/questions`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(q),
      });
      return json(res);
    },
    async updateQuestion(packId, qid, fields) {
      const res = await fetch(`${API_BASE}/${packId}/questions/${qid}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(fields),
      });
      return json(res);
    },
    async deleteQuestion(packId, qid) {
      return (await fetch(`${API_BASE}/${packId}/questions/${qid}`, { method: 'DELETE' })).ok;
    },
    async loadMarks() {
      try { return (await json(await fetch('/api/marks'))) || { favorites: [], retired: [] }; }
      catch (e) { return { favorites: [], retired: [] }; }
    },
    async setMark(list, qkey, on) {
      try {
        const res = await fetch(`/api/marks/${list}/${qkey}`, { method: on ? 'POST' : 'DELETE' });
        return json(res);
      } catch (e) { return null; }
    },

    /* Auth is a no-op on the local server. */
    signedIn() { return true; },
    userEmail() { return null; },
    onAuthChange(cb) {},
    async signIn(email) { return false; },
    async signOut() {},
  };
})();
```

- [ ] **Step 3: Rewire `app.js`** — delete `const API_BASE = '/api/packs';` (line 60) and replace the bodies of the nine data functions with store calls, keeping cache updates identical. Exact replacements:

```js
  async function loadMarks() {
    marks = await window.store.loadMarks();
  }
```

```js
  /* Optimistic toggle: mutate locally, revert if the backend rejects. */
  async function setMark(listName, qkey, on) {
    const list = marks[listName];
    const had = list.includes(qkey);
    if (on && !had) list.push(qkey);
    if (!on && had) marks[listName] = list.filter(k => k !== qkey);
    const result = await window.store.setMark(listName, qkey, on);
    if (result) { marks = result; return true; }
    await loadMarks();
    showToast("Couldn't save that — check the connection");
    return false;
  }
```

```js
  async function loadPacks() {
    questionPacks = await window.store.loadPacks();
  }
```

```js
  async function createPack(name) {
    const pack = await window.store.createPack(name);
    if (pack) questionPacks.push(pack);
    return pack;
  }
```

```js
  async function togglePack(packId, enabled) {
    const updated = await window.store.updatePack(packId, { enabled });
    if (updated) {
      const idx = questionPacks.findIndex(p => p.id === packId);
      if (idx !== -1) questionPacks[idx] = updated;
      return true;
    }
    return false;
  }
```

```js
  async function deletePack(packId) {
    if (await window.store.deletePack(packId)) {
      questionPacks = questionPacks.filter(p => p.id !== packId);
      return true;
    }
    return false;
  }
```

```js
  async function addQuestionToPack(packId, text, rarity, category) {
    const q = await window.store.addQuestion(packId, { text, rarity, category });
    if (q) {
      const pack = questionPacks.find(p => p.id === packId);
      if (pack) pack.questions.push(q);
    }
    return q;
  }
```

```js
  async function updateQuestion(packId, qid, fields) {
    const updated = await window.store.updateQuestion(packId, qid, fields);
    if (updated) {
      const pack = questionPacks.find(p => p.id === packId);
      if (pack) {
        const idx = pack.questions.findIndex(q => q.id === qid);
        if (idx !== -1) pack.questions[idx] = updated;
      }
    }
    return updated;
  }
```

```js
  async function deleteQuestionFromPack(packId, qid) {
    if (await window.store.deleteQuestion(packId, qid)) {
      const pack = questionPacks.find(p => p.id === packId);
      if (pack) pack.questions = pack.questions.filter(q => q.id !== qid);
      return true;
    }
    return false;
  }
```

- [ ] **Step 4: Update `index.html`** — replace `<script src="app.js" defer></script>` with:

```html
<script src="config.js" defer></script>
<script src="store-server.js" defer></script>
<script src="app.js" defer></script>
```

(Deferred scripts execute in document order, so `window.store` exists before app.js runs. `store-supabase.js` + vendor join this list in Task 3.)

- [ ] **Step 5: Update `Dockerfile`** — change the COPY line to include the new files:

```dockerfile
COPY server.py index.html style.css app.js config.js store-server.js questions.json ./
```

- [ ] **Step 6: Write `tools/smoke.mjs`** — Playwright end-to-end against the local server (dev machine has playwright installed under `~/.claude/jobs/*/tmp/shots`; the script takes the module path from `PLAYWRIGHT_DIR` or resolves normally):

```js
// Usage: PORT=8155 node tools/smoke.mjs
// Requires: `npm i playwright` somewhere; set NODE_PATH or run via the
// orchestrator which knows an install location. Starts no server itself —
// expects one already running on PORT with a CLEAN temp DATA_DIR.
import { createRequire } from 'module';
const require = createRequire(process.env.PLAYWRIGHT_DIR
  ? process.env.PLAYWRIGHT_DIR + '/package.json'
  : import.meta.url);
const { chromium } = require('playwright');

const PORT = process.env.PORT || '8155';
const BASE = `http://127.0.0.1:${PORT}/`;
const fail = (msg) => { console.error('SMOKE FAIL:', msg); process.exit(1); };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => fail('page error: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });

// 1. Deck loaded
const count = await page.textContent('#remainingCount');
if (count !== '108') fail(`deck count ${count} != 108`);

// 2. Draw a card, heart it, answer it
await page.click('#drawBtn');
await page.waitForSelector('#cardStage:not(.hidden)');
await page.click('#favBtn');
await page.waitForFunction(() =>
  document.querySelector('#favBtn').getAttribute('aria-pressed') === 'true');
await page.click('#answeredBtn');

// 3. Pack manager: create pack, add + edit a question
await page.click('#editBtn');
await page.click('#newPackBtn');
await page.fill('#newPackName', 'Smoke Pack');
await page.click('#newPackForm button[type=submit]');
await page.waitForSelector('.pack-header');
await page.click('.pack-header');            // expand
await page.fill('.pack-add-input', 'Smoke question one?');
await page.click('.pack-add-form button[type=submit]');
await page.waitForSelector('.pack-q');

// 4. Marks survived server round-trip
const marks = await page.evaluate(() => window.store.loadMarks());
if (marks.favorites.length !== 1) fail('favorite not persisted');

await browser.close();
console.log('SMOKE PASS');
```

(If a selector here doesn't match the real DOM, fix the selector in the
script — the game markup is the source of truth. Do not change the game to
fit the script.)

- [ ] **Step 7: Verify**

Run: `python3 -m unittest test_server.py` → 32 tests OK.
Run: start a clean server (`DATA_DIR=$(mktemp -d) PORT=8155 python3 server.py &`), then `PLAYWRIGHT_DIR=<orchestrator-provided> PORT=8155 node tools/smoke.mjs` → `SMOKE PASS`. Kill the server.

- [ ] **Step 8: Commit**

```bash
git add config.js store-server.js app.js index.html Dockerfile tools/smoke.mjs
git commit -m "refactor: extract store interface behind window.store (server backend)"
```

---

### Task 2: Make app.js id-agnostic (UUID-safe)

**Files:**
- Modify: `app.js` — `findQuestionByKey` (~line 92), pack-manager event delegation (~lines 355-460)

**Interfaces:**
- Consumes: `window.store` from Task 1.
- Produces: app.js treats every pack/question id as an opaque string. Dataset attributes carry ids verbatim; comparisons use `String(a) === String(b)`. The edit form uses two dataset attributes (`data-edit-pack`, `data-edit-qid`) instead of a joined `"packId-qid"` string.

- [ ] **Step 1: Rewrite `findQuestionByKey`** to compute qkeys instead of parsing them:

```js
  function findQuestionByKey(qkey) {
    const base = QUESTIONS.find(q => q.qkey === qkey);
    if (base) return base;
    for (const pack of questionPacks) {
      for (const q of pack.questions) {
        if (`p${pack.id}-${q.id}` === qkey) {
          return { text: q.text, rarity: q.rarity, category: q.category || 'Custom', qkey };
        }
      }
    }
    return null;
  }
```

- [ ] **Step 2: Remove every `parseInt` on ids in the pack-manager handlers.** Current sites (line numbers pre-Task-1): 361 (`btn.dataset.toggle`), 372 (`hdr.dataset.packId`), 382 (`form.dataset.packForm`), 400-401 (`btn.dataset.pack` / `btn.dataset.qid`). In each, use the dataset string directly, and change the corresponding lookup comparisons to string-safe form, e.g.:

```js
        const id = btn.dataset.toggle;
        const pack = questionPacks.find(p => String(p.id) === id);
```

Audit ALL `.find`/`.findIndex` on `questionPacks` and `pack.questions` reached from dataset values and wrap both sides with `String(...)` where the id may now be a string. (The wrapper functions from Task 1 — `togglePack(packId, …)` etc. — receive the dataset string and pass it to the store; server.py routes match `\d+` from the URL string, so string ids work unchanged there.)

- [ ] **Step 3: Fix the edit form dataset.** Where the edit form is rendered with `data-edit-form="${packId}-${qid}"` and consumed via `form.dataset.editForm.split('-').map(Number)` (~line 451), render two attributes instead:

```js
        <form class="pack-q-edit-form" data-edit-pack="${pack.id}" data-edit-qid="${q.id}" ...>
```

and consume:

```js
        const packId = form.dataset.editPack;
        const qid = form.dataset.editQid;
```

Apply the same to the `editingQ` state variable (line ~432): store it as `` `${pack.id}::${q.id}` `` with a `::` separator (UUIDs contain `-` but never `::`), or as an object `{packId, qid}` — implementer's choice, but no single-`-` joins anywhere.

- [ ] **Step 4: Verify** — restart the clean server, rerun the smoke script (it creates a pack, adds a question, edits nothing yet — extend it):

Add to `tools/smoke.mjs` after the add-question block:

```js
// 5. Edit the question inline
await page.click('.pack-q-edit-btn');
await page.fill('.pack-q-edit-form input[type=text], .pack-q-edit-form textarea', 'Smoke question edited?');
await page.click('.pack-q-edit-form button[type=submit]');
await page.waitForFunction(() =>
  document.body.textContent.includes('Smoke question edited?'));
```

(Adjust selectors to the real edit-form markup in app.js — read `renderPacks` first.)

Run: `python3 -m unittest test_server.py` → 32 OK. Run smoke → `SMOKE PASS`.

- [ ] **Step 5: Commit**

```bash
git add app.js tools/smoke.mjs
git commit -m "refactor: treat pack/question ids as opaque strings (UUID-safe)"
```

---

### Task 3: Vendor supabase-js + Supabase store implementation

**Files:**
- Create: `vendor/supabase.js`, `config.web.js`, `store-supabase.js`
- Modify: `index.html` (script tags), `.dockerignore`

**Interfaces:**
- Consumes: the `window.store` contract from Task 1 (exact same method signatures).
- Produces: `store-supabase.js` registering `window.store` when `window.DT_BACKEND === 'supabase'`; `config.web.js` defining `DT_BACKEND`, `SUPABASE_URL`, `SUPABASE_KEY`. Supabase qkeys are `p<packUuid>-<questionUuid>`.

- [ ] **Step 1: Vendor the library**

```bash
curl -sL https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js -o vendor/supabase.js
head -2 vendor/supabase.js   # sanity: UMD banner, not an error page
```

- [ ] **Step 2: Create `config.web.js`**

```js
/* Web (GitHub Pages) config — the deploy workflow ships this as config.js. */
window.DT_BACKEND = 'supabase';
window.SUPABASE_URL = 'https://wajjncluitygfatocbba.supabase.co';
window.SUPABASE_KEY = 'sb_publishable_PK351PhseJSGE7C9WMeF2w_szz10snZ';
```

- [ ] **Step 3: Create `store-supabase.js`**

```js
/* Store implementation backed by Supabase (Postgres + RLS + magic-link auth). */
(function () {
  if (window.DT_BACKEND !== 'supabase') return;

  const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
  let session = null;
  const authCallbacks = [];

  client.auth.getSession().then(({ data }) => {
    session = data.session;
    authCallbacks.forEach(cb => cb());
  });
  client.auth.onAuthStateChange((_event, s) => {
    session = s;
    authCallbacks.forEach(cb => cb());
  });

  const EMPTY_MARKS = () => ({ favorites: [], retired: [] });

  window.store = {
    backend: 'supabase',

    async loadPacks() {
      if (!session) return [];
      const { data, error } = await client
        .from('packs')
        .select('id, name, enabled, questions (id, text, rarity, category, created_at)')
        .order('created_at', { ascending: true });
      if (error) return [];
      return data.map(p => ({
        id: p.id, name: p.name, enabled: p.enabled,
        questions: (p.questions || [])
          .sort((a, b) => a.created_at < b.created_at ? -1 : 1)
          .map(q => ({ id: q.id, text: q.text, rarity: q.rarity, category: q.category })),
      }));
    },
    async createPack(name) {
      const { data, error } = await client.from('packs')
        .insert({ name }).select('id, name, enabled').single();
      return error ? null : { ...data, questions: [] };
    },
    async updatePack(id, fields) {
      const { data, error } = await client.from('packs')
        .update(fields).eq('id', id)
        .select('id, name, enabled, questions (id, text, rarity, category)').single();
      if (error) return null;
      return { id: data.id, name: data.name, enabled: data.enabled,
               questions: data.questions || [] };
    },
    async deletePack(id) {
      const { error } = await client.from('packs').delete().eq('id', id);
      if (error) return false;
      await client.from('marks').delete().like('qkey', `p${id}-%`);
      return true;
    },
    async addQuestion(packId, q) {
      const { data, error } = await client.from('questions')
        .insert({ pack_id: packId, text: q.text, rarity: q.rarity, category: q.category })
        .select('id, text, rarity, category').single();
      return error ? null : data;
    },
    async updateQuestion(packId, qid, fields) {
      const { data, error } = await client.from('questions')
        .update(fields).eq('id', qid).eq('pack_id', packId)
        .select('id, text, rarity, category').single();
      return error ? null : data;
    },
    async deleteQuestion(packId, qid) {
      const { error } = await client.from('questions')
        .delete().eq('id', qid).eq('pack_id', packId);
      if (error) return false;
      await client.from('marks').delete().eq('qkey', `p${packId}-${qid}`);
      return true;
    },
    async loadMarks() {
      if (!session) return EMPTY_MARKS();
      const { data, error } = await client.from('marks').select('list, qkey');
      if (error) return EMPTY_MARKS();
      const marks = EMPTY_MARKS();
      for (const row of data) marks[row.list].push(row.qkey);
      return marks;
    },
    async setMark(list, qkey, on) {
      const op = on
        ? client.from('marks').upsert({ list, qkey })
        : client.from('marks').delete().match({ list, qkey });
      const { error } = await op;
      return error ? null : this.loadMarks();
    },

    signedIn() { return !!session; },
    userEmail() { return session ? session.user.email : null; },
    onAuthChange(cb) { authCallbacks.push(cb); },
    async signIn(email) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      });
      return !error;
    },
    async signOut() { await client.auth.signOut(); },
  };
})();
```

(Note `setMark` returns `this.loadMarks()` — a Promise the interface awaits; callers get the fresh marks dict, matching the server behavior. `user_id` columns fill themselves via `default auth.uid()`.)

- [ ] **Step 4: Update `index.html`** script block:

```html
<script src="config.js" defer></script>
<script src="vendor/supabase.js" defer></script>
<script src="store-server.js" defer></script>
<script src="store-supabase.js" defer></script>
<script src="app.js" defer></script>
```

- [ ] **Step 5: Keep the vendored lib out of the Docker image** — append to `.dockerignore`:

```
vendor/
config.web.js
store-supabase.js
tools/
```

(The Dockerfile COPY list from Task 1 doesn't include them; index.html references `vendor/supabase.js` and `store-supabase.js`, which 404 harmlessly in Docker — `defer` scripts that 404 are skipped. Verify in Step 6 that the game still boots with those 404s.)

- [ ] **Step 6: Verify** — server backend must be unaffected:

Run: `python3 -m unittest test_server.py` → 32 OK.
Run smoke against a clean server → `SMOKE PASS` (page error hook proves the two 404'd scripts don't break boot — test with a server started from a temp dir that has ONLY the Docker-COPY file set, mimicking the image: copy `server.py index.html style.css app.js config.js store-server.js questions.json` to a temp dir, run from there).
Run: `node --check store-supabase.js && node --check config.web.js` → syntax OK.

- [ ] **Step 7: Commit**

```bash
git add vendor/supabase.js config.web.js store-supabase.js index.html .dockerignore
git commit -m "feat: Supabase store implementation with vendored supabase-js"
```

---

### Task 4: Auth UI — sign-in sheet, gating, account row

**Files:**
- Modify: `index.html` (auth overlay markup, account row in pack modal), `app.js` (gating + auth wiring), `style.css` (auth styles)

**Interfaces:**
- Consumes: `window.store.signedIn() / userEmail() / onAuthChange(cb) / signIn(email) / signOut()` from Tasks 1/3.
- Produces: `requireSignIn() → bool` helper in app.js (true = signed in / server backend; false = opened the sign-in sheet instead).

- [ ] **Step 1: Add the auth overlay to `index.html`** (before the `<script>` block, sibling of `#modalOverlay`):

```html
  <!-- Sign-in (web version only) -->
  <div class="modal-overlay" id="authOverlay">
    <div class="modal-sheet auth-sheet">
      <div class="modal-handle" aria-hidden="true"></div>
      <div class="modal-header">
        <h2 class="modal-title">Sign in</h2>
        <button class="modal-close" id="authClose" aria-label="Close">&times;</button>
      </div>
      <p class="auth-note">Enter your email and we'll send you a sign-in link.
        Accounts are invite-only.</p>
      <form id="authForm" autocomplete="email">
        <div class="form-group" style="margin-bottom:0.5rem">
          <input class="form-input" id="authEmail" type="email" placeholder="you@example.com" required>
        </div>
        <button class="btn-add" type="submit">Send magic link</button>
      </form>
      <p class="auth-note hidden" id="authSent">Check your email — the link signs you in here.</p>
    </div>
  </div>
```

And inside the pack modal, directly under `<div class="modal-header">…</div>`, the account row:

```html
      <div class="account-row hidden" id="accountRow">
        <span class="account-email" id="accountEmail"></span>
        <button class="btn btn-ghost btn-small" id="signOutBtn">Sign out</button>
      </div>
```

- [ ] **Step 2: Add styles to `style.css`** (append; reuse existing tokens):

```css
/* ── Auth (web version) ── */
.auth-sheet { max-width: min(90vw, 420px); }
.auth-note { color: var(--text-secondary); font-size: 0.875rem; margin: 0.5rem 0 0.75rem; }
.account-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.5rem; margin-bottom: 0.75rem; font-size: 0.875rem;
  color: var(--text-secondary);
}
.account-email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn-small { padding: 0.25rem 0.75rem; font-size: 0.8125rem; }
```

(Check the real token names in style.css — if `--text-secondary` doesn't exist, use whatever the muted-text token is; read the top of style.css first.)

- [ ] **Step 3: Wire it in `app.js`.** Element refs next to the other `$` refs; then:

```js
  /* ── Auth (no-op for the server backend) ── */
  function requireSignIn() {
    if (window.store.signedIn()) return true;
    $authOverlay.classList.add('open');   /* match how #modalOverlay opens — read openModal() first and mirror it */
    return false;
  }

  function updateAuthUI() {
    const signedIn = window.store.signedIn();
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

Wiring (inside the existing init/listener section):

```js
  window.store.onAuthChange(updateAuthUI);
  $authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await window.store.signIn($authEmail.value.trim());
    $authSent.classList.toggle('hidden', !ok);
    if (!ok) showToast("Couldn't send the link — try again");
  });
  $authClose.addEventListener('click', () => $authOverlay.classList.remove('open'));
  $signOutBtn.addEventListener('click', async () => {
    await window.store.signOut();
  });
```

Gate the three save entry points with `if (!requireSignIn()) return;` as the FIRST line of: the `#favBtn` click handler, the `#retireBtn` click handler (`retireCurrentCard`), and the `#editBtn` (pack manager open) handler. Everything else (drawing, answering, score, theme) stays ungated.

- [ ] **Step 4: Verify server backend unaffected** — `signedIn()` is always true there, so nothing gates. Run: `python3 -m unittest test_server.py` → 32 OK; run smoke → `SMOKE PASS` (smoke hearts a card and opens the pack manager, proving the gates pass through).

- [ ] **Step 5: Verify web backend statically** — serve the repo root with the web config over plain HTTP:

```bash
DIR=$(mktemp -d) && cp -r index.html style.css app.js questions.json vendor store-server.js store-supabase.js "$DIR"/ && cp config.web.js "$DIR"/config.js
(cd "$DIR" && python3 -m http.server 8166 &)
```

Playwright drive (orchestrator does this ad hoc, not a repo script): load `http://127.0.0.1:8166/`, assert deck = 108 signed out, click `#favBtn` after drawing → auth sheet appears; click `#editBtn` → auth sheet appears; no page errors.

- [ ] **Step 6: Commit**

```bash
git add index.html style.css app.js
git commit -m "feat: magic-link sign-in sheet and signed-out gating for the web backend"
```

---

### Task 5: Supabase schema + RLS

**Files:**
- Create: `supabase/schema.sql`

**Interfaces:**
- Consumes: table/column names used by `store-supabase.js` (Task 3): `packs(id,user_id,name,enabled,created_at)`, `questions(id,pack_id,text,rarity,category,created_at)`, `marks(user_id,list,qkey)`.
- Produces: idempotent-ish schema file the owner pastes into the Supabase SQL editor.

- [ ] **Step 1: Write `supabase/schema.sql`**

```sql
-- Drawn Together — schema + row-level security.
-- Paste into the Supabase SQL editor and run once.

create table if not exists public.packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.packs(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 300),
  rarity text not null default 'common' check (rarity in ('common','uncommon','rare','epic','legendary','mythic')),
  category text not null default 'Custom' check (char_length(category) <= 60),
  created_at timestamptz not null default now()
);

create table if not exists public.marks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list text not null check (list in ('favorites','retired')),
  qkey text not null check (char_length(qkey) between 1 and 80),
  primary key (user_id, list, qkey)
);

alter table public.packs enable row level security;
alter table public.questions enable row level security;
alter table public.marks enable row level security;

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
```

- [ ] **Step 2: Verify against the live project.** The owner's project is `https://wajjncluitygfatocbba.supabase.co`. After the schema is applied (owner or orchestrator pastes it), run anonymous-access probes (no login — RLS must hide everything):

```bash
K='sb_publishable_PK351PhseJSGE7C9WMeF2w_szz10snZ'
B='https://wajjncluitygfatocbba.supabase.co/rest/v1'
# read as anon → empty array, not an error leaking rows
curl -s "$B/packs?select=*" -H "apikey: $K" -H "Authorization: Bearer $K"
# expected: []
# write as anon → rejected (401/403, RLS violation)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$B/packs" \
  -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "Content-Type: application/json" -d '{"name":"anon probe"}'
# expected: 401 or 403 (anything but 201)
```

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: Supabase schema with row-level security"
```

---

### Task 6: GitHub Pages deploy workflow + README

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md` (web version section)

**Interfaces:**
- Consumes: `config.web.js` (Task 3) shipped as the site's `config.js`.
- Produces: site at `https://i-press-buttons.github.io/drawn-together/` on every push to main.

- [ ] **Step 1: Write `.github/workflows/pages.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - name: Assemble static site
        run: |
          mkdir _site
          cp index.html style.css app.js store-server.js store-supabase.js questions.json _site/
          cp -r vendor _site/vendor
          cp config.web.js _site/config.js
          touch _site/.nojekyll
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: README** — add after the "Deploy with Docker" section:

```markdown
## Hosted web version (GitHub Pages + Supabase)

The same game deploys as a static site where invited users sign in with an
email magic link and keep their packs and favorites in
[Supabase](https://supabase.com), synced across devices. Anyone can play the
base deck without signing in.

One-time setup:

1. Create a free Supabase project and run `supabase/schema.sql` in its SQL
   editor.
2. In Authentication → Sign In / Up, disable **Allow new users to sign up**
   (accounts become invite-only; invite emails from the Users page).
3. In Authentication → URL Configuration, set the site URL to your Pages URL
   (e.g. `https://<user>.github.io/<repo>/`).
4. Put your project URL and publishable key in `config.web.js`.
5. In the repo settings, enable Pages with source "GitHub Actions".

Every push to `main` redeploys the site via `.github/workflows/pages.yml`.
The publishable key is safe to commit — row-level security is what protects
each user's data.
```

- [ ] **Step 3: Enable Pages + push** (orchestrator, needs gh):

```bash
gh api -X POST repos/I-press-buttons/drawn-together/pages -f build_type=workflow 2>/dev/null \
  || gh api -X PUT repos/I-press-buttons/drawn-together/pages -f build_type=workflow
# publish snapshot per the repo's publishing flow, then:
gh run watch --repo I-press-buttons/drawn-together
```

- [ ] **Step 4: Verify live**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://i-press-buttons.github.io/drawn-together/
# expected: 200
curl -s https://i-press-buttons.github.io/drawn-together/config.js
# expected: the supabase config, NOT "server"
```

Playwright drive against the live URL: deck 108 signed out; `#favBtn` → auth sheet; submit a real email (the owner's) → "Check your email" note appears.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/pages.yml README.md
git commit -m "feat: GitHub Pages deploy workflow and web-version docs"
```

---

### Task 7: End-to-end signed-in verification (owner in the loop)

**Files:** none (verification only)

- [ ] **Step 1:** Owner clicks the magic link from Task 6 Step 4's email on the live site.
- [ ] **Step 2:** Signed in: create a pack, add a question, heart a base question, retire one, reload the page — everything persists. Open the site in a second browser signed out — sees none of it.
- [ ] **Step 3:** Docker regression: rebuild the local image, recreate the container, confirm packs/favorites still work at `http://localhost:8080`.
- [ ] **Step 4:** Merge/publish per superpowers:finishing-a-development-branch.
