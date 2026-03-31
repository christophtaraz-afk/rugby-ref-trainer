// Clip data layer — merges clips.json with localStorage additions
const ClipStore = (() => {
  const STORAGE_KEY = 'rugby_ref_custom_clips';

  // Decision categories
  const CATEGORIES = {
    'Foul Play': ['High Tackle', 'Dangerous Play', 'Stamping/Trampling', 'Off the Ball', 'Tip Tackle', 'Head Contact'],
    'Set Piece': ['Scrum Penalty', 'Lineout Infringement', 'Maul Infringement', 'Collapsed Scrum', 'Not Straight'],
    'Breakdown': ['Ruck Penalty', 'Not Releasing', 'Sealing Off', 'Off Feet', 'Hands in Ruck', 'Not Rolling Away'],
    'General Play': ['Offside', 'Knock-On', 'Forward Pass', 'Obstruction', 'Accidental Offside', 'Deliberate Knock-On'],
    'Restarts': ['Drop Out', '22 Restart', 'Penalty Kick Infringement', 'Quick Tap Infringement'],
    'Scoring': ['Try', 'No Try', 'Penalty Try'],
    'Advantage': ['Advantage Played'],
    'No Call': ['No Call Required'],
  };

  // Flatten for quick lookup
  const ALL_DECISIONS = [];
  for (const [cat, decisions] of Object.entries(CATEGORIES)) {
    for (const d of decisions) {
      ALL_DECISIONS.push({ category: cat, decision: d });
    }
  }

  async function loadBaseClips() {
    try {
      const resp = await fetch('data/clips.json');
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.map((c) => ({ ...c, source: 'json' }));
    } catch {
      return [];
    }
  }

  function getCustomClips() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveCustomClips(clips) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clips));
  }

  async function getAllClips() {
    const base = await loadBaseClips();
    const custom = getCustomClips();
    return [...base, ...custom.map((c) => ({ ...c, source: 'custom' }))];
  }

  function addClip(clip) {
    const clips = getCustomClips();
    clip.id = clip.id || 'clip_' + Date.now();
    clip.source = 'custom';
    clips.push(clip);
    saveCustomClips(clips);
    return clip;
  }

  function updateClip(id, updates) {
    const clips = getCustomClips();
    const idx = clips.findIndex((c) => c.id === id);
    if (idx >= 0) {
      clips[idx] = { ...clips[idx], ...updates };
      saveCustomClips(clips);
    }
  }

  function deleteClip(id) {
    const clips = getCustomClips().filter((c) => c.id !== id);
    saveCustomClips(clips);
  }

  function exportClips() {
    return JSON.stringify(getCustomClips(), null, 2);
  }

  function importClips(json) {
    const imported = JSON.parse(json);
    if (!Array.isArray(imported)) throw new Error('Invalid format: expected an array');
    const existing = getCustomClips();
    const existingIds = new Set(existing.map((c) => c.id));
    let added = 0;
    for (const clip of imported) {
      if (!clip.videoId || !clip.correctDecision) continue;
      if (existingIds.has(clip.id)) continue;
      clip.id = clip.id || 'clip_' + Date.now() + '_' + added;
      clip.source = 'custom';
      existing.push(clip);
      added++;
    }
    saveCustomClips(existing);
    return added;
  }

  // Shuffle utility
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  return {
    CATEGORIES,
    ALL_DECISIONS,
    getAllClips,
    getCustomClips,
    addClip,
    updateClip,
    deleteClip,
    exportClips,
    importClips,
    shuffle,
  };
})();
