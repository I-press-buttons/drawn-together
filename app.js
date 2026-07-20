  /* ── Question Data ── */
  const QUESTIONS = [];

  /* ── Rarity Config ── */
  const RARITY = {
    common:    { label: 'Common',    color: 'var(--common)',    points: 1 },
    uncommon:  { label: 'Uncommon',  color: 'var(--uncommon)',  points: 2 },
    rare:      { label: 'Rare',      color: 'var(--rare)',      points: 3 },
    epic:      { label: 'Epic',      color: 'var(--epic)',      points: 5 },
    legendary: { label: 'Legendary', color: 'var(--legendary)', points: 10 },
    mythic:    { label: 'Mythic',    color: 'var(--mythic)',    points: 20 },
  };

  /* ── Load question data ── */
  async function loadQuestions() {
    try {
      const res = await fetch('questions.json');
      if (res.ok) QUESTIONS.push(...(await res.json()).map(q => ({ ...q, qkey: q.id })));
    } catch (e) { /* fetch failed — deck stays empty, packs may still load */ }
  }

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

  /* ── Game State ── */
  let deck = [];
  let discard = [];
  let skipped = [];
  let currentCard = null;
  let score = 0;
  let scoreEnabled = true;
  let questionsAnswered = 0;
  let rarestAnswered = null;

  /* ── Theme ── */
  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cqg-theme', theme);
    updateThemeLabel();
  }

  function toggleTheme() {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  }

  function updateThemeLabel() {
    const isDark = getTheme() === 'dark';
    $themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  }

  function loadTheme() {
    const saved = localStorage.getItem('cqg-theme');
    if (saved === 'dark' || saved === 'light') {
      setTheme(saved);
    }
    /* default is light (already set on <html>) */
  }

  /* ── Background ── */
  const BACKGROUNDS = {
    classic: null,
    treeline: 'backgrounds/treeline.jpg',
    lakeside: 'backgrounds/lakeside.jpg',
    sunset: 'backgrounds/sunset.jpg',
    alpine: 'backgrounds/alpine.jpg',
  };

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

  /* ── Card resize (manual, drag or keyboard) ── */
  const CARD_SCALE_MIN = 0.7;
  const CARD_SCALE_MAX = 1.6;
  const CARD_SCALE_STEP = 0.05;
  let cardScale = 1;

  function clampCardScale(v) {
    return Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, v));
  }

  function setCardScale(v, announce) {
    cardScale = clampCardScale(v);
    $cardStage.style.setProperty('--card-scale', cardScale);
    scheduleCardFit();
    if (announce) announceStatus(`Card size ${Math.round(cardScale * 100)}%`);
  }

  function persistCardScale() {
    localStorage.setItem('dt_card_scale', String(cardScale));
  }

  function loadCardScale() {
    const saved = parseFloat(localStorage.getItem('dt_card_scale'));
    setCardScale(Number.isNaN(saved) ? 1 : saved, false);
  }

  function initCardResize() {
    let dragging = false;
    let startX = 0;
    let startScale = 1;

    $cardResizeHandle.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
      startScale = cardScale;
      $cardResizeHandle.setPointerCapture(e.pointerId);
    });

    $cardResizeHandle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const deltaX = e.clientX - startX;
      setCardScale(startScale + deltaX / 300, false);
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      persistCardScale();
      announceStatus(`Card size ${Math.round(cardScale * 100)}%`);
    };
    $cardResizeHandle.addEventListener('pointerup', endDrag);
    $cardResizeHandle.addEventListener('pointercancel', endDrag);

    $cardResizeHandle.addEventListener('dblclick', () => {
      setCardScale(1, true);
      persistCardScale();
    });

    $cardResizeHandle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === '+') {
        e.preventDefault();
        setCardScale(cardScale + CARD_SCALE_STEP, true);
        persistCardScale();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === '-') {
        e.preventDefault();
        setCardScale(cardScale - CARD_SCALE_STEP, true);
        persistCardScale();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        setCardScale(1, true);
        persistCardScale();
      }
    });
  }

  /* ── Card fit (auto-shrink to the viewport; derived, never persisted) ── */
  const CARD_FIT_MIN = 0.55;
  const CARD_FIT_BOTTOM_RESERVE = 72;  /* answered pill height + 1rem inset + breathing room */
  const CARD_FIT_TOP_GAP = 16;

  function fitCardToViewport() {
    if ($cardStage.classList.contains('hidden')) return;
    $cardStage.style.setProperty('--card-fit', 1);
    const topBar = document.querySelector('.top-bar');
    const topEdge = topBar ? topBar.getBoundingClientRect().bottom : 0;
    const available = Math.max(
      window.innerHeight - topEdge - CARD_FIT_BOTTOM_RESERVE - CARD_FIT_TOP_GAP, 1);
    let fit = 1;
    /* text rewraps as the card narrows, so height responds nonlinearly — iterate to converge */
    for (let i = 0; i < 3; i++) {
      const height = $activeCard.getBoundingClientRect().height;
      if (height <= available) break;
      fit = Math.max(CARD_FIT_MIN, fit * (available / height));
      $cardStage.style.setProperty('--card-fit', fit);
      if (fit === CARD_FIT_MIN) break;
    }
  }

  let cardFitRaf = 0;
  function scheduleCardFit() {
    if (cardFitRaf) return;
    cardFitRaf = requestAnimationFrame(() => {
      cardFitRaf = 0;
      fitCardToViewport();
    });
  }

  let cardFitResizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(cardFitResizeTimer);
    cardFitResizeTimer = setTimeout(fitCardToViewport, 100);
  });

  /* ── Pile resize (manual, drag or keyboard) ── */
  const PILE_SCALE_MIN = 0.5;
  const PILE_SCALE_MAX = 1.5;
  const PILE_SCALE_STEP = 0.05;
  let pileScale = 1;

  function clampPileScale(v) {
    return Math.min(PILE_SCALE_MAX, Math.max(PILE_SCALE_MIN, v));
  }

  function setPileScale(v, announce) {
    pileScale = clampPileScale(v);
    $pileBtn.style.setProperty('--pile-scale', pileScale);
    if (announce) announceStatus(`Pile size ${Math.round(pileScale * 100)}%`);
  }

  function persistPileScale() {
    localStorage.setItem('dt_pile_scale', String(pileScale));
  }

  function loadPileScale() {
    const saved = parseFloat(localStorage.getItem('dt_pile_scale'));
    setPileScale(Number.isNaN(saved) ? 1 : saved, false);
  }

  function initPileResize() {
    let dragging = false;
    let startX = 0;
    let startScale = 1;

    $pileResizeHandle.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
      startScale = pileScale;
      $pileResizeHandle.setPointerCapture(e.pointerId);
    });

    $pileResizeHandle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const deltaX = e.clientX - startX;
      setPileScale(startScale + deltaX / 300, false);
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      persistPileScale();
      announceStatus(`Pile size ${Math.round(pileScale * 100)}%`);
    };
    $pileResizeHandle.addEventListener('pointerup', endDrag);
    $pileResizeHandle.addEventListener('pointercancel', endDrag);

    $pileResizeHandle.addEventListener('dblclick', () => {
      setPileScale(1, true);
      persistPileScale();
    });

    $pileResizeHandle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === '+') {
        e.preventDefault();
        setPileScale(pileScale + PILE_SCALE_STEP, true);
        persistPileScale();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === '-') {
        e.preventDefault();
        setPileScale(pileScale - PILE_SCALE_STEP, true);
        persistPileScale();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        setPileScale(1, true);
        persistPileScale();
      }
    });
  }

  /* ── Question Packs (server-side) ── */
  let questionPacks = [];
  let packShares = {};   /* { [packId]: code } — web backend, signed in only */

  /* ── User marks (favorites / retired, server-side) ── */
  let marks = { favorites: [], retired: [] };
  let sessionHearts = 0;

  async function loadMarks() {
    marks = await window.store.loadMarks();
  }

  function isFavorite(qkey) { return marks.favorites.includes(qkey); }
  function isRetired(qkey) { return marks.retired.includes(qkey); }

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

  function findQuestionByKey(qkey) {
    const base = QUESTIONS.find(q => q.qkey === qkey);
    if (base) return base;
    for (const fp of FEATURED_PACKS) {
      for (const q of fp.questions) {
        if (`f${fp.key}-${q.id}` === qkey) {
          return { text: q.text, rarity: q.rarity, category: q.category || 'Custom', qkey };
        }
      }
    }
    for (const pack of questionPacks) {
      for (const q of pack.questions) {
        if (`p${pack.id}-${q.id}` === qkey) {
          return { text: q.text, rarity: q.rarity, category: q.category || 'Custom', qkey };
        }
      }
    }
    return null;
  }

  async function loadPacks() {
    questionPacks = await window.store.loadPacks();
    packShares = await window.store.loadShares();
  }

  async function createPack(name) {
    const pack = await window.store.createPack(name);
    if (pack) questionPacks.push(pack);
    return pack;
  }

  async function togglePack(packId, enabled) {
    const updated = await window.store.updatePack(packId, { enabled });
    if (updated) {
      const idx = questionPacks.findIndex(p => String(p.id) === String(packId));
      if (idx !== -1) questionPacks[idx] = updated;
      return true;
    }
    return false;
  }

  async function deletePack(packId) {
    if (await window.store.deletePack(packId)) {
      questionPacks = questionPacks.filter(p => String(p.id) !== String(packId));
      return true;
    }
    return false;
  }

  async function addQuestionToPack(packId, text, rarity, category) {
    const q = await window.store.addQuestion(packId, { text, rarity, category });
    if (q) {
      const pack = questionPacks.find(p => String(p.id) === String(packId));
      if (pack) pack.questions.push(q);
    }
    return q;
  }

  async function updateQuestion(packId, qid, fields) {
    const updated = await window.store.updateQuestion(packId, qid, fields);
    if (updated) {
      const pack = questionPacks.find(p => String(p.id) === String(packId));
      if (pack) {
        const idx = pack.questions.findIndex(q => String(q.id) === String(qid));
        if (idx !== -1) pack.questions[idx] = updated;
      }
    }
    return updated;
  }

  async function deleteQuestionFromPack(packId, qid) {
    if (await window.store.deleteQuestion(packId, qid)) {
      const pack = questionPacks.find(p => String(p.id) === String(packId));
      if (pack) pack.questions = pack.questions.filter(q => String(q.id) !== String(qid));
      return true;
    }
    return false;
  }

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

  /* ── Session (resume) ── */
  function serializeSession() {
    return {
      deckKeys: deck.map(q => q.qkey),
      discardKeys: discard.map(q => q.qkey),
      skippedKeys: skipped.map(q => q.qkey),
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
      skipped: resolve(raw.skippedKeys || []),
      currentCard: raw.currentKey && validKeys.has(raw.currentKey) ? findQuestionByKey(raw.currentKey) : null,
      score: raw.score || 0,
      questionsAnswered: raw.questionsAnswered || 0,
      rarestAnswered: raw.rarestKey && validKeys.has(raw.rarestKey) ? findQuestionByKey(raw.rarestKey) : null,
      sessionHearts: raw.sessionHearts || 0,
    };
  }

  function applyRehydratedSession(state) {
    deck = state.deck;
    discard = state.discard;
    skipped = state.skipped;
    currentCard = state.currentCard;
    score = state.score;
    questionsAnswered = state.questionsAnswered;
    rarestAnswered = state.rarestAnswered;
    sessionHearts = state.sessionHearts;
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
    const hasContent = state.discard.length > 0 || !!state.currentCard || state.score > 0 || state.skipped.length > 0;
    if (!hasContent) { resetGame(); return; }
    showResumePrompt(state);
  }

  function getEnabledPackCount() {
    return questionPacks.filter(p => p.enabled).length;
  }

  /* ── Overlay open/close with focus trap (dialog a11y: WCAG 2.4.3 / 2.1.2) ──
     Shared by all four .modal-overlay dialogs (packs, skipped, auth,
     reset-password). openOverlay remembers the triggering element, moves
     focus into the sheet, and traps Tab; closeOverlay restores focus. */
  const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const overlayFocusReturn = new WeakMap();     /* overlayEl -> element to refocus on close */
  const overlayKeydownHandlers = new WeakMap(); /* overlayEl -> its Tab-trap keydown listener */

  function getFocusableIn(sheet) {
    return [...sheet.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter(el => el.offsetParent !== null || el === sheet);
  }

  function openOverlay(overlayEl) {
    overlayFocusReturn.set(overlayEl, document.activeElement);
    overlayEl.classList.add('open');
    const sheet = overlayEl.querySelector('.modal-sheet');
    const focusable = sheet ? getFocusableIn(sheet) : [];
    const target = focusable[0] || (sheet && sheet.querySelector('.modal-close')) || sheet;
    if (target) target.focus();
    const onKeydown = (e) => {
      if (e.key !== 'Tab' || !sheet) return;
      const items = getFocusableIn(sheet);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    overlayKeydownHandlers.set(overlayEl, onKeydown);
    overlayEl.addEventListener('keydown', onKeydown);
  }

  function closeOverlay(overlayEl) {
    overlayEl.classList.remove('open');
    const handler = overlayKeydownHandlers.get(overlayEl);
    if (handler) {
      overlayEl.removeEventListener('keydown', handler);
      overlayKeydownHandlers.delete(overlayEl);
    }
    const restore = overlayFocusReturn.get(overlayEl);
    overlayFocusReturn.delete(overlayEl);
    if (restore && document.body.contains(restore)) restore.focus();
  }

  /* ── Modal / Pack UI ── */
  let openPackId = null;
  let editingQ = null;   /* "packId::qid" while a question row is in edit mode */
  let deletingPackId = null;   /* pack id with the delete-confirm strip showing */
  let selectedQs = new Set();  /* "packId::qid" keys checked for moving */

  function openModal() {
    renderPacks();
    openOverlay(document.getElementById('modalOverlay'));
  }

  function closeModal() {
    closeOverlay(document.getElementById('modalOverlay'));
    openPackId = null;
    deletingPackId = null;
    selectedQs.clear();
  }

  /* Signed out on the web backend: replace "+ New Pack" with a sign-in prompt.
     Server backend: signedIn() is always true, so the gate never shows. */
  function updatePackGate() {
    const gated = window.store.backend === 'supabase' && !window.store.signedIn();
    $newPackBtn.classList.toggle('hidden', gated);
    $packGate.classList.toggle('hidden', !gated);
    if (gated) $newPackForm.classList.add('hidden');

    /* Sharing/unlock is web-backend-only, signed-in-only. */
    const sharingAllowed = window.store.backend === 'supabase' && window.store.signedIn();
    $unlockPackBtn.classList.toggle('hidden', !sharingAllowed);
    if (!sharingAllowed) $unlockPackForm.classList.add('hidden');
  }

  function renderPackShare(pack) {
    const code = packShares[pack.id];
    if (!code) {
      return `<button class="btn btn-ghost pack-share-btn" type="button" data-share-pack="${pack.id}">Share pack</button>`;
    }
    const grouped = code.match(/.{4}/g).join('-');
    return `
      <div class="pack-share-row">
        <code class="pack-share-code">${escapeHTML(grouped)}</code>
        <button class="btn btn-ghost" type="button" data-copy-code="${pack.id}">Copy</button>
        <button class="btn btn-ghost" type="button" data-revoke-share="${pack.id}">Stop sharing</button>
      </div>
      <p class="pack-share-hint">Anyone with this code can add a copy of this pack to their account.</p>
    `;
  }

  function renderPacks() {
    const container = document.getElementById('packList');
    const totalCustom = questionPacks.reduce((s, p) => s + p.questions.length, 0);
    const sharingAllowed = window.store.backend === 'supabase' && window.store.signedIn();

    /* Base game card (always shown, always on) */
    let html = `
      <div class="pack-card">
        <div class="pack-header">
          <span class="pack-toggle on pack-toggle-locked" title="Always on">
            <span class="pack-toggle-knob"></span>
          </span>
          <span class="pack-name">Base Game</span>
          <span class="pack-base-tag">Built-in</span>
          <span class="pack-count">108</span>
        </div>
      </div>
    `;

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

    /* Custom packs */
    for (const pack of questionPacks) {
      const isOpen = String(openPackId) === String(pack.id);
      const rCount = pack.questions.length;
      const selCount = [...selectedQs].filter(k => k.startsWith(`${pack.id}::`)).length;
      const otherPacks = questionPacks.filter(p => String(p.id) !== String(pack.id));
      html += `
        <div class="pack-card ${pack.enabled ? '' : 'pack-card-off'}">
          <div class="pack-header" data-pack-id="${pack.id}">
            <button class="pack-toggle ${pack.enabled ? 'on' : ''}" data-toggle="${pack.id}" role="switch" aria-checked="${pack.enabled ? 'true' : 'false'}" aria-label="${escapeAttr(pack.name)}: ${pack.enabled ? 'on, tap to disable' : 'off, tap to enable'}">
              <span class="pack-toggle-knob"></span>
            </button>
            <span class="pack-name">${escapeHTML(pack.name)}</span>
            <span class="pack-count">${rCount} ${rCount === 1 ? 'question' : 'questions'}</span>
            <svg class="pack-chevron ${isOpen ? 'open' : ''}" data-chevron="${pack.id}" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 5l4 4 4-4"/></svg>
            ${isOpen ? `<button class="pack-del-btn" data-del-pack="${pack.id}" aria-label="Delete pack: ${escapeAttr(pack.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>` : ''}
          </div>
          <div class="pack-body ${isOpen ? 'open' : ''}">
            ${String(deletingPackId) === String(pack.id) ? `<div class="pack-del-confirm" role="alertdialog" aria-label="Confirm pack deletion">
              <span class="pack-del-confirm-text">Delete &ldquo;${escapeHTML(pack.name)}&rdquo; and its ${rCount} ${rCount === 1 ? 'question' : 'questions'}? This can&rsquo;t be undone.</span>
              <div class="pack-del-confirm-actions">
                <button class="pack-del-confirm-btn" data-confirm-del="${pack.id}">Delete</button>
                <button class="btn-restore" type="button" data-cancel-del>Cancel</button>
              </div>
            </div>` : ''}
            ${selCount > 0 ? `<div class="pack-move-bar">
              <span class="pack-move-count">Move ${selCount}</span>
              ${otherPacks.length > 0 ? `<select class="pack-move-select" data-move-select="${pack.id}" aria-label="Destination pack">
                ${otherPacks.map(p => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('')}
              </select>
              <button class="pack-add-btn" type="button" data-move-btn="${pack.id}">Move</button>`
              : '<span class="pack-move-hint">Create another pack to move questions</span>'}
            </div>` : ''}
            <div class="pack-questions">
              ${rCount === 0 ? '<p class="pack-q-empty">No questions yet</p>' : ''}
              ${pack.questions.map(q => {
                const r = RARITY[q.rarity];
                if (editingQ === `${pack.id}::${q.id}`) {
                  return `<form class="pack-q pack-q-edit" data-edit-pack="${pack.id}" data-edit-qid="${q.id}" autocomplete="off">
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
                  <input type="checkbox" class="pack-q-check" data-check="${pack.id}::${q.id}" ${selectedQs.has(`${pack.id}::${q.id}`) ? 'checked' : ''} aria-label="Select &quot;${escapeAttr(q.text)}&quot; for moving">
                  <span class="pack-q-text" title="${escapeAttr(q.text)}">${escapeHTML(q.text)}</span>
                  <span class="pack-q-rarity" style="color:${r.color}">${r.label}</span>
                  <button class="pack-q-edit-btn" data-edit="${pack.id}::${q.id}" aria-label="Edit question">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  </button>
                  <button class="pack-q-del" data-pack="${pack.id}" data-qid="${q.id}" aria-label="Delete question">&times;</button>
                </div>`;
              }).join('')}
            </div>
            <form class="pack-add-form" data-pack-form="${pack.id}" autocomplete="off">
              <input class="pack-add-input" type="text" placeholder="New question..." maxlength="300" required aria-label="New question">
              <div class="pack-add-meta">
                <select>
                  ${Object.entries(RARITY).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
                </select>
                <select>
                  <option value="General">General</option>
                  <option value="Future Us">Future Us</option>
                  <option value="Custom">Custom</option>
                </select>
              </div>
              <button class="pack-add-btn" type="submit">Add</button>
            </form>
            ${sharingAllowed ? renderPackShare(pack) : ''}
          </div>
        </div>
      `;
    }

    /* Greatest hits (favorites) */
    const favs = marks.favorites.map(findQuestionByKey).filter(Boolean);
    html += `
      <div class="pack-card marks-section">
        <div class="pack-header">
          <span class="marks-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21C7 16.5 3 13.2 3 8.9 3 6.2 5.2 4 7.9 4c1.6 0 3.1.8 4.1 2.1C13 4.8 14.5 4 16.1 4 18.8 4 21 6.2 21 8.9c0 4.3-4 7.6-9 12.1z"/></svg></span>
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
            <span class="marks-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></span>
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

    container.innerHTML = html;
    bindPackEvents();
    updatePackGate();
  }

  function bindPackEvents() {
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

    /* Toggle pack on/off */
    document.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.toggle;
        const pack = questionPacks.find(p => String(p.id) === id);
        if (!pack) return;
        if (await togglePack(id, !pack.enabled)) {
          const updated = questionPacks.find(p => String(p.id) === id);
          if (updated) syncDeckWithPack(updated);
        }
        deletingPackId = null;
        selectedQs.clear();
        renderPacks();
      });
    });

    /* Expand/collapse pack */
    document.querySelectorAll('.pack-header[data-pack-id]').forEach(hdr => {
      hdr.addEventListener('click', (e) => {
        const id = hdr.dataset.packId;
        openPackId = String(openPackId) === id ? null : id;
        deletingPackId = null;
        selectedQs.clear();
        renderPacks();
      });
    });

    /* Add question to pack */
    document.querySelectorAll('[data-pack-form]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const packId = form.dataset.packForm;
        const input = form.querySelector('input');
        const selects = form.querySelectorAll('select');
        const text = input.value.trim();
        if (!text) return;
        const rarity = selects[0].value;
        const category = selects[1].value;
        await addQuestionToPack(packId, text, rarity, category);
        input.value = '';
        deletingPackId = null;
        selectedQs.clear();
        renderPacks();
      });
    });

    /* Delete question from pack */
    document.querySelectorAll('.pack-q-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!btn.dataset.pack) return;   /* greatest-hits rows use data-unfav instead */
        const packId = btn.dataset.pack;
        const qid = btn.dataset.qid;
        await deleteQuestionFromPack(packId, qid);
        await loadMarks();               /* server may have dropped orphaned marks */
        deletingPackId = null;
        selectedQs.clear();
        renderPacks();
      });
    });

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
        selectedQs.clear();
        renderPacks();
      });
    });
    document.querySelectorAll('[data-cancel-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deletingPackId = null;
        selectedQs.clear();
        renderPacks();
      });
    });

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

    /* Un-favorite from greatest hits */
    document.querySelectorAll('[data-unfav]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await setMark('favorites', btn.dataset.unfav, false);
        deletingPackId = null;
        selectedQs.clear();
        renderPacks();
      });
    });

    /* Restore a retired question */
    document.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await setMark('retired', btn.dataset.restore, false);
        deletingPackId = null;
        selectedQs.clear();
        renderPacks();
      });
    });

    /* Play favorites round */
    const playFavs = document.getElementById('playFavsBtn');
    if (playFavs) playFavs.addEventListener('click', startFavoritesRound);

    /* Enter edit mode */
    document.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        editingQ = btn.dataset.edit;
        deletingPackId = null;
        selectedQs.clear();
        renderPacks();
        const form = document.querySelector('.pack-q-edit');
        if (form) form.querySelector('input').focus();
      });
    });

    /* Cancel edit */
    document.querySelectorAll('[data-cancel-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingQ = null;
        deletingPackId = null;
        selectedQs.clear();
        renderPacks();
      });
    });

    /* Share a pack */
    document.querySelectorAll('[data-share-pack]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.sharePack;
        const code = await window.store.sharePack(id);
        if (code) {
          packShares[id] = code;
          renderPacks();
        } else {
          showToast("Couldn't share the pack — try again");
        }
      });
    });

    /* Copy share code */
    document.querySelectorAll('[data-copy-code]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.copyCode;
        const code = packShares[id];
        if (!code) return;
        const grouped = code.match(/.{4}/g).join('-');
        try {
          await navigator.clipboard.writeText(grouped);
          showToast('Code copied');
        } catch {
          showToast(`Code: ${grouped}`);
        }
      });
    });

    /* Stop sharing a pack */
    document.querySelectorAll('[data-revoke-share]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.revokeShare;
        if (await window.store.revokeShare(id)) {
          delete packShares[id];
          renderPacks();
          showToast('Sharing stopped — the code no longer works');
        } else {
          showToast("Couldn't stop sharing — try again");
        }
      });
    });

    /* Save edit */
    document.querySelectorAll('.pack-q-edit').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const packId = form.dataset.editPack;
        const qid = form.dataset.editQid;
        const text = form.querySelector('input').value.trim();
        if (!text) return;
        const selects = form.querySelectorAll('select');
        const updated = await updateQuestion(packId, qid, {
          text, rarity: selects[0].value, category: selects[1].value,
        });
        if (!updated) { showToast("Couldn't save the edit"); return; }
        editingQ = null;
        deletingPackId = null;
        selectedQs.clear();
        renderPacks();
      });
    });
  }

  /* ── DOM ── */
  const $emptyState   = document.getElementById('emptyState');
  const $remainingCount = document.getElementById('remainingCount');
  const $drawBtn      = document.getElementById('drawBtn');
  const $pileBtn      = document.getElementById('pileBtn');
  const $drawControls = document.getElementById('drawControls');
  const $resumePrompt = document.getElementById('resumePrompt');
  const $resumeText   = document.getElementById('resumeText');
  const $resumeBtn    = document.getElementById('resumeBtn');
  const $startFreshBtn = document.getElementById('startFreshBtn');
  const $skippedShuffleBack = document.getElementById('skippedShuffleBack');
  const $skippedShuffleCount = document.getElementById('skippedShuffleCount');
  const $skippedShufflePlural = document.getElementById('skippedShufflePlural');
  const $skippedShuffleBtn = document.getElementById('skippedShuffleBtn');
  const $skippedPill  = document.getElementById('skippedPill');
  const $skippedCount = document.getElementById('skippedCount');
  const $skippedModalOverlay = document.getElementById('skippedModalOverlay');
  const $skippedModalClose = document.getElementById('skippedModalClose');
  const $skippedList  = document.getElementById('skippedList');
  const $skippedShuffleAllBtn = document.getElementById('skippedShuffleAllBtn');
  const $cardStage    = document.getElementById('cardStage');
  const $activeCard   = document.getElementById('activeCard');
  const $rarityDot    = document.getElementById('rarityDot');
  const $rarityLabel  = document.getElementById('rarityLabel');
  const $cardQuestion = document.getElementById('cardQuestion');
  const $cardCategory = document.getElementById('cardCategory');
  const $favBtn       = document.getElementById('favBtn');
  const $retireBtn    = document.getElementById('retireBtn');
  const $answeredBtn  = document.getElementById('answeredBtn');
  const $skipBtn      = document.getElementById('skipBtn');
  const $gameOver     = document.getElementById('gameOver');
  const $finalScores  = document.getElementById('finalScores');
  const $resetBtn     = document.getElementById('resetBtn');
  const $answeredPill = document.getElementById('answeredPill');
  const $answeredPillCount = document.getElementById('answeredPillCount');
  const $answeredModalOverlay = document.getElementById('answeredModalOverlay');
  const $answeredModalClose = document.getElementById('answeredModalClose');
  const $answeredColumns = document.getElementById('answeredColumns');
  const $answeredCount = document.getElementById('answeredCount');
  const $cardResizeHandle = document.getElementById('cardResizeHandle');
  const $pileResizeHandle = document.getElementById('pileResizeHandle');
  const $scoreValue   = document.getElementById('scoreValue');
  const $scoreDisplay = document.getElementById('scoreDisplay');
  const $scoreToggle  = document.getElementById('scoreToggle');
  const $scoreTrack   = document.getElementById('scoreTrack');
  const $themeToggle  = document.getElementById('themeToggle');
  const $editBtn      = document.getElementById('editBtn');
  const $mountains    = document.getElementById('mountainsBg');
  const $photoBg      = document.getElementById('photoBg');
  const $bgBtn        = document.getElementById('bgBtn');
  const $bgModalOverlay = document.getElementById('bgModalOverlay');
  const $bgModalClose = document.getElementById('bgModalClose');
  const $bgOptionList = document.getElementById('bgOptionList');
  const $modalOverlay = document.getElementById('modalOverlay');
  const $modalClose   = document.getElementById('modalClose');
  const $newPackForm = document.getElementById('newPackForm');
  const $newPackName = document.getElementById('newPackName');
  const $newPackBtn  = document.getElementById('newPackBtn');
  const $packGate    = document.getElementById('packGate');
  const $packGateSignInBtn = document.getElementById('packGateSignInBtn');
  const $unlockPackBtn  = document.getElementById('unlockPackBtn');
  const $unlockPackForm = document.getElementById('unlockPackForm');
  const $unlockCodeInput = document.getElementById('unlockCodeInput');
  const $mainArea     = document.getElementById('mainArea');
  const $authOverlay   = document.getElementById('authOverlay');
  const $authClose     = document.getElementById('authClose');
  const $authForm      = document.getElementById('authForm');
  const $authEmail     = document.getElementById('authEmail');
  const $authSent      = document.getElementById('authSent');
  const $authCaptcha   = document.getElementById('authCaptcha');
  const $authCaptchaError = document.getElementById('authCaptchaError');
  const $authTitle     = document.getElementById('authTitle');
  const $authNote      = document.getElementById('authNote');
  const $authPassword  = document.getElementById('authPassword');
  const $authPasswordGroup = document.getElementById('authPasswordGroup');
  const $authConfirmGroup = document.getElementById('authConfirmGroup');
  const $authConfirmPassword = document.getElementById('authConfirmPassword');
  const $authPasswordHint = document.getElementById('authPasswordHint');
  const $authModeToggle = document.getElementById('authModeToggle');
  const $authSubmitBtn = document.getElementById('authSubmitBtn');
  const $authForgotLink = document.getElementById('authForgotLink');
  const $resetPasswordOverlay = document.getElementById('resetPasswordOverlay');
  const $resetPasswordForm = document.getElementById('resetPasswordForm');
  const $resetPasswordInput = document.getElementById('resetPasswordInput');
  const $resetPasswordConfirm = document.getElementById('resetPasswordConfirm');
  const $resetPasswordError = document.getElementById('resetPasswordError');
  const $accountControl = document.getElementById('accountControl');
  const $signInBtn     = document.getElementById('signInBtn');
  const $accountPill   = document.getElementById('accountPill');
  const $accountEmail  = document.getElementById('accountEmail');
  const $signOutBtn    = document.getElementById('signOutBtn');

  /* ── Auth (no-op for the server backend) ── */
  let turnstileWidgetId = null;
  let turnstileToken = null;
  let turnstilePollTimer = null;
  function ensureTurnstileWidget() {
    if (!window.TURNSTILE_SITE_KEY || turnstileWidgetId !== null) return;
    if (window.turnstile) {
      clearInterval(turnstilePollTimer);
      $authCaptchaError.classList.add('hidden');
      turnstileWidgetId = window.turnstile.render($authCaptcha, {
        sitekey: window.TURNSTILE_SITE_KEY,
        callback: (token) => { turnstileToken = token; },
        'expired-callback': () => { turnstileToken = null; },
        'error-callback': () => { turnstileToken = null; },
      });
      return;
    }
    if (window.__turnstileLoadFailed) {
      $authCaptchaError.classList.remove('hidden');
      return;
    }
    if (turnstilePollTimer) return;
    const deadline = Date.now() + 4000;
    turnstilePollTimer = setInterval(() => {
      if (window.turnstile) {
        clearInterval(turnstilePollTimer);
        turnstilePollTimer = null;
        ensureTurnstileWidget();
      } else if (window.__turnstileLoadFailed || Date.now() > deadline) {
        clearInterval(turnstilePollTimer);
        turnstilePollTimer = null;
        $authCaptchaError.classList.remove('hidden');
      }
    }, 250);
  }
  function resetTurnstile() {
    turnstileToken = null;
    if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
  }

  function requireSignIn() {
    if (window.store.signedIn()) return true;
    openOverlay($authOverlay);
    ensureTurnstileWidget();
    return false;
  }

  function syncAccountUI() {
    const email = window.store.userEmail();
    const signedIn = window.store.signedIn();
    if (signedIn) closeOverlay($authOverlay);
    /* local/Docker backend: signedIn() is always true with no email — no real auth, so hide the control entirely */
    const wasFocusInPill = $accountPill.contains(document.activeElement);
    $accountControl.classList.toggle('hidden', signedIn && !email);
    $signInBtn.classList.toggle('hidden', signedIn);
    $accountPill.classList.toggle('hidden', !signedIn);
    if (wasFocusInPill && !signedIn) $signInBtn.focus();
    if (email) $accountEmail.textContent = email;
    else $accountEmail.textContent = '';
  }

  function updateAuthUI() {
    syncAccountUI();
    /* re-pull user data whenever auth flips, then offer to resume that user's session */
    Promise.all([loadPacks(), loadMarks(), loadFeaturedPrefs()]).then(() => {
      renderPacks();
      tryResumeOrStart();
    });
  }

  /* ── Init ── */
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

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

  function resetGame(customDeck) {
    /* Array.isArray guard: resetGame doubles as a click handler, which passes a MouseEvent */
    deck = shuffle(Array.isArray(customDeck) ? customDeck : getAllQuestions());
    discard = [];
    skipped = [];
    currentCard = null;
    score = 0;
    questionsAnswered = 0;
    rarestAnswered = null;
    sessionHearts = 0;
    updateUI();
    showEmptyState();
    hideResumePrompt();
    $gameOver.classList.add('hidden');
    renderAnsweredList();
    $drawBtn.focus();
    saveCurrentSession();
  }

  function startFavoritesRound() {
    const favs = marks.favorites.map(findQuestionByKey)
      .filter(q => q && !isRetired(q.qkey));
    if (favs.length === 0) return;
    closeModal();
    resetGame(favs);
    showToast(`Favorites round — ${favs.length} greatest hit${favs.length === 1 ? '' : 's'}`);
  }

  function showEmptyState() {
    $cardStage.classList.add('hidden');
    $emptyState.classList.remove('hidden');
    $remainingCount.textContent = deck.length;

    /* deck's empty but there are skipped cards waiting — offer to shuffle them
       back in instead of the (useless) Draw button */
    const showShuffleBack = deck.length === 0 && skipped.length > 0;
    $drawControls.classList.toggle('hidden', showShuffleBack);
    $skippedShuffleBack.classList.toggle('hidden', !showShuffleBack);
    if (showShuffleBack) {
      $skippedShuffleCount.textContent = skipped.length;
      $skippedShufflePlural.textContent = skipped.length === 1 ? '' : 's';
    }
  }

  /* Return the active card to the deck at a random index, clearing currentCard.
     Used whenever a different card needs to take over as the active one. */
  function stashCurrentCard() {
    if (!currentCard) return;
    deck.splice(Math.floor(Math.random() * (deck.length + 1)), 0, currentCard);
    currentCard = null;
  }

  /* Merge the skipped pile back into the deck and reshuffle. Shared by the
     empty-state prompt and the skipped modal's "shuffle all back" button. */
  function reshuffleSkipped() {
    if (skipped.length === 0) return;
    deck = shuffle([...deck, ...skipped]);
    skipped = [];
    updateUI();
    if (!currentCard) showEmptyState();
    saveCurrentSession();
  }

  function showCard() {
    $emptyState.classList.add('hidden');
    $gameOver.classList.add('hidden');
    $cardStage.classList.remove('hidden');
    fitCardToViewport();
  }

  function drawCard() {
    if (deck.length === 0) return;
    currentCard = deck.pop();
    renderCard();
    showCard();
    updateUI();
    saveCurrentSession();
  }

  function renderCard() {
    if (!currentCard) return;
    const r = RARITY[currentCard.rarity];
    $activeCard.setAttribute('data-rarity', currentCard.rarity);
    $rarityDot.style.backgroundColor = r.color;
    $rarityLabel.textContent = r.label;
    $rarityLabel.style.color = r.color;
    $cardQuestion.textContent = currentCard.text;
    $cardCategory.textContent = currentCard.category;

    /* animate in */
    $cardStage.classList.remove('animate-out');
    $cardStage.classList.add('animate-in');
    void $cardStage.offsetWidth;
    $cardStage.classList.remove('animate-in');
    void $cardStage.offsetWidth;
    $cardStage.classList.add('animate-in');

    $favBtn.classList.toggle('active', isFavorite(currentCard.qkey));
    $favBtn.setAttribute('aria-pressed', isFavorite(currentCard.qkey) ? 'true' : 'false');
  }

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

    /* a finished deck with nothing skipped has nothing left to resume;
       otherwise persist progress (skipped cards can still be shuffled back in) */
    if (deck.length === 0 && skipped.length === 0) {
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
      if (deck.length === 0 && skipped.length === 0) {
        showGameOver();
      } else {
        showEmptyState();
        if (deck.length === 0) {
          $skippedShuffleBtn.focus();
        } else {
          $drawBtn.focus();
        }
      }
    }, 300);
  }

  function skipCard() {
    if (!currentCard) return;
    /* Move to the skipped pile instead of straight back into the deck */
    skipped.unshift(currentCard);
    currentCard = null;
    saveCurrentSession();

    $cardStage.classList.remove('animate-in');
    $cardStage.classList.add('animate-out');

    setTimeout(() => {
      updateUI();
      showEmptyState();
      if (deck.length === 0 && skipped.length > 0) {
        $skippedShuffleBtn.focus();
      } else {
        $drawBtn.focus();
      }
    }, 300);
  }

  function showGameOver() {
    $cardStage.classList.add('hidden');
    $emptyState.classList.add('hidden');
    $gameOver.classList.remove('hidden');

    if (scoreEnabled && score > 0) {
      $finalScores.innerHTML = `
        <div class="final-score">
          <div class="final-score-value" style="color: var(--primary)">${score}</div>
          <div class="final-score-label">Total Score</div>
        </div>
        <div class="final-score">
          <div class="final-score-value">${questionsAnswered}</div>
          <div class="final-score-label">Questions</div>
        </div>
      `;
    } else {
      $finalScores.innerHTML = `
        <div class="final-score">
          <div class="final-score-value">${questionsAnswered}</div>
          <div class="final-score-label">Questions Answered</div>
        </div>
      `;
    }

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
  }

  function showScorePop(pts) {
    const el = document.createElement('div');
    el.className = 'score-pop';
    el.textContent = `+${pts}`;
    el.style.left = '50%';
    el.style.top = '45%';
    el.style.transform = 'translate(-50%, -50%)';
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  function renderAnsweredList() {
    if (discard.length === 0) {
      $answeredColumns.innerHTML = '<p class="answered-empty">No questions answered yet</p>';
    } else {
      const newestFirst = [...discard].reverse();
      const byRarity = {};
      for (const q of newestFirst) {
        (byRarity[q.rarity] || (byRarity[q.rarity] = [])).push(q);
      }
      $answeredColumns.innerHTML = Object.entries(RARITY).map(([key, r]) => {
        const items = byRarity[key];
        if (!items || items.length === 0) return '';
        const itemsHTML = items.map((q) => `
          <button class="answered-item" type="button" data-qkey="${escapeAttr(q.qkey)}">
            <span class="answered-item-dot" style="background: ${r.color}"></span>
            <span class="answered-item-text" title="${escapeHTML(q.text)}">${escapeHTML(q.text)}</span>
            ${scoreEnabled ? `<span class="answered-item-score" style="color: ${r.color}">+${r.points}</span>` : ''}
          </button>
        `).join('');
        return `
          <div class="answered-col">
            <div class="answered-col-header" style="color:${r.color}">${r.label} <span class="answered-col-count">${items.length}</span></div>
            ${itemsHTML}
          </div>
        `;
      }).join('');
    }
    $answeredCount.textContent = discard.length;
    $answeredPillCount.textContent = discard.length;
  }

  /* ── Skipped Modal ── */
  function renderSkippedList() {
    if (skipped.length === 0) {
      $skippedList.innerHTML = '<p class="answered-empty">No skipped questions</p>';
      return;
    }
    $skippedList.innerHTML = skipped.map((q) => {
      const r = RARITY[q.rarity];
      return `
        <button class="skipped-item" type="button" data-qkey="${escapeAttr(q.qkey)}">
          <span class="answered-item-dot" style="background: ${r.color}"></span>
          <span class="answered-item-text" title="${escapeHTML(q.text)}">${escapeHTML(q.text)}</span>
        </button>
      `;
    }).join('');
  }

  function openSkippedModal() {
    renderSkippedList();
    openOverlay($skippedModalOverlay);
  }

  function closeSkippedModal() {
    closeOverlay($skippedModalOverlay);
  }

  function openAnsweredModal() {
    renderAnsweredList();
    openOverlay($answeredModalOverlay);
  }

  function closeAnsweredModal() {
    closeOverlay($answeredModalOverlay);
  }

  function openBgModal() {
    openOverlay($bgModalOverlay);
    const selected = $bgOptionList.querySelector('.bg-option[aria-checked="true"]')
      || $bgOptionList.querySelector('.bg-option');
    if (selected) selected.focus();
  }

  function closeBgModal() {
    closeOverlay($bgModalOverlay);
  }

  /* Bring a skipped card back as the active card, bumping whatever's currently
     active back into the deck first. */
  function restoreSkippedCard(qkey) {
    const idx = skipped.findIndex(q => q.qkey === qkey);
    if (idx === -1) return;
    const [card] = skipped.splice(idx, 1);
    stashCurrentCard();
    currentCard = card;
    renderCard();
    showCard();
    $gameOver.classList.add('hidden');
    closeSkippedModal();
    updateUI();
    saveCurrentSession();
  }

  /* Bring an answered card back as the active card: pull it out of the discard
     pile, reverse its score credit, and let it be answered/skipped again. */
  function unanswerCard(qkey) {
    const idx = discard.findIndex(q => q.qkey === qkey);
    if (idx === -1) return;
    const [card] = discard.splice(idx, 1);

    if (scoreEnabled) {
      score = Math.max(0, score - RARITY[card.rarity].points);
    }
    questionsAnswered = Math.max(0, questionsAnswered - 1);

    rarestAnswered = discard.reduce((rarest, q) => {
      if (!rarest || RARITY[q.rarity].points > RARITY[rarest.rarity].points) return q;
      return rarest;
    }, null);

    stashCurrentCard();
    currentCard = card;
    renderCard();
    showCard();
    closeAnsweredModal();
    updateUI();
    renderAnsweredList();
    saveCurrentSession();
  }

  function updateUI() {
    $remainingCount.textContent = deck.length;
    $answeredCount.textContent = discard.length;
    $answeredPillCount.textContent = discard.length;
    $answeredPill.classList.toggle('hidden', discard.length === 0);
    $skippedCount.textContent = skipped.length;
    $skippedPill.classList.toggle('hidden', skipped.length === 0);

    /* score display */
    if (scoreEnabled) {
      $scoreValue.textContent = score;
      $scoreDisplay.style.display = '';
    } else {
      $scoreDisplay.style.display = 'none';
    }
  }

  function toggleScore(enabled) {
    scoreEnabled = enabled;
    if (enabled) {
      $scoreTrack.classList.add('active');
    } else {
      $scoreTrack.classList.remove('active');
    }
    updateUI();
    renderAnsweredList();
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHTML(str).replace(/"/g, '&quot;');
  }

  /* Permanent aria-live region announces toast text reliably — a toast that's
     removed and re-added (or repeats the same message) doesn't always get
     picked up by assistive tech, so the visual toast itself no longer carries
     its own aria-live/role. */
  function announceStatus(msg) {
    const el = document.getElementById('srStatus');
    if (!el) return;
    el.textContent = '';
    /* clear-then-set on the next tick so repeated messages still announce */
    setTimeout(() => { el.textContent = msg; }, 50);
  }

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
    announceStatus(msg);
  }

  /* ── Event Listeners ── */
  $drawBtn.addEventListener('click', drawCard);
  $pileBtn.addEventListener('click', drawCard);
  $answeredBtn.addEventListener('click', answerCard);
  $skipBtn.addEventListener('click', skipCard);
  $resetBtn.addEventListener('click', resetGame);
  $themeToggle.addEventListener('click', toggleTheme);

  $favBtn.addEventListener('click', async () => {
    if (!requireSignIn()) return;
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
    if (!requireSignIn()) return;
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

  $scoreToggle.addEventListener('change', () => {
    toggleScore($scoreToggle.checked);
  });

  $answeredColumns.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-qkey]');
    if (!btn) return;
    unanswerCard(btn.dataset.qkey);
  });

  /* ── Modal Event Listeners ── */
  $editBtn.addEventListener('click', openModal);
  $modalClose.addEventListener('click', closeModal);
  $modalOverlay.addEventListener('click', (e) => {
    if (e.target === $modalOverlay) closeModal();
  });

  /* ── Skipped Pile Event Listeners ── */
  $skippedShuffleBtn.addEventListener('click', () => {
    reshuffleSkipped();
    $drawBtn.focus();
  });
  $skippedPill.addEventListener('click', openSkippedModal);
  $skippedModalClose.addEventListener('click', closeSkippedModal);
  $skippedModalOverlay.addEventListener('click', (e) => {
    if (e.target === $skippedModalOverlay) closeSkippedModal();
  });

  /* ── Answered Pile Event Listeners ── */
  $answeredPill.addEventListener('click', openAnsweredModal);
  $answeredModalClose.addEventListener('click', closeAnsweredModal);
  $answeredModalOverlay.addEventListener('click', (e) => {
    if (e.target === $answeredModalOverlay) closeAnsweredModal();
  });

  $bgBtn.addEventListener('click', openBgModal);
  $bgModalClose.addEventListener('click', closeBgModal);
  $bgModalOverlay.addEventListener('click', (e) => {
    if (e.target === $bgModalOverlay) closeBgModal();
  });
  $bgOptionList.addEventListener('click', (e) => {
    const opt = e.target.closest('.bg-option');
    if (!opt) return;
    setBackground(opt.dataset.bg);
  });
  $bgOptionList.addEventListener('keydown', (e) => {
    const options = Array.from($bgOptionList.querySelectorAll('.bg-option'));
    const current = options.indexOf(document.activeElement);
    if (current === -1) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = (current + 1) % options.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = (current - 1 + options.length) % options.length;
    } else if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = options.length - 1;
    }
    if (next !== -1) {
      e.preventDefault();
      setBackground(options[next].dataset.bg);
      options[next].focus();
    }
  });
  $skippedList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-qkey]');
    if (!btn) return;
    restoreSkippedCard(btn.dataset.qkey);
  });
  $skippedShuffleAllBtn.addEventListener('click', () => {
    reshuffleSkipped();
    closeSkippedModal();
  });

  /* ── Auth Event Listeners ── */
  let authMode = 'signin'; // 'signin' | 'signup' | 'forgot'
  const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
  const PASSWORD_RULE_MSG = 'Password must be at least 8 characters and include a letter and a number';
  function setAuthMode(mode) {
    authMode = mode;
    const isSignUp = mode === 'signup';
    const isForgot = mode === 'forgot';
    $authTitle.textContent = isForgot ? 'Reset password' : isSignUp ? 'Sign up' : 'Sign in';
    $authNote.textContent = isForgot
      ? "Enter your email and we'll send you a password reset link."
      : isSignUp
      ? 'Create an account to save your progress. Or close this to play without saving.'
      : 'Sign in to save your progress. Or close this to play without saving.';
    $authPasswordGroup.classList.toggle('hidden', isForgot);
    $authPassword.required = !isForgot;
    $authConfirmGroup.classList.toggle('hidden', !isSignUp);
    $authConfirmPassword.required = isSignUp;
    $authPasswordHint.classList.toggle('hidden', !isSignUp);
    $authSubmitBtn.textContent = isForgot ? 'Send reset link' : isSignUp ? 'Sign up' : 'Sign in';
    $authModeToggle.classList.toggle('hidden', isForgot);
    $authModeToggle.textContent = isSignUp ? 'Have an account? Sign in' : 'Need an account? Sign up';
    $authForgotLink.textContent = isForgot ? 'Back to sign in' : 'Forgot password?';
    $authSent.classList.add('hidden');
  }
  window.store.onAuthChange(updateAuthUI);
  window.store.onAuthChange((event) => {
    if (event === 'SIGNED_IN') syncBackgroundFromAccount();
    if (event === 'PASSWORD_RECOVERY') {
      closeOverlay($authOverlay);
      openOverlay($resetPasswordOverlay);
    }
  });
  $signInBtn.addEventListener('click', () => { setAuthMode('signin'); openOverlay($authOverlay); ensureTurnstileWidget(); });
  $packGateSignInBtn.addEventListener('click', () => { setAuthMode('signin'); openOverlay($authOverlay); ensureTurnstileWidget(); });
  $authModeToggle.addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
  });
  $authForgotLink.addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode(authMode === 'forgot' ? 'signin' : 'forgot');
  });
  $authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (window.TURNSTILE_SITE_KEY && !turnstileToken) {
      showToast("Please complete the verification and try again");
      return;
    }
    const email = $authEmail.value.trim();
    if (authMode === 'forgot') {
      const err = await window.store.requestPasswordReset(email, turnstileToken);
      resetTurnstile();
      if (err) { showToast(err); return; }
      $authSent.classList.remove('hidden');
      return;
    }
    const password = $authPassword.value;
    if (authMode === 'signup') {
      if (!PASSWORD_RULE.test(password)) { showToast(PASSWORD_RULE_MSG); return; }
      if (password !== $authConfirmPassword.value) { showToast("Passwords don't match"); return; }
    }
    const err = authMode === 'signup'
      ? await window.store.signUp(email, password, turnstileToken)
      : await window.store.signIn(email, password, turnstileToken);
    resetTurnstile();
    if (err) { showToast(err); return; }
    closeOverlay($authOverlay);
  });
  $authClose.addEventListener('click', () => closeOverlay($authOverlay));
  $authOverlay.addEventListener('click', (e) => {
    if (e.target === $authOverlay) closeOverlay($authOverlay);
  });
  $resetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!PASSWORD_RULE.test($resetPasswordInput.value)) {
      $resetPasswordError.textContent = PASSWORD_RULE_MSG;
      $resetPasswordError.classList.remove('hidden');
      return;
    }
    if ($resetPasswordInput.value !== $resetPasswordConfirm.value) {
      $resetPasswordError.textContent = "Passwords don't match";
      $resetPasswordError.classList.remove('hidden');
      return;
    }
    const err = await window.store.updatePassword($resetPasswordInput.value);
    if (err) {
      $resetPasswordError.textContent = err;
      $resetPasswordError.classList.remove('hidden');
      return;
    }
    closeOverlay($resetPasswordOverlay);
    showToast('Password updated');
  });
  $signOutBtn.addEventListener('click', async () => {
    await window.store.signOut();
  });

  /* New pack form toggle */
  $newPackBtn.addEventListener('click', () => {
    $newPackForm.classList.toggle('hidden');
    if (!$newPackForm.classList.contains('hidden')) $newPackName.focus();
  });

  $newPackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $newPackName.value.trim();
    if (!name) return;
    const pack = await createPack(name);
    $newPackName.value = '';
    $newPackForm.classList.add('hidden');
    if (pack) {
      openPackId = pack.id;
      deletingPackId = null;
      selectedQs.clear();
      renderPacks();
      showToast(`"${pack.name}" pack created`);
    }
  });

  /* Unlock a shared pack form toggle */
  $unlockPackBtn.addEventListener('click', () => {
    $unlockPackForm.classList.toggle('hidden');
    if (!$unlockPackForm.classList.contains('hidden')) $unlockCodeInput.focus();
  });

  $unlockPackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await window.store.unlockPack($unlockCodeInput.value);
    if (res && res.pack) {
      questionPacks.push(res.pack);
      openPackId = res.pack.id;
      $unlockCodeInput.value = '';
      $unlockPackForm.classList.add('hidden');
      deletingPackId = null;
      selectedQs.clear();
      renderPacks();
      showToast(`"${res.pack.name}" unlocked`);
    } else {
      showToast((res && res.error) || "Couldn't unlock that pack");
    }
  });

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
    a.download = 'drawn-together-packs.json';
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
      if (!pack) {
        showToast(`Import stopped: couldn't create "${p.name}"`);
        deletingPackId = null; selectedQs.clear();
        renderPacks();
        return;
      }
      for (const q of p.questions) {
        const added = await addQuestionToPack(
          pack.id, q.text, RARITY[q.rarity] ? q.rarity : 'common', q.category || 'Custom');
        if (!added) {
          showToast('Import stopped: a question was rejected');
          deletingPackId = null; selectedQs.clear();
          renderPacks();
          return;
        }
      }
    }
    deletingPackId = null; selectedQs.clear();
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

  /* Keyboard shortcut: Escape closes modal */
  document.addEventListener('keydown', (e) => {
    /* An Escape that dismisses an overlay is consumed here — it must not
       also reach the game-shortcut listener below and skip the active card */
    if (e.key === 'Escape' && document.querySelector('.modal-overlay.open')) {
      e.stopImmediatePropagation();
    }
    if (e.key === 'Escape' && $modalOverlay.classList.contains('open')) {
      closeModal();
    }
    if (e.key === 'Escape' && $authOverlay.classList.contains('open')) {
      closeOverlay($authOverlay);
    }
    if (e.key === 'Escape' && $skippedModalOverlay.classList.contains('open')) {
      closeSkippedModal();
    }
    if (e.key === 'Escape' && $answeredModalOverlay.classList.contains('open')) {
      closeAnsweredModal();
    }
    if (e.key === 'Escape' && $bgModalOverlay.classList.contains('open')) {
      closeBgModal();
    }
  });

  function updateDeckCount() {
    const total = getAllQuestions().length;
    document.getElementById('remainingCount').textContent = total;
  }

  /* Keyboard shortcuts */
  document.addEventListener('keydown', (e) => {
    /* Never hijack keys while the user is typing in a form field */
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
    /* Nor while a modal is open — Escape/arrows there must not skip or answer
       the card sitting underneath it */
    if (document.querySelector('.modal-overlay.open')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (document.activeElement === $drawBtn) {
        e.preventDefault();
        drawCard();
      } else if (document.activeElement === $answeredBtn) {
        e.preventDefault();
        answerCard();
      } else if (document.activeElement === $skipBtn) {
        e.preventDefault();
        skipCard();
      } else if (document.activeElement === $resetBtn) {
        e.preventDefault();
        resetGame();
      } else if (!$cardStage.classList.contains('hidden') && !$gameOver.classList.contains('hidden')) {
        /* game over — focus reset */
      } else if (!$cardStage.classList.contains('hidden')) {
        e.preventDefault();
        answerCard();
      } else if (!$emptyState.classList.contains('hidden')) {
        e.preventDefault();
        drawCard();
      }
    }
    if (e.key === 'Escape' && !$cardStage.classList.contains('hidden') && currentCard) {
      e.preventDefault();
      skipCard();
    }
    if (e.key === 'ArrowLeft' && !$cardStage.classList.contains('hidden')) {
      e.preventDefault();
      skipCard();
    }
    if (e.key === 'ArrowRight' && !$cardStage.classList.contains('hidden')) {
      e.preventDefault();
      answerCard();
    }
  });

  /* ── Boot ── */
  loadTheme();
  loadBackground();
  loadCardScale();
  initCardResize();
  loadPileScale();
  initPileResize();
  (async () => {
    await Promise.all([loadQuestions(), loadFeaturedPacks()]);
    await window.store.ready();
    /* Sign-in is the first thing a signed-out web user sees (dismissible — anonymous play still works) */
    if (window.store.backend === 'supabase' && !window.store.signedIn()) {
      openOverlay($authOverlay);
      ensureTurnstileWidget();
    }
    /* onAuthChange(updateAuthUI) can register too late to catch the initial
       SIGNED_IN/INITIAL_SESSION broadcast (deferred scripts run in order, each
       draining its own microtasks before the next starts) — sync the account
       control's visible state directly here so an already-signed-in reload
       doesn't leave it stuck in its default hidden markup. */
    syncAccountUI();
    syncBackgroundFromAccount();
    await Promise.all([loadPacks(), loadMarks(), loadFeaturedPrefs()]);
    await tryResumeOrStart();
    toggleScore(true);
    updateDeckCount();
  })();
