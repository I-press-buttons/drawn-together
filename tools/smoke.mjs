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
if (count !== '150') fail(`deck count ${count} != 150`);

// 1b. Account control hidden on server backend (no real auth)
const hidden = await page.evaluate(() =>
  document.getElementById('accountControl').classList.contains('hidden'));
if (!hidden) fail('accountControl should be hidden on server backend');

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

// 5. Round setup: filters narrow the deck the next round deals
await page.click('#modalClose');
await page.click('#roundSetupBtn');
await page.waitForSelector('#roundSetupOverlay.open');
await page.click('#roundRarityChips [data-rarity="epic"]');
await page.click('#roundLengthChips [data-length="10"]');
if ((await page.textContent('#roundSetupCount')) !== '10 cards in this round') {
  fail('round setup count did not follow the filters');
}
await page.click('#roundSetupStartBtn');
await page.waitForSelector('#roundSetupOverlay.open', { state: 'hidden' });
await page.waitForFunction(() =>
  document.querySelector('#remainingCount').textContent === '10');
if (await page.isHidden('#roundFilterSummary')) fail('round filter summary not shown');
await page.click('#drawBtn');
await page.waitForSelector('#cardStage:not(.hidden)');
const rarity = (await page.textContent('#rarityLabel')).trim();
if (!['Epic', 'Legendary', 'Mythic'].includes(rarity)) {
  fail(`drew a ${rarity} card under an Epic+ floor`);
}

// 5b. An impossible combination blocks the start rather than dealing nothing
await page.click('#answeredBtn');        // setup lives on the empty state, between cards
await page.waitForSelector('#emptyState:not(.hidden)');
await page.click('#roundSetupBtn');
await page.waitForSelector('#roundSetupOverlay.open');
await page.click('#roundLengthChips [data-length="0"]');
await page.click('#roundCategoryChips [data-category="Faith"]');
await page.click('#roundCategoryChips [data-category="General"]');
await page.click('#roundRarityChips [data-rarity="mythic"]');       // Future Us has no mythics
if (!(await page.isDisabled('#roundSetupStartBtn'))) fail('start enabled with an empty deck');

// 5c. Chips are rebuilt on every change — keyboard focus must survive it
await page.focus('#roundRarityChips [data-rarity="rare"]');
await page.keyboard.press('Enter');
const focused = await page.evaluate(() => document.activeElement.dataset.rarity);
if (focused !== 'rare') fail(`chip lost focus on toggle (activeElement: ${focused})`);

await browser.close();
console.log('SMOKE PASS');
