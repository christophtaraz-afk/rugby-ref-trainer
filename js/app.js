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
  let phase = 'idle'; // 'buildup' | 'deciding' | 'aftermath' | 'idle'

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
  const watchRefBtn = document.getElementById('watch-ref-btn');
  const makeCallBtn = document.getElementById('make-call-btn');
  const buildupIndicator = document.getElementById('buildup-indicator');
  const clipTitle = document.getElementById('clip-title');
  const clipDifficulty = document.getElementById('clip-difficulty');
  const clipLevel = document.getElementById('clip-level');
  const clipMode = document.getElementById('clip-mode');
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

  // Helpers to determine clip mode
  function isFullGame(clip) {
    return clip.mode === 'fullgame' && clip.whistleTime != null;
  }

  function getClipStart(clip) {
    return isFullGame(clip) ? clip.buildUpStart : clip.startTime;
  }

  function getClipPause(clip) {
    return isFullGame(clip) ? clip.whistleTime : clip.endTime;
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
    phase = 'decided';

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

    // Show "Watch Ref Decision" button for full game clips with aftermath
    if (isFullGame(clip) && clip.aftermathEnd) {
      watchRefBtn.style.display = 'inline-block';
    } else {
      watchRefBtn.style.display = 'none';
    }

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
    watchRefBtn.style.display = 'none';

    clipTitle.textContent = clip.title || `Clip ${index + 1}`;
    clipDifficulty.className = `badge badge-${clip.difficulty || 'medium'}`;
    clipDifficulty.textContent = clip.difficulty || 'medium';
    if (clipLevel) {
      clipLevel.textContent = clip.level || '';
    }
    // Show mode badge for full game clips
    if (clipMode) {
      if (isFullGame(clip)) {
        clipMode.textContent = 'Full Game';
        clipMode.style.display = 'inline-block';
      } else {
        clipMode.style.display = 'none';
      }
    }
    clipProgress.textContent = `${index + 1} / ${clips.length}`;

    // Reset decision buttons
    buildDecisionUI();
    decisionArea.style.display = 'none';

    const clipStart = getClipStart(clip);
    const clipPause = getClipPause(clip);

    if (isFullGame(clip)) {
      // Full game mode: show build-up indicator, hide Make Your Call until whistle
      phase = 'buildup';
      makeCallBtn.style.display = 'none';
      buildupIndicator.style.display = 'block';

      YouTubePlayer.playClip(clip.videoId, clipStart, clipPause, () => {
        // Whistle moment reached — show decision UI
        phase = 'deciding';
        buildupIndicator.style.display = 'none';
        decisionArea.style.display = 'block';
      });
    } else {
      // Incident mode: existing behavior
      phase = 'deciding';
      makeCallBtn.style.display = 'inline-block';
      buildupIndicator.style.display = 'none';

      YouTubePlayer.playClip(clip.videoId, clipStart, clipPause, () => {
        decisionArea.style.display = 'block';
        makeCallBtn.style.display = 'none';
      });
    }
  }

  function showSummary() {
    showScreen(summaryScreen);
    const pct = answered > 0 ? Math.round((score / answered) * 100) : 0;

    const scoreColor = pct >= 80 ? 'var(--green-light)' : pct >= 50 ? 'var(--yellow)' : 'var(--red-light)';
    const scoreEmoji = pct >= 80 ? 'Excellent' : pct >= 60 ? 'Good effort' : pct >= 40 ? 'Keep practising' : 'More work needed';

    document.getElementById('final-score').textContent = `${pct}%`;
    document.getElementById('final-score').style.color = scoreColor;
    document.getElementById('final-detail').textContent = `${score} correct out of ${answered} clips`;
    document.getElementById('final-message').textContent = scoreEmoji;

    // Category breakdown with progress bars
    const breakdown = {};
    for (const r of results) {
      const cat = r.clip.category || 'Other';
      if (!breakdown[cat]) breakdown[cat] = { correct: 0, total: 0 };
      breakdown[cat].total++;
      if (r.correct) breakdown[cat].correct++;
    }

    const container = document.getElementById('breakdown');
    container.innerHTML = '<h3 class="breakdown-title">Breakdown by Category</h3>';
    for (const [cat, data] of Object.entries(breakdown)) {
      const catPct = Math.round((data.correct / data.total) * 100);
      const barColor = catPct >= 80 ? 'var(--green)' : catPct >= 50 ? 'var(--yellow)' : 'var(--red)';
      const row = document.createElement('div');
      row.className = 'breakdown-row';
      row.innerHTML = `
        <div class="breakdown-info">
          <span class="cat-name">${cat}</span>
          <span class="cat-score">${data.correct}/${data.total}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${catPct}%; background: ${barColor};"></div>
        </div>
      `;
      container.appendChild(row);
    }

    // Clip-by-clip review
    const reviewContainer = document.getElementById('clip-review');
    reviewContainer.innerHTML = '<h3 class="breakdown-title">Clip Review</h3>';
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const row = document.createElement('div');
      row.className = `review-row ${r.correct ? 'review-correct' : 'review-wrong'}`;
      row.innerHTML = `
        <div class="review-icon">${r.correct ? '&#10003;' : '&#10007;'}</div>
        <div class="review-detail">
          <div class="review-title">${r.clip.title}</div>
          <div class="review-answer">
            ${r.correct
              ? `<span class="correct-text">Correct: ${r.clip.correctDecision}</span>`
              : `<span class="incorrect-text">Your call: ${r.userAnswer}</span> &mdash; <span class="correct-text">Answer: ${r.clip.correctDecision}</span>`
            }
          </div>
        </div>
      `;
      reviewContainer.appendChild(row);
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
    buildupIndicator.style.display = 'none';
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
    const clipStart = getClipStart(clip);
    const clipPause = getClipPause(clip);
    YouTubePlayer.replay(clipStart, clipPause);
  });

  // Watch Ref Decision button — plays aftermath of full game clips
  watchRefBtn.addEventListener('click', () => {
    const clip = clips[currentIndex];
    if (!isFullGame(clip) || !clip.aftermathEnd) return;
    phase = 'aftermath';
    watchRefBtn.style.display = 'none';
    YouTubePlayer.playAftermath(clip.whistleTime, clip.aftermathEnd, () => {
      phase = 'decided';
      // Aftermath finished — user can click Next Clip
    });
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
