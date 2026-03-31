// Main app logic
(async () => {
  // State
  let allClips = [];
  let clips = [];
  let currentIndex = 0;
  let score = 0;
  let answered = 0;
  let results = []; // { clip, userAnswer, correct }
  let hasDecided = false;
  let playerReady = false;

  // DOM refs
  const welcomeScreen = document.getElementById('welcome-screen');
  const quizScreen = document.getElementById('quiz-screen');
  const summaryScreen = document.getElementById('summary-screen');
  const emptyScreen = document.getElementById('empty-screen');
  const startBtn = document.getElementById('start-btn');
  const decisionArea = document.getElementById('decision-area');
  const resultCard = document.getElementById('result-card');
  const nextBtn = document.getElementById('next-btn');
  const replayBtn = document.getElementById('replay-btn');
  const makeCallBtn = document.getElementById('make-call-btn');
  const clipTitle = document.getElementById('clip-title');
  const clipDifficulty = document.getElementById('clip-difficulty');
  const clipLevel = document.getElementById('clip-level');
  const clipProgress = document.getElementById('clip-progress');
  const scoreValue = document.getElementById('score-value');
  const accuracyValue = document.getElementById('accuracy-value');
  const filterLevel = document.getElementById('filter-level');
  const filterDifficulty = document.getElementById('filter-difficulty');
  const filterGender = document.getElementById('filter-gender');
  const clipCount = document.getElementById('clip-count');

  function showScreen(screen) {
    [welcomeScreen, quizScreen, summaryScreen, emptyScreen].forEach((s) => {
      if (s) s.classList.remove('active');
    });
    screen.classList.add('active');
  }

  // Filter clips based on selections
  function getFilteredClips() {
    let filtered = [...allClips];
    const level = filterLevel.value;
    const difficulty = filterDifficulty.value;
    const gender = filterGender.value;

    if (level !== 'all') {
      filtered = filtered.filter((c) => (c.level || '').toLowerCase() === level.toLowerCase());
    }
    if (difficulty !== 'all') {
      filtered = filtered.filter((c) => c.difficulty === difficulty);
    }
    if (gender !== 'all') {
      filtered = filtered.filter((c) => (c.tags || []).includes(gender));
    }
    return filtered;
  }

  function updateClipCount() {
    const count = getFilteredClips().length;
    clipCount.textContent = `${count} clip${count !== 1 ? 's' : ''} available`;
  }

  // Build decision buttons
  function buildDecisionUI() {
    decisionArea.innerHTML = '<h3>What\'s your call?</h3>';
    for (const [category, decisions] of Object.entries(ClipStore.CATEGORIES)) {
      const group = document.createElement('div');
      group.className = 'category-group';
      group.innerHTML = `<h4>${category}</h4><div class="decision-buttons"></div>`;
      const btnsContainer = group.querySelector('.decision-buttons');
      for (const decision of decisions) {
        const btn = document.createElement('button');
        btn.className = 'decision-btn';
        btn.textContent = decision;
        btn.dataset.decision = decision;
        btn.dataset.category = category;
        btn.addEventListener('click', () => handleDecision(decision));
        btnsContainer.appendChild(btn);
      }
      decisionArea.appendChild(group);
    }
  }

  function handleDecision(decision) {
    if (hasDecided) return;
    hasDecided = true;

    const clip = clips[currentIndex];
    const isCorrect = decision === clip.correctDecision;
    if (isCorrect) score++;
    answered++;

    results.push({ clip, userAnswer: decision, correct: isCorrect });

    // Highlight buttons
    const allBtns = decisionArea.querySelectorAll('.decision-btn');
    allBtns.forEach((btn) => {
      if (btn.dataset.decision === decision && isCorrect) {
        btn.classList.add('correct');
      } else if (btn.dataset.decision === decision && !isCorrect) {
        btn.classList.add('incorrect');
      }
      if (btn.dataset.decision === clip.correctDecision && !isCorrect) {
        btn.classList.add('was-correct');
      }
    });

    // Show result
    resultCard.className = `result-card ${isCorrect ? '' : 'wrong'}`;
    resultCard.innerHTML = `
      <h3 class="${isCorrect ? 'correct-text' : 'incorrect-text'}">
        ${isCorrect ? 'Correct!' : 'Incorrect'}
      </h3>
      <p><strong>Correct call:</strong> ${clip.correctDecision} (${clip.category})</p>
      ${!isCorrect ? `<p><strong>Your call:</strong> ${decision}</p>` : ''}
      <p class="explanation">${clip.explanation || ''}</p>
      ${clip.refActualCall ? `<p class="ref-call">Actual ref decision: ${clip.refActualCall}</p>` : ''}
      ${clip.level ? `<p class="ref-call">Level: ${clip.level}</p>` : ''}
    `;
    resultCard.style.display = 'block';
    makeCallBtn.style.display = 'none';

    updateScoreBar();
  }

  function updateScoreBar() {
    scoreValue.textContent = `${score}/${answered}`;
    accuracyValue.textContent = answered > 0 ? `${Math.round((score / answered) * 100)}%` : '-';
  }

  function loadClip(index) {
    const clip = clips[index];
    hasDecided = false;
    resultCard.style.display = 'none';

    clipTitle.textContent = clip.title || `Clip ${index + 1}`;
    clipDifficulty.className = `badge badge-${clip.difficulty || 'medium'}`;
    clipDifficulty.textContent = clip.difficulty || 'medium';
    if (clipLevel) {
      clipLevel.textContent = clip.level || '';
    }
    clipProgress.textContent = `${index + 1} / ${clips.length}`;

    // Reset decision buttons
    buildDecisionUI();
    decisionArea.style.display = 'none';
    makeCallBtn.style.display = 'inline-block';

    YouTubePlayer.playClip(clip.videoId, clip.startTime, clip.endTime, () => {
      // Clip ended — show decision UI
      decisionArea.style.display = 'block';
      makeCallBtn.style.display = 'none';
    });
  }

  function showSummary() {
    showScreen(summaryScreen);
    const pct = answered > 0 ? Math.round((score / answered) * 100) : 0;
    document.getElementById('final-score').textContent = `${pct}%`;
    document.getElementById('final-detail').textContent = `${score} correct out of ${answered} clips`;

    // Category breakdown
    const breakdown = {};
    for (const r of results) {
      const cat = r.clip.category || 'Other';
      if (!breakdown[cat]) breakdown[cat] = { correct: 0, total: 0 };
      breakdown[cat].total++;
      if (r.correct) breakdown[cat].correct++;
    }

    const container = document.getElementById('breakdown');
    container.innerHTML = '';
    for (const [cat, data] of Object.entries(breakdown)) {
      const row = document.createElement('div');
      row.className = 'breakdown-row';
      row.innerHTML = `
        <span class="cat-name">${cat}</span>
        <span>${data.correct}/${data.total}</span>
      `;
      container.appendChild(row);
    }
  }

  // Event listeners
  startBtn.addEventListener('click', async () => {
    clips = ClipStore.shuffle(getFilteredClips());
    if (clips.length === 0) {
      showScreen(emptyScreen);
      return;
    }
    score = 0;
    answered = 0;
    results = [];
    currentIndex = 0;
    updateScoreBar();
    showScreen(quizScreen);
    if (!playerReady) {
      await YouTubePlayer.init('yt-player');
      playerReady = true;
    }
    loadClip(0);
  });

  makeCallBtn.addEventListener('click', () => {
    YouTubePlayer.pause();
    decisionArea.style.display = 'block';
    makeCallBtn.style.display = 'none';
  });

  nextBtn.addEventListener('click', () => {
    currentIndex++;
    if (currentIndex >= clips.length) {
      showSummary();
    } else {
      loadClip(currentIndex);
    }
  });

  replayBtn.addEventListener('click', () => {
    const clip = clips[currentIndex];
    YouTubePlayer.replay(clip.startTime, clip.endTime);
  });

  document.getElementById('restart-btn')?.addEventListener('click', () => {
    showScreen(welcomeScreen);
    updateClipCount();
  });

  // Filter change listeners
  [filterLevel, filterDifficulty, filterGender].forEach((el) => {
    el.addEventListener('change', updateClipCount);
  });

  // Init — load clips and update count
  allClips = await ClipStore.getAllClips();
  updateClipCount();
  showScreen(welcomeScreen);
})();
