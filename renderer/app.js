// ── State ──────────────────────────────────────────────────────────────
let state = {
  screen: 'home',      // 'home' | 'processing' | 'player'
  subtitles: [],
  videoPath: null,
  videoUrl: null,
  settingsVisible: false,
  settings: { cacheDir: '', model: 'base' },
  cacheEntries: {},
  selectedKeys: new Set(),
}

// ── Init ───────────────────────────────────────────────────────────────
async function init() {
  state.settings = await window.api.getSettings()
  state.cacheEntries = await window.api.getCacheIndex()
  renderHome()

  window.api.onProgress((data) => handleProgress(data))
  window.api.onDone((data) => handleDone(data))
  window.api.onError((data) => handleError(data))
}

// ── Screens ────────────────────────────────────────────────────────────
function renderHome() {
  state.screen = 'home'
  state.selectedKeys.clear()
  document.getElementById('app').innerHTML = homeHTML()
  bindHomeEvents()
}

function homeHTML() {
  const entries = Object.entries(state.cacheEntries)
    .sort((a, b) => new Date(b[1].date) - new Date(a[1].date))
    .slice(0, 50)
  const hasSelected = state.selectedKeys.size > 0

  return `
<div class="screen home active">
  <div class="home-header">
    <h1>Translate</h1>
    <button class="gear-btn" id="gear-btn">&#9881;</button>
  </div>

  <div class="settings-panel ${state.settingsVisible ? 'visible' : ''}" id="settings-panel">
    <div class="settings-row">
      <span class="settings-label">Cache location</span>
      <span class="settings-value" id="cache-dir-val">${state.settings.cacheDir}</span>
      <button class="settings-btn" id="change-dir-btn">Change</button>
    </div>
    <div id="settings-error" class="settings-error"></div>
    <div class="settings-row">
      <span class="settings-label">Whisper model</span>
      <select class="model-select" id="model-select">
        ${['tiny','base','small','medium','large'].map(m =>
          `<option value="${m}" ${m === state.settings.model ? 'selected' : ''}>${m}</option>`
        ).join('')}
      </select>
    </div>
  </div>

  <div class="tabs">
    <button class="tab active" data-tab="local">Local File</button>
    <button class="tab" data-tab="youtube">YouTube URL</button>
  </div>
  <div class="tab-panel active" id="tab-local">
    <div class="drop-zone" id="drop-zone">
      <div class="icon">+</div>
      Drop a video file here<br>
      <button class="browse-btn" id="browse-btn">Browse files</button>
    </div>
  </div>
  <div class="tab-panel" id="tab-youtube">
    <div class="yt-row">
      <input class="yt-input" id="yt-input" placeholder="https://www.youtube.com/watch?v=..." />
      <button class="load-btn" id="yt-load-btn">Load</button>
    </div>
  </div>

  <div class="list-header">
    <div class="list-header-left">
      <input type="checkbox" class="select-all-cb ${hasSelected ? 'visible' : ''}" id="select-all-cb">
      <span class="list-label">Recently translated</span>
    </div>
    <button class="delete-selected-btn ${hasSelected ? 'visible' : ''}" id="delete-btn">
      Delete selected (${state.selectedKeys.size})
    </button>
  </div>
  <div class="cache-list" id="cache-list">
    ${entries.length === 0 ? '<span style="color:#444;font-size:12px;">No translations yet</span>' : ''}
    ${entries.map(([key, e]) => `
      <div class="cache-item" data-key="${key}">
        <input type="checkbox" class="cache-item-cb ${hasSelected ? 'show' : ''}"
               data-key="${key}" ${state.selectedKeys.has(key) ? 'checked' : ''}>
        <div class="cache-item-info">
          <div class="cache-item-title">${e.title}</div>
          <div class="cache-item-meta">${e.source} · ${new Date(e.date).toLocaleDateString()}</div>
        </div>
        <span class="cache-badge">CACHED</span>
      </div>
    `).join('')}
  </div>
</div>`
}

function bindHomeEvents() {
  // Tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
      btn.classList.add('active')
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active')
    })
  })

  // Gear / settings
  document.getElementById('gear-btn').addEventListener('click', () => {
    state.settingsVisible = !state.settingsVisible
    document.getElementById('settings-panel').classList.toggle('visible', state.settingsVisible)
  })

  // Change cache dir
  document.getElementById('change-dir-btn').addEventListener('click', async () => {
    const result = await window.api.changeCacheDir()
    if (result && result.error) {
      document.getElementById('settings-error').textContent = result.error
    } else if (result && result.cacheDir) {
      state.settings.cacheDir = result.cacheDir
      document.getElementById('cache-dir-val').textContent = result.cacheDir
      document.getElementById('settings-error').textContent = ''
    }
  })

  // Model select
  document.getElementById('model-select').addEventListener('change', async (e) => {
    state.settings.model = e.target.value
    await window.api.changeModel(e.target.value)
  })

  // Browse files
  document.getElementById('browse-btn').addEventListener('click', async () => {
    await window.api.openLocalFile()
    // processing handled via onProgress/onDone/onError events
  })

  // Drop zone
  // In Electron, the File object in the renderer has a .path property with the full filesystem path
  const dz = document.getElementById('drop-zone')
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over') })
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'))
  const VALID_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm']
  dz.addEventListener('drop', (e) => {
    e.preventDefault()
    dz.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]
    if (!file || !file.path) return
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!VALID_EXTS.includes(ext)) return
    window.api.loadLocalPath(file.path)
  })

  // YouTube load
  document.getElementById('yt-load-btn').addEventListener('click', async () => {
    const url = document.getElementById('yt-input').value.trim()
    if (!url) return
    await window.api.loadYoutube(url)
  })

  // Cache item click (load)
  document.getElementById('cache-list').addEventListener('click', async (e) => {
    const cb = e.target.closest('input[type=checkbox]')
    if (cb) {
      e.stopPropagation()
      const key = cb.dataset.key
      if (cb.checked) state.selectedKeys.add(key)
      else state.selectedKeys.delete(key)
      renderHome()
      return
    }
    const item = e.target.closest('.cache-item')
    if (item && !e.target.matches('input')) {
      const key = item.dataset.key
      await window.api.loadCached(key)
    }
  })

  // Select all
  const selectAll = document.getElementById('select-all-cb')
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      const allKeys = Object.keys(state.cacheEntries)
      if (selectAll.checked) allKeys.forEach(k => state.selectedKeys.add(k))
      else state.selectedKeys.clear()
      renderHome()
    })
  }

  // Delete selected
  const deleteBtn = document.getElementById('delete-btn')
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!state.selectedKeys.size) return
      const remaining = await window.api.deleteCacheEntries([...state.selectedKeys])
      state.cacheEntries = remaining
      state.selectedKeys.clear()
      renderHome()
    })
  }
}

// ── Event handlers ─────────────────────────────────────────────────────
function handleProgress(data) {
  if (state.screen !== 'processing') renderProcessing()
  updateProgress(data)
}

function handleDone(data) {
  state.subtitles = data.subtitles
  state.videoPath = data.videoPath
  state.videoUrl = data.videoUrl
  window.api.getCacheIndex().then(idx => { state.cacheEntries = idx })
  renderPlayer()
}

function handleError(data) {
  if (state.screen !== 'home') renderHome()
  alert(`Error: ${data.message}`)
}

// ── Screens: Processing (Task 9) and Player (Task 10 stub) ────────────
function renderProcessing() {
  state.screen = 'processing'
  document.getElementById('app').innerHTML = `
<div class="screen processing active">
  <div class="processing-title">Processing video…</div>
  <div class="phase-label" id="phase-label">Starting…</div>
  <div id="progress-area">
    <div class="spinner"></div>
  </div>
  <button class="cancel-btn" id="cancel-btn">Cancel</button>
</div>`
  document.getElementById('cancel-btn').addEventListener('click', async () => {
    await window.api.cancelProcessing()
    renderHome()
  })
}

function updateProgress(data) {
  const label = document.getElementById('phase-label')
  const area = document.getElementById('progress-area')
  if (!label || !area) return

  if (data.phase === 'download' && data.pct !== undefined) {
    label.textContent = `Downloading… ${data.pct}%`
    area.innerHTML = `
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${data.pct}%"></div>
      </div>`
  } else if (data.phase === 'transcribe') {
    label.textContent = 'Transcribing…'
    area.innerHTML = '<div class="spinner"></div>'
  }
}

function renderPlayer() {
  state.screen = 'player'
  const videoUrl = state.videoUrl

  document.getElementById('app').innerHTML = `
<div class="screen player active">
  <button class="back-btn" id="back-btn">← Home</button>
  <video id="video" src="${videoUrl}"></video>
  <div class="subtitle-overlay" id="overlay">
    <div id="overlay-content"></div>
    <div class="overlay-hint">Press play or Space to continue</div>
  </div>
  <div class="controls">
    <button class="ctrl-btn" id="play-btn">▶</button>
    <div class="seek-bar" id="seek-bar">
      <div class="seek-fill" id="seek-fill" style="width:0%"></div>
    </div>
    <span class="time-display" id="time-display">0:00 / 0:00</span>
    <input type="range" class="volume-slider" id="vol" min="0" max="1" step="0.05" value="1">
    <button class="ctrl-btn" id="back5-btn">-5s</button>
    <button class="translate-btn" id="translate-btn">TRANSLATE</button>
  </div>
</div>`

  bindPlayerEvents()
}

function bindPlayerEvents() {
  const video = document.getElementById('video')
  const playBtn = document.getElementById('play-btn')
  const seekBar = document.getElementById('seek-bar')
  const seekFill = document.getElementById('seek-fill')
  const timeDisplay = document.getElementById('time-display')
  const vol = document.getElementById('vol')
  const translateBtn = document.getElementById('translate-btn')
  const overlay = document.getElementById('overlay')

  function fmt(s) {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  function hideOverlay() {
    overlay.classList.remove('visible')
  }

  function resume() {
    hideOverlay()
    video.play()
  }

  playBtn.addEventListener('click', () => {
    if (video.paused) resume()
    else video.pause()
  })

  video.addEventListener('play', () => { playBtn.textContent = '⏸'; hideOverlay() })
  video.addEventListener('pause', () => { playBtn.textContent = '▶' })
  video.addEventListener('error', () => {
    const err = video.error
    alert(`Video failed to load (code ${err ? err.code : '?'}): ${err ? err.message : 'unknown error'}`)
  })

  video.addEventListener('timeupdate', () => {
    if (!video.duration) return
    seekFill.style.width = `${(video.currentTime / video.duration) * 100}%`
    timeDisplay.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`
  })

  seekBar.addEventListener('click', (e) => {
    if (!video.duration || !isFinite(video.duration)) return
    const rect = seekBar.getBoundingClientRect()
    video.currentTime = ((e.clientX - rect.left) / rect.width) * video.duration
    hideOverlay()
  })

  vol.addEventListener('input', () => { video.volume = vol.value })

  if (window._playerKeydown) document.removeEventListener('keydown', window._playerKeydown)
  window._playerKeydown = (e) => {
    if (e.code === 'Space' && state.screen === 'player') {
      e.preventDefault()
      if (overlay.classList.contains('visible')) resume()
      else if (video.paused) resume()
      else video.pause()
    }
  }
  document.addEventListener('keydown', window._playerKeydown)

  document.getElementById('back5-btn').addEventListener('click', () => {
    video.currentTime = Math.max(0, video.currentTime - 5)
  })

  translateBtn.addEventListener('click', () => {
    video.pause()
    const t = video.currentTime
    const matches = state.subtitles.filter(s => s.end > t - 5 && s.start < t)
    const content = document.getElementById('overlay-content')
    if (matches.length === 0) {
      content.innerHTML = '<div class="subtitle-empty">No dialogue in this segment</div>'
    } else {
      content.innerHTML = matches.map(s => `
        <div class="subtitle-line">
          <div class="subtitle-ts">${fmt(s.start)} – ${fmt(s.end)}</div>
          <div class="subtitle-text">${s.text}</div>
        </div>`).join('')
    }
    overlay.classList.add('visible')
  })

  document.getElementById('back-btn').addEventListener('click', () => {
    video.pause()
    if (window._playerKeydown) {
      document.removeEventListener('keydown', window._playerKeydown)
      window._playerKeydown = null
    }
    renderHome()
  })
}

init()
