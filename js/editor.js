// Editor logic
(async () => {
  let editingId = null;
  let player = null;

  // DOM refs
  const form = document.getElementById('clip-form');
  const clipList = document.getElementById('clip-list');
  const urlInput = document.getElementById('url-input');
  const startInput = document.getElementById('start-input');
  const endInput = document.getElementById('end-input');
  const titleInput = document.getElementById('title-input');
  const decisionSelect = document.getElementById('decision-select');
  const difficultySelect = document.getElementById('difficulty-select');
  const explanationInput = document.getElementById('explanation-input');
  const refCallInput = document.getElementById('ref-call-input');
  const previewBtn = document.getElementById('preview-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importArea = document.getElementById('import-area');
  const formTitle = document.getElementById('form-title');

  // Build decision dropdown
  function buildDecisionDropdown() {
    decisionSelect.innerHTML = '<option value="">-- Select decision --</option>';
    for (const [category, decisions] of Object.entries(ClipStore.CATEGORIES)) {
      const group = document.createElement('optgroup');
      group.label = category;
      for (const d of decisions) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        group.appendChild(opt);
      }
      decisionSelect.appendChild(group);
    }
  }

  // Extract YouTube video ID from URL
  function extractVideoId(url) {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  // Render clip list
  async function renderClips() {
    const allClips = await ClipStore.getAllClips();
    if (allClips.length === 0) {
      clipList.innerHTML = '<p style="color: var(--text-muted); padding: 20px;">No clips yet. Add your first clip above.</p>';
      return;
    }

    let html = `<table class="clip-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Decision</th>
          <th>Difficulty</th>
          <th>Source</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>`;

    for (const clip of allClips) {
      html += `<tr>
        <td>${clip.title || clip.id}</td>
        <td>${clip.correctDecision}</td>
        <td><span class="badge badge-${clip.difficulty || 'medium'}">${clip.difficulty || 'medium'}</span></td>
        <td>${clip.source || 'json'}</td>
        <td class="actions">
          ${clip.source === 'custom'
            ? `<button class="btn btn-small btn-secondary" onclick="editClip('${clip.id}')">Edit</button>
               <button class="btn btn-small btn-danger" onclick="deleteClip('${clip.id}')">Delete</button>`
            : '<span style="color: var(--text-muted);">Built-in</span>'}
        </td>
      </tr>`;
    }

    html += '</tbody></table>';
    clipList.innerHTML = html;
  }

  // Edit a clip
  window.editClip = function (id) {
    const clips = ClipStore.getCustomClips();
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;

    editingId = id;
    formTitle.textContent = 'Edit Clip';
    urlInput.value = `https://youtube.com/watch?v=${clip.videoId}`;
    startInput.value = clip.startTime || 0;
    endInput.value = clip.endTime || 0;
    titleInput.value = clip.title || '';
    decisionSelect.value = clip.correctDecision || '';
    difficultySelect.value = clip.difficulty || 'medium';
    explanationInput.value = clip.explanation || '';
    refCallInput.value = clip.refActualCall || '';
    cancelBtn.style.display = 'inline-block';
  };

  // Delete a clip
  window.deleteClip = function (id) {
    if (!confirm('Delete this clip?')) return;
    ClipStore.deleteClip(id);
    renderClips();
    showToast('Clip deleted');
  };

  // Preview clip
  previewBtn.addEventListener('click', async () => {
    const videoId = extractVideoId(urlInput.value);
    if (!videoId) {
      showToast('Invalid YouTube URL', true);
      return;
    }
    const start = parseFloat(startInput.value) || 0;
    const end = parseFloat(endInput.value) || start + 10;

    if (!player) {
      await YouTubePlayer.init('editor-player');
      player = true;
    }
    YouTubePlayer.playClip(videoId, start, end);
  });

  // Form submit
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const videoId = extractVideoId(urlInput.value);
    if (!videoId) {
      showToast('Invalid YouTube URL', true);
      return;
    }

    const clipData = {
      videoId,
      title: titleInput.value.trim() || 'Untitled Clip',
      startTime: parseFloat(startInput.value) || 0,
      endTime: parseFloat(endInput.value) || 10,
      correctDecision: decisionSelect.value,
      category: decisionSelect.selectedOptions[0]?.parentElement?.label || '',
      difficulty: difficultySelect.value,
      explanation: explanationInput.value.trim(),
      refActualCall: refCallInput.value.trim(),
    };

    if (!clipData.correctDecision) {
      showToast('Please select a correct decision', true);
      return;
    }

    if (editingId) {
      ClipStore.updateClip(editingId, clipData);
      showToast('Clip updated');
    } else {
      ClipStore.addClip(clipData);
      showToast('Clip added');
    }

    resetForm();
    renderClips();
  });

  cancelBtn.addEventListener('click', () => resetForm());

  function resetForm() {
    editingId = null;
    formTitle.textContent = 'Add New Clip';
    form.reset();
    cancelBtn.style.display = 'none';
  }

  // Export
  exportBtn.addEventListener('click', () => {
    const json = ClipStore.exportClips();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rugby-clips.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Clips exported');
  });

  // Import
  importBtn.addEventListener('click', () => {
    const json = importArea.value.trim();
    if (!json) {
      showToast('Paste JSON data first', true);
      return;
    }
    try {
      const count = ClipStore.importClips(json);
      showToast(`Imported ${count} clips`);
      importArea.value = '';
      renderClips();
    } catch (err) {
      showToast('Invalid JSON: ' + err.message, true);
    }
  });

  // Toast
  function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast show ${isError ? 'error' : ''}`;
    setTimeout(() => (toast.className = 'toast'), 2500);
  }

  // Init
  buildDecisionDropdown();
  renderClips();
})();
