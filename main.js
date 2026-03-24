const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const http = require('http')
const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
const cache = require('./cache')
const worker = require('./worker')

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

const MIME = { mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime', webm: 'video/webm' }
let videoServerPort = null

function startVideoServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const filePath = decodeURIComponent(req.url.slice(1))
      try {
        const stat = fs.statSync(filePath)
        const fileSize = stat.size
        const ext = path.extname(filePath).slice(1).toLowerCase()
        const contentType = MIME[ext] || 'application/octet-stream'
        const range = req.headers.range

        if (range) {
          const m = range.match(/bytes=(\d+)-(\d*)/)
          const start = parseInt(m[1], 10)
          const end = m[2] ? Math.min(parseInt(m[2], 10), fileSize - 1) : fileSize - 1
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': contentType,
          })
          fs.createReadStream(filePath, { start, end }).pipe(res)
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
          })
          fs.createReadStream(filePath).pipe(res)
        }
      } catch (err) {
        res.writeHead(404)
        res.end(err.message)
      }
    })
    server.listen(0, '127.0.0.1', () => {
      videoServerPort = server.address().port
      resolve()
    })
  })
}

function videoUrl(filePath) {
  return `http://127.0.0.1:${videoServerPort}/${encodeURIComponent(filePath)}`
}

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile('renderer/index.html')
}

function checkUv() {
  try {
    execSync('uv --version', { stdio: 'ignore' })
  } catch {
    dialog.showErrorBoxSync(
      'Missing dependency: uv',
      'uv is not installed or not on PATH.\n\nInstall it from: https://docs.astral.sh/uv/\n\nThe app will now exit.'
    )
    app.exit(1)
  }
}

app.whenReady().then(async () => {
  checkUv()
  await startVideoServer()
  createWindow()
  registerIpcHandlers()
})

app.on('window-all-closed', () => app.quit())
// Windows only — no macOS activate handler needed

app.on('before-quit', () => {
  worker.cancel()
})

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

function registerIpcHandlers() {
  ipcMain.handle('get-settings', () => cache.loadSettings())

  ipcMain.handle('change-model', (_, { model }) => {
    const s = cache.loadSettings()
    cache.saveSettings({ ...s, model })
  })

  ipcMain.handle('change-cache-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    if (result.canceled) return { canceled: true }
    const dir = result.filePaths[0]
    if (!cache.isCacheDirWritable(dir)) {
      return { error: 'Directory is not writable.' }
    }
    const s = cache.loadSettings()
    cache.saveSettings({ ...s, cacheDir: dir })
    return { cacheDir: dir }
  })

  ipcMain.handle('get-cache-index', () => {
    const cacheDir = cache.getCacheDir()
    return cache.readIndex(cacheDir)
  })

  ipcMain.handle('delete-cache-entries', (_, { keys }) => {
    const cacheDir = cache.getCacheDir()
    cache.deleteEntries(cacheDir, keys)
    return cache.readIndex(cacheDir)
  })

  ipcMain.handle('open-local-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'] }],
    })
    if (result.canceled) return null
    return handleLocalFile(result.filePaths[0])
  })

  ipcMain.handle('load-local-path', (_, { absPath }) => handleLocalFile(absPath))

  ipcMain.handle('load-youtube', (_, { url }) => {
    const videoId = cache.extractVideoId(url)
    if (!videoId) return { error: 'Could not extract video ID from URL.' }
    return handleYoutube(url, videoId)
  })

  ipcMain.handle('load-cached', (_, { key }) => {
    const cacheDir = cache.getCacheDir()
    const entries = cache.readIndex(cacheDir)
    const entry = entries[key]
    if (!entry) return { error: 'Entry not found' }
    if (entry.source === 'local') return handleLocalFile(entry.video_path)
    if (entry.source === 'youtube') {
      const videoId = cache.extractVideoId(entry.url)
      return handleYoutube(entry.url, videoId)
    }
  })

  ipcMain.handle('cancel-processing', () => {
    worker.cancel()
  })
}

function handleLocalFile(absPath) {
  if (!fs.existsSync(absPath)) {
    setImmediate(() => send('processing-error', { message: `File not found at original path: ${absPath}` }))
    return { hit: false }
  }

  const cacheDir = cache.getCacheDir()
  cache.ensureCacheDir(cacheDir)
  const key = cache.localKey(absPath)
  const srtFile = cache.srtPath(cacheDir, key)
  const entry = cache.readIndex(cacheDir)[key]

  if (entry && fs.existsSync(srtFile)) {
    const subtitles = cache.parseSrt(fs.readFileSync(srtFile, 'utf8'))
    setImmediate(() => send('processing-done', { subtitles, videoPath: absPath, videoUrl: videoUrl(absPath) }))
    return { hit: true }
  }

  const { model } = cache.loadSettings()
  const title = path.basename(absPath, path.extname(absPath))

  return new Promise((resolve) => {
    worker.runLocal(
      { absPath, srtPath: srtFile, model },
      (progress) => send('processing-progress', progress),
      (_msg) => {
        try {
          const subtitles = cache.parseSrt(fs.readFileSync(srtFile, 'utf8'))
          cache.setEntry(cacheDir, key, {
            title,
            date: new Date().toISOString(),
            srt_path: srtFile,
            video_path: absPath,
            source: 'local',
          })
          send('processing-done', { subtitles, videoPath: absPath, videoUrl: videoUrl(absPath) })
        } catch (err) {
          send('processing-error', { message: `Failed to load subtitles: ${err.message}` })
        }
        resolve({ hit: false })
      },
      (message) => {
        send('processing-error', { message })
        resolve({ hit: false })
      }
    )
  })
}

function handleYoutube(url, videoId) {
  const cacheDir = cache.getCacheDir()
  cache.ensureCacheDir(cacheDir)
  const key = cache.youtubeKey(videoId)
  const srtFile = cache.srtPath(cacheDir, key)
  const mp4File = cache.mp4Path(cacheDir, videoId)
  const entries = cache.readIndex(cacheDir)

  if (entries[key] && fs.existsSync(srtFile) && fs.existsSync(mp4File)) {
    const subtitles = cache.parseSrt(fs.readFileSync(srtFile, 'utf8'))
    setImmediate(() => send('processing-done', { subtitles, videoPath: mp4File, videoUrl: videoUrl(mp4File) }))
    return { hit: true }
  }

  const { model } = cache.loadSettings()

  return new Promise((resolve) => {
    worker.runYoutube(
      { url, mp4Path: mp4File, srtPath: srtFile, model },
      (progress) => send('processing-progress', progress),
      (_msg) => {
        try {
          const subtitles = cache.parseSrt(fs.readFileSync(srtFile, 'utf8'))
          cache.setEntry(cacheDir, key, {
            title: videoId,
            url,
            date: new Date().toISOString(),
            srt_path: srtFile,
            video_path: mp4File,
            source: 'youtube',
          })
          send('processing-done', { subtitles, videoPath: mp4File, videoUrl: videoUrl(mp4File) })
        } catch (err) {
          send('processing-error', { message: `Failed to load subtitles: ${err.message}` })
        }
        resolve({ hit: false })
      },
      (message) => {
        send('processing-error', { message })
        resolve({ hit: false })
      }
    )
  })
}
