const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { app } = require('electron')

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')
const DEFAULT_CACHE_DIR = 'D:\\translate\\cache'

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
  } catch {
    return { cacheDir: DEFAULT_CACHE_DIR, model: 'base' }
  }
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2))
}

function getCacheDir() {
  return loadSettings().cacheDir
}

function ensureCacheDir(cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true })
}

function isCacheDirWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const test = path.join(dir, '.write-test')
    fs.writeFileSync(test, '')
    fs.unlinkSync(test)
    return true
  } catch {
    return false
  }
}

function localKey(absPath) {
  const hash = crypto.createHash('sha256').update(absPath).digest('hex').slice(0, 16)
  return `local:${hash}`
}

function youtubeKey(videoId) {
  return `yt:${videoId}`
}

function extractVideoId(url) {
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

function keyToFilename(key) {
  // strips "local:" or "yt:" prefix
  return key.replace(/^(local:|yt:)/, '')
}

function indexPath(cacheDir) {
  return path.join(cacheDir, 'index.json')
}

function readIndex(cacheDir) {
  try {
    return JSON.parse(fs.readFileSync(indexPath(cacheDir), 'utf8'))
  } catch {
    return {}
  }
}

function writeIndex(cacheDir, entries) {
  ensureCacheDir(cacheDir)
  fs.writeFileSync(indexPath(cacheDir), JSON.stringify(entries, null, 2))
}

function setEntry(cacheDir, key, data) {
  const entries = readIndex(cacheDir)
  entries[key] = data
  writeIndex(cacheDir, entries)
}

function deleteEntries(cacheDir, keys) {
  const entries = readIndex(cacheDir)
  for (const key of keys) {
    const entry = entries[key]
    if (!entry) continue
    // Always delete the SRT file
    if (entry.srt_path) try { fs.unlinkSync(entry.srt_path) } catch {}
    // Delete the video file only for YouTube entries (local video_path is the user's original)
    if (entry.video_path && entry.source === 'youtube') try { fs.unlinkSync(entry.video_path) } catch {}
    delete entries[key]
  }
  writeIndex(cacheDir, entries)
}

function parseSrt(content) {
  const subtitles = []
  const blocks = content.trim().split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue
    const tsLine = lines[1]
    const match = tsLine.match(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
    )
    if (!match) continue
    const toSec = (h, m, s, ms) => +h * 3600 + +m * 60 + +s + +ms / 1000
    const start = toSec(match[1], match[2], match[3], match[4])
    const end = toSec(match[5], match[6], match[7], match[8])
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim()
    if (text) subtitles.push({ start, end, text })
  }
  return subtitles
}

function srtPath(cacheDir, key) {
  return path.join(cacheDir, keyToFilename(key) + '.srt')
}

function mp4Path(cacheDir, videoId) {
  return path.join(cacheDir, `${videoId}.mp4`)
}

module.exports = {
  loadSettings, saveSettings, getCacheDir, ensureCacheDir, isCacheDirWritable,
  localKey, youtubeKey, extractVideoId, keyToFilename,
  readIndex, writeIndex, setEntry, deleteEntries,
  parseSrt, srtPath, mp4Path,
}
