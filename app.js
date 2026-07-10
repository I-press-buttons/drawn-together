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

  /* ── Game State ── */
  let deck = [];
  let discard = [];
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

  /* ── Question Packs (server-side) ── */
  const API_BASE = '/api/packs';
  let questionPacks = [];

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

  async function loadPacks() {
    try {
      const res = await fetch(API_BASE);
      if (res.ok) questionPacks = await res.json();
    } catch (e) { questionPacks = []; }
  }

  async function createPack(name) {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const pack = await res.json();
      questionPacks.push(pack);
      return pack;
    }
    return null;
  }

  async function togglePack(packId, enabled) {
    const res = await fetch(`${API_BASE}/${packId}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) {
      const updated = await res.json();
      const idx = questionPacks.findIndex(p => p.id === packId);
      if (idx !== -1) questionPacks[idx] = updated;
      return true;
    }
    return false;
  }

  async function deletePack(packId) {
    const res = await fetch(`${API_BASE}/${packId}`, { method: 'DELETE' });
    if (res.ok) {
      questionPacks = questionPacks.filter(p => p.id !== packId);
      return true;
    }
    return false;
  }

  async function addQuestionToPack(packId, text, rarity, category) {
    const res = await fetch(`${API_BASE}/${packId}/questions`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ text, rarity, category }),
    });
    if (res.ok) {
      const q = await res.json();
      const pack = questionPacks.find(p => p.id === packId);
      if (pack) pack.questions.push(q);
      return q;
    }
    return null;
  }

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

  async function deleteQuestionFromPack(packId, qid) {
    const res = await fetch(`${API_BASE}/${packId}/questions/${qid}`, { method: 'DELETE' });
    if (res.ok) {
      const pack = questionPacks.find(p => p.id === packId);
      if (pack) pack.questions = pack.questions.filter(q => q.id !== qid);
      return true;
    }
    return false;
  }

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

  function getEnabledPackCount() {
    return questionPacks.filter(p => p.enabled).length;
  }

  /* ── Modal / Pack UI ── */
  let openPackId = null;
  let editingQ = null;   /* "packId-qid" while a question row is in edit mode */

  function openModal() {
    renderPacks();
    document.getElementById('modalOverlay').classList.add('open');
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
    openPackId = null;
  }

  function renderPacks() {
    const container = document.getElementById('packList');
    const totalCustom = questionPacks.reduce((s, p) => s + p.questions.length, 0);

    /* Base game card (always shown, always on) */
    let html = `
      <div class="pack-card">
        <div class="pack-header">
          <span class="pack-toggle on" style="cursor:default;opacity:0.6">
            <span class="pack-toggle-knob" style="background:var(--primary)"></span>
          </span>
          <span class="pack-name">Base Game</span>
          <span class="pack-base-tag">Built-in</span>
          <span class="pack-count">108</span>
        </div>
      </div>
    `;

    /* Custom packs */
    for (const pack of questionPacks) {
      const isOpen = openPackId === pack.id;
      const rCount = pack.questions.length;
      html += `
        <div class="pack-card">
          <div class="pack-header" data-pack-id="${pack.id}">
            <button class="pack-toggle ${pack.enabled ? 'on' : ''}" data-toggle="${pack.id}" aria-label="${pack.enabled ? 'Disable' : 'Enable'} pack"></button>
            <span class="pack-name">${escapeHTML(pack.name)}</span>
            <span class="pack-count">${rCount} ${rCount === 1 ? 'question' : 'questions'}</span>
            <svg class="pack-chevron ${isOpen ? 'open' : ''}" data-chevron="${pack.id}" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 5l4 4 4-4"/></svg>
          </div>
          <div class="pack-body ${isOpen ? 'open' : ''}">
            <div class="pack-questions">
              ${rCount === 0 ? '<p class="pack-q-empty">No questions yet</p>' : ''}
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
            </div>
            <form class="pack-add-form" data-pack-form="${pack.id}" autocomplete="off">
              <input class="pack-add-input" type="text" placeholder="New question..." maxlength="300" required>
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
          </div>
        </div>
      `;
    }

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

    container.innerHTML = html;
    bindPackEvents();
  }

  function bindPackEvents() {
    /* Toggle pack on/off */
    document.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.toggle);
        const pack = questionPacks.find(p => p.id === id);
        if (!pack) return;
        await togglePack(id, !pack.enabled);
        renderPacks();
      });
    });

    /* Expand/collapse pack */
    document.querySelectorAll('.pack-header[data-pack-id]').forEach(hdr => {
      hdr.addEventListener('click', (e) => {
        const id = parseInt(hdr.dataset.packId);
        openPackId = openPackId === id ? null : id;
        renderPacks();
      });
    });

    /* Add question to pack */
    document.querySelectorAll('[data-pack-form]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const packId = parseInt(form.dataset.packForm);
        const input = form.querySelector('input');
        const selects = form.querySelectorAll('select');
        const text = input.value.trim();
        if (!text) return;
        const rarity = selects[0].value;
        const category = selects[1].value;
        await addQuestionToPack(packId, text, rarity, category);
        input.value = '';
        renderPacks();
      });
    });

    /* Delete question from pack */
    document.querySelectorAll('.pack-q-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!btn.dataset.pack) return;   /* greatest-hits rows use data-unfav instead */
        const packId = parseInt(btn.dataset.pack);
        const qid = parseInt(btn.dataset.qid);
        await deleteQuestionFromPack(packId, qid);
        await loadMarks();               /* server may have dropped orphaned marks */
        renderPacks();
      });
    });

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
  }

  /* ── DOM ── */
  const $emptyState   = document.getElementById('emptyState');
  const $remainingCount = document.getElementById('remainingCount');
  const $drawBtn      = document.getElementById('drawBtn');
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
  const $discardToggle = document.getElementById('discardToggle');
  const $discardChevron = document.getElementById('discardChevron');
  const $discardPile  = document.getElementById('discardPile');
  const $discardCount = document.getElementById('discardCount');
  const $scoreValue   = document.getElementById('scoreValue');
  const $scoreDisplay = document.getElementById('scoreDisplay');
  const $scoreToggle  = document.getElementById('scoreToggle');
  const $scoreTrack   = document.getElementById('scoreTrack');
  const $themeToggle  = document.getElementById('themeToggle');
  const $editBtn      = document.getElementById('editBtn');
  const $modalOverlay = document.getElementById('modalOverlay');
  const $modalClose   = document.getElementById('modalClose');
  const $newPackForm = document.getElementById('newPackForm');
  const $newPackName = document.getElementById('newPackName');
  const $mainArea     = document.getElementById('mainArea');

  /* ── Init ── */
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

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
    $discardPile.innerHTML = '';
    $discardPile.classList.remove('open');
    $discardChevron.classList.remove('open');
    $discardToggle.setAttribute('aria-expanded', 'false');
    $drawBtn.focus();
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
  }

  function showCard() {
    $emptyState.classList.add('hidden');
    $gameOver.classList.add('hidden');
    $cardStage.classList.remove('hidden');
  }

  function drawCard() {
    if (deck.length === 0) return;
    currentCard = deck.pop();
    renderCard();
    showCard();
    updateUI();
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

    /* animate out */
    $cardStage.classList.remove('animate-in');
    $cardStage.classList.add('animate-out');

    setTimeout(() => {
      updateUI();
      renderDiscardPile();
      if (deck.length === 0) {
        showGameOver();
      } else {
        showEmptyState();
        $drawBtn.focus();
      }
    }, 300);
  }

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

  function renderDiscardPile() {
    if (discard.length === 0) {
      $discardPile.innerHTML = '<p class="discard-empty">No questions answered yet</p>';
    } else {
      $discardPile.innerHTML = discard.map((q) => {
        const r = RARITY[q.rarity];
        return `
          <div class="discard-item">
            <span class="discard-item-dot" style="background: ${r.color}"></span>
            <span class="discard-item-text" title="${escapeHTML(q.text)}">${escapeHTML(q.text)}</span>
            ${scoreEnabled ? `<span class="discard-item-score" style="color: ${r.color}">+${r.points}</span>` : ''}
          </div>
        `;
      }).join('');
    }
    $discardCount.textContent = discard.length;
  }

  function updateUI() {
    $remainingCount.textContent = deck.length;
    $discardCount.textContent = discard.length;

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
    renderDiscardPile();
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHTML(str).replace(/"/g, '&quot;');
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
  }

  /* ── Event Listeners ── */
  $drawBtn.addEventListener('click', drawCard);
  $answeredBtn.addEventListener('click', answerCard);
  $skipBtn.addEventListener('click', skipCard);
  $resetBtn.addEventListener('click', resetGame);
  $themeToggle.addEventListener('click', toggleTheme);

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

  $scoreToggle.addEventListener('change', () => {
    toggleScore($scoreToggle.checked);
  });

  $discardToggle.addEventListener('click', () => {
    const isOpen = $discardPile.classList.toggle('open');
    $discardChevron.classList.toggle('open', isOpen);
    $discardToggle.setAttribute('aria-expanded', isOpen);
  });

  /* ── Modal Event Listeners ── */
  $editBtn.addEventListener('click', openModal);
  $modalClose.addEventListener('click', closeModal);
  $modalOverlay.addEventListener('click', (e) => {
    if (e.target === $modalOverlay) closeModal();
  });

  /* New pack form toggle */
  document.getElementById('newPackBtn').addEventListener('click', () => {
    const form = document.getElementById('newPackForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (form.style.display === 'block') document.getElementById('newPackName').focus();
  });

  $newPackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $newPackName.value.trim();
    if (!name) return;
    const pack = await createPack(name);
    $newPackName.value = '';
    $newPackForm.style.display = 'none';
    if (pack) {
      openPackId = pack.id;
      renderPacks();
      showToast(`"${pack.name}" pack created`);
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

  /* Keyboard shortcut: Escape closes modal */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $modalOverlay.classList.contains('open')) {
      closeModal();
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
  (async () => {
    await loadQuestions();
    await Promise.all([loadPacks(), loadMarks()]);
    resetGame();
    toggleScore(true);
    updateDeckCount();
  })();
