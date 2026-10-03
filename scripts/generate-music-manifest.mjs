// WEB-PHASE-4 REDO Phase 11: zero-config music auto-discovery. Run before
// `dev`/`build` (see package.json's pre* hooks) so dropping a new folder
// into public/assets/music/ -- containing audio files and (optionally) one
// cover image -- makes it show up as a new Platform playlist with no code
// or config change. Every folder directly under public/assets/music/ is one
// playlist; its own name IS the playlist title, verbatim.
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const MUSIC_DIR = join(PROJECT_ROOT, 'public', 'assets', 'music')
const OUT_PATH = join(MUSIC_DIR, 'manifest.json')

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.opus', '.ogg', '.wav', '.flac', '.webm'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

function ext(name) {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i).toLowerCase()
}

// "01 - Track Name" / "01. Track Name" / "01_Track Name" -> leading numeric
// prefix stripped for display; the number itself is also what tracks sort
// by, so re-ordering a playlist is just renumbering the files on disk.
const TRACK_PREFIX = /^\s*(\d+)\s*[-._]\s*/
function parseTrack(filename) {
  const base = filename.slice(0, filename.length - ext(filename).length)
  const m = base.match(TRACK_PREFIX)
  return { order: m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER, title: m ? base.slice(m[0].length) : base }
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

const playlists = []
for (const folder of safeReaddir(MUSIC_DIR).sort((a, b) => a.localeCompare(b))) {
  const dir = join(MUSIC_DIR, folder)
  if (!statSync(dir).isDirectory()) continue

  const entries = safeReaddir(dir)
  let cover = null
  const trackFiles = []
  for (const entry of entries) {
    const e = ext(entry)
    if (IMAGE_EXTS.has(e) && !cover) cover = entry
    else if (AUDIO_EXTS.has(e)) trackFiles.push(entry)
  }
  if (trackFiles.length === 0) continue // not a playlist folder -- skip silently

  const tracks = trackFiles
    .map((file) => {
      const { order, title } = parseTrack(file)
      return { file, title, order }
    })
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.title.localeCompare(b.title)))
    .map(({ file, title }) => ({ file, title }))

  playlists.push({ folder, title: folder, cover, tracks })
}

writeFileSync(OUT_PATH, JSON.stringify({ playlists }, null, 2))
console.log(`[music-manifest] ${playlists.length} playlist(s), ${playlists.reduce((n, p) => n + p.tracks.length, 0)} track(s) -> ${OUT_PATH}`)
