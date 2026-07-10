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

  /* ── Parse game data ── */
  function parseQuestions() {
    const raw = `COMMON QUESTIONS
1. What was your favorite childhood TV show?
2. If you could instantly master one skill, what would it be?
3. What is your dream vacation?
4. What food could you eat every week and never get tired of?
5. What is a small thing that always makes you smile?
6. If you won $10 million tomorrow, what is the first thing you'd buy?
7. What is your favorite memory from high school?
8. What is your ideal Saturday?
9. What movie can you watch repeatedly?
10. What animal best represents your personality?

UNCOMMON QUESTIONS
1. What is a risk you took that paid off?
2. What is something you've changed your mind about in the last five years?
3. Who had the biggest positive influence on your life?
4. What is a hobby you've always wanted to try?
5. What is one thing people misunderstand about you?
6. What was your first impression of me?
7. What is one thing you wish more people knew about you?
8. What is the most memorable trip you've ever taken?
9. What is a life lesson you learned the hard way?
10. What was your happiest year and why?

RARE QUESTIONS
1. When do you feel most loved?
2. What is something I do that makes your day better?
3. What is one thing we should do more often together?
4. What is your favorite memory of us?
5. What makes you feel appreciated?
6. What is a tradition you'd like us to start?
7. What is something you've always wanted us to try together?
8. What do you think we're best at as a couple?
9. What is one thing you admire about me that I may not realize?
10. What is a goal you'd like us to achieve together?

EPIC QUESTIONS
1. What moment changed your life the most?
2. What fear has shaped your decisions the most?
3. What do you hope people remember about you?
4. What part of your younger self do you miss?
5. What is something you are still figuring out about yourself?
6. What achievement are you most proud of?
7. What would your perfect life look like in ten years?
8. What challenge taught you the most about yourself?
9. What belief guides your life?
10. What is something you wish you worried less about?

LEGENDARY QUESTIONS
1. What is something you've never told many people?
2. What is your biggest insecurity?
3. What do you think is your greatest strength and greatest weakness?
4. When have you felt most alone?
5. What is a dream you've quietly given up on?
6. What do you think your future self would thank you for?
7. What is something you wish people understood about your struggles?
8. What part of our relationship are you most grateful for?
9. What is a question you've always wanted someone to ask you?
10. What truth about yourself took the longest to accept?

FUTURE US - COMMON
1. What is one place you'd love for us to visit together?
2. What is a hobby we could start as a couple?
3. What would your ideal date night look like five years from now?
4. What is one thing you'd like us to do more often as a family?
5. What is something small we could do every week that would make life better?
6. If we had a free weekend with no responsibilities, what would you want to do?
7. What is one holiday tradition you'd like to create?
8. What would our dream backyard include?
9. What is a skill you'd like us both to learn?
10. What kind of pets would you want in the future?

FUTURE US - UNCOMMON
1. What is a family tradition from your childhood that you'd like to continue?
2. What tradition would you like to create from scratch?
3. What is one thing you hope our children remember about growing up?
4. What is a goal you'd like us to accomplish in the next two years?
5. What would our dream family vacation look like?
6. If we moved anywhere in the world for a year, where would you choose?
7. What kind of adventures should we prioritize while we're younger?
8. What project would be fun for us to work on together?
9. What is one thing we should start saving for now?
10. What does a successful year for us look like?

FUTURE US - RARE
1. What values do you most want our children to learn from us?
2. What is something you hope never changes about our relationship?
3. What kind of grandparents do you hope we'll become someday?
4. What do you think our biggest adventure together has yet to be?
5. What is one dream you've never seriously discussed with me?
6. What would make you feel that we've truly built a great life together?
7. What kind of home would make you happiest?
8. What do you think we'll laugh about when we're 80?
9. What challenge do you think we'll overcome together in the future?
10. What is one thing you hope we always make time for?

FUTURE US - EPIC
1. If we were celebrating our 50th anniversary, what would you hope we could say about our life together?
2. What do you think is the most important thing we're building right now?
3. What sacrifices are worth making for our future?
4. What kind of legacy would you like our family to leave behind?
5. What do you hope our children learn from watching our marriage?
6. What are we currently taking for granted that we'll appreciate later?
7. What dream feels unrealistic today but might be possible someday?
8. What would our perfect retirement look like?
9. How do you think we'll be different in ten years?
10. What is one future goal that scares you because it matters so much?

FUTURE US - LEGENDARY
1. What is your biggest hope for our life together?
2. What is your biggest fear about the future?
3. If we could guarantee one thing about our future, what would you choose?
4. What do you hope people say about our relationship after we're gone?
5. What part of our future are you most excited about?
6. What challenge do you think will test us the most?
7. What do you think love will look like for us in 30 years?
8. What would make you feel that your life was well-lived?
9. What promise do you hope we always keep to each other?
10. What is a dream you hope we never stop pursuing together?

MYTHIC QUESTIONS
1. We are both 90 years old, sitting on a porch together. What stories are we telling?
2. If we could design our perfect future from scratch, what would it look like?
3. What is something you hope we accomplish together that neither of us could accomplish alone?
4. Imagine our children describing us 30 years from now. What do you hope they say?
5. What does a life with no regrets look like for us?
6. What is the greatest adventure we haven't started yet?
7. If we could send one message to ourselves 20 years in the future, what would it be?
8. What are we building together that will outlast us?`;

    const sections = raw.split(/\n(?=[A-Z][A-Z ]+(?:QUESTIONS|US - [A-Z]+))/);
    const categoryMap = {
      'COMMON QUESTIONS':    { rarity: 'common',    category: 'General' },
      'UNCOMMON QUESTIONS':  { rarity: 'uncommon',  category: 'General' },
      'RARE QUESTIONS':      { rarity: 'rare',      category: 'General' },
      'EPIC QUESTIONS':      { rarity: 'epic',      category: 'General' },
      'LEGENDARY QUESTIONS': { rarity: 'legendary', category: 'General' },
      'FUTURE US - COMMON':    { rarity: 'common',    category: 'Future Us' },
      'FUTURE US - UNCOMMON':  { rarity: 'uncommon',  category: 'Future Us' },
      'FUTURE US - RARE':      { rarity: 'rare',      category: 'Future Us' },
      'FUTURE US - EPIC':      { rarity: 'epic',      category: 'Future Us' },
      'FUTURE US - LEGENDARY': { rarity: 'legendary', category: 'Future Us' },
      'MYTHIC QUESTIONS':    { rarity: 'mythic',    category: 'General' },
    };

    for (const section of sections) {
      const lines = section.trim().split('\n');
      const header = lines[0].trim();
      const config = categoryMap[header];
      if (!config) continue;

      for (let i = 1; i < lines.length; i++) {
        const match = lines[i].match(/^\d+\.\s+(.+)/);
        if (match) {
          QUESTIONS.push({
            text: match[1],
            rarity: config.rarity,
            category: config.category,
          });
        }
      }
    }
  }

  /* ── Game State ── */
  let deck = [];
  let discard = [];
  let currentCard = null;
  let score = 0;
  let scoreEnabled = true;
  let questionsAnswered = 0;

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
        });
      }
    }
    return extra.length === 0 ? [...QUESTIONS] : [...QUESTIONS, ...extra];
  }

  function getEnabledPackCount() {
    return questionPacks.filter(p => p.enabled).length;
  }

  /* ── Modal / Pack UI ── */
  let openPackId = null;

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
                return `<div class="pack-q">
                  <span class="pack-q-text" title="${escapeHTML(q.text)}">${escapeHTML(q.text)}</span>
                  <span class="pack-q-rarity" style="color:${r.color}">${r.label}</span>
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
        const packId = parseInt(btn.dataset.pack);
        const qid = parseInt(btn.dataset.qid);
        await deleteQuestionFromPack(packId, qid);
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

  function resetGame() {
    deck = shuffle(getAllQuestions());
    discard = [];
    currentCard = null;
    score = 0;
    questionsAnswered = 0;
    updateUI();
    showEmptyState();
    $gameOver.classList.add('hidden');
    $discardPile.innerHTML = '';
    $discardPile.classList.remove('open');
    $discardChevron.classList.remove('open');
    $discardToggle.setAttribute('aria-expanded', 'false');
    $drawBtn.focus();
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

  function showToast(msg) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
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
  parseQuestions();
  loadTheme();
  (async () => {
    await loadPacks();
    resetGame();
    toggleScore(true);
    updateDeckCount();
  })();
