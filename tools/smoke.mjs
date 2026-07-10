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

// 3b. Edit the question inline
await page.click('.pack-q-edit-btn');
await page.waitForSelector('.pack-q-edit');
await page.fill('.pack-q-edit input[type=text]', 'Smoke question edited?');
await page.click('.pack-q-edit button[type=submit]');
await page.waitForFunction(() =>
  document.body.textContent.includes('Smoke question edited?'));

// 4. Marks survived server round-trip
const marks = await page.evaluate(() => window.store.loadMarks());
if (marks.favorites.length !== 1) fail('favorite not persisted');

await browser.close();
console.log('SMOKE PASS');
