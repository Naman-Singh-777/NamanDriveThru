import { getSharedAudioContext, setSfxDucking } from './checkpointAudio'

// WEB-PHASE-4 REDO Phase 11: self-hosted music, replacing the Spotify embed
// entirely. One real <audio> element, created once and never destroyed, so
// playback survives closing the menu -- same spirit as the old Spotify
// <iframe> persistence, but a native <audio> element doesn't need any of the
// lazy-load/off-screen-position workarounds that required, since the browser
// never throttles first-party media playback for being off-screen.
//
// Content is 100% auto-discovered: scripts/generate-music-manifest.mjs scans
// public/assets/music/<folder>/ for audio files + one cover image per folder
// and writes manifest.json before every dev/build. Dropping in a new folder
// is the entire workflow -- nothing in this file or externalLinks.ts needs
// to change.

export interface Track {
  file: string
  title: string
}
export interface Playlist {
  folder: string
  title: string
  cover: string | null
  tracks: Track[]
}
interface Manifest {
  playlists: Playlist[]
}

const MUSIC_BASE = 'assets/music'

let manifestPromise: Promise<Manifest> | null = null
let currentManifest: Manifest | null = null

export function loadManifest(): Promise<Manifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${MUSIC_BASE}/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : { playlists: [] }))
      .catch(() => ({ playlists: [] }))
      .then((m) => {
        currentManifest = m
        return m
      })
  }
  return manifestPromise
}

export function trackUrl(playlist: Playlist, track: Track): string {
  return encodeURI(`${MUSIC_BASE}/${playlist.folder}/${track.file}`)
}

export function coverUrl(playlist: Playlist): string | null {
  return playlist.cover ? encodeURI(`${MUSIC_BASE}/${playlist.folder}/${playlist.cover}`) : null
}

// ---------------------------------------------------------------------------
// Persistent playback engine
// ---------------------------------------------------------------------------

let audioEl: HTMLAudioElement | null = null
let panner: PannerNode | null = null
let orbitRaf: number | null = null
let currentPlaylistIdx = -1
let currentTrackIdx = -1

type Listener = () => void
const listeners = new Set<Listener>()
export function onStateChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify(): void {
  for (const l of listeners) l()
}

// A short, synthesized reverb tail -- same "procedural, nothing to host"
// approach checkpointAudio.ts already uses for its noise buffer, rather than
// shipping a recorded impulse-response audio file.
function buildImpulseResponse(ctx: AudioContext): AudioBuffer {
  const duration = 1.6
  const len = Math.floor(ctx.sampleRate * duration)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      const t = i / len
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2)
    }
  }
  return buf
}

// WEB-PHASE-4 REDO Phase 11: "surround sound" via the real technology a
// browser tab actually has for it. There's no way for a web page to drive
// discrete 5.1/7.1 hardware channels, so this uses the Web Audio API's HRTF
// spatial panner -- true binaural 3D positioning rendered over ordinary
// stereo output -- plus a short synthesized reverb for width/depth. The
// panner's position is slowly and continuously orbited around the listener
// so the music has an actual, audible sense of space and movement (on
// headphones especially) rather than sitting statically in the middle.
function ensureEngine(): void {
  if (audioEl) return
  const ctx = getSharedAudioContext()

  audioEl = new Audio()
  audioEl.crossOrigin = 'anonymous'
  audioEl.preload = 'auto'
  audioEl.style.display = 'none'
  document.body.appendChild(audioEl)

  const source = ctx.createMediaElementSource(audioEl)
  panner = ctx.createPanner()
  panner.panningModel = 'HRTF'
  panner.distanceModel = 'inverse'
  panner.refDistance = 1.2
  panner.maxDistance = 20

  const convolver = ctx.createConvolver()
  convolver.buffer = buildImpulseResponse(ctx)
  convolver.normalize = true
  const wetGain = ctx.createGain()
  wetGain.gain.value = 0.16 // subtle -- adds width, not a drenched reverb
  const dryGain = ctx.createGain()
  dryGain.gain.value = 1

  const musicGain = ctx.createGain()
  musicGain.gain.value = 0.85

  source.connect(panner)
  panner.connect(dryGain)
  panner.connect(convolver)
  convolver.connect(wetGain)
  dryGain.connect(musicGain)
  wetGain.connect(musicGain)
  musicGain.connect(ctx.destination)

  let orbitT = 0
  const orbit = () => {
    orbitT += 1 / 60
    const angle = orbitT * 0.12 // slow drift -- a full lap takes roughly 50s
    panner!.positionX.value = Math.sin(angle) * 1.6
    panner!.positionZ.value = Math.cos(angle) * 1.6 - 1
    panner!.positionY.value = Math.sin(angle * 0.5) * 0.4
    orbitRaf = requestAnimationFrame(orbit)
  }
  orbit()

  // Map sound effects (checkpoint proximity/activation cues) duck to a lower
  // volume while music is actually audible, and recover once it isn't --
  // the explicit "sound effects of the map at a lower volume" request.
  audioEl.addEventListener('play', () => {
    setSfxDucking(true)
    notify()
  })
  audioEl.addEventListener('pause', () => {
    setSfxDucking(false)
    notify()
  })
  audioEl.addEventListener('ended', () => void playNextInCurrent())
  audioEl.addEventListener('timeupdate', notify)
  audioEl.addEventListener('loadedmetadata', notify)

  window.addEventListener('beforeunload', () => {
    if (orbitRaf !== null) cancelAnimationFrame(orbitRaf)
  })
}

export async function playTrack(playlist: Playlist, playlistIdx: number, trackIdx: number): Promise<void> {
  ensureEngine()
  const ctx = getSharedAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  currentPlaylistIdx = playlistIdx
  currentTrackIdx = trackIdx
  const track = playlist.tracks[trackIdx]
  audioEl!.src = trackUrl(playlist, track)
  try {
    await audioEl!.play()
  } catch {
    // Autoplay-policy rejection (no user gesture yet) -- the selection still
    // registers so the UI shows the right track queued up; pressing play
    // (itself a gesture) succeeds immediately after.
  }
  notify()
}

export function togglePlayPause(): void {
  if (!audioEl) return
  if (audioEl.paused) void audioEl.play()
  else audioEl.pause()
}

export function seekTo(fraction: number): void {
  if (!audioEl || !isFinite(audioEl.duration) || audioEl.duration <= 0) return
  audioEl.currentTime = fraction * audioEl.duration
}

export function playAdjacent(dir: 1 | -1): void {
  if (!currentManifest || currentPlaylistIdx === -1) return
  const playlist = currentManifest.playlists[currentPlaylistIdx]
  const next = currentTrackIdx + dir
  if (next < 0 || next >= playlist.tracks.length) return
  void playTrack(playlist, currentPlaylistIdx, next)
}

async function playNextInCurrent(): Promise<void> {
  if (!currentManifest || currentPlaylistIdx === -1) return
  const playlist = currentManifest.playlists[currentPlaylistIdx]
  const next = currentTrackIdx + 1
  if (next < playlist.tracks.length) await playTrack(playlist, currentPlaylistIdx, next)
}

export interface PlaybackState {
  playlistIdx: number
  trackIdx: number
  isPlaying: boolean
  currentTime: number
  duration: number
}

export function getPlaybackState(): PlaybackState {
  return {
    playlistIdx: currentPlaylistIdx,
    trackIdx: currentTrackIdx,
    isPlaying: !!audioEl && !audioEl.paused,
    currentTime: audioEl?.currentTime ?? 0,
    duration: audioEl && isFinite(audioEl.duration) ? audioEl.duration : 0
  }
}

// Lightweight metadata-only probe (never attached to the page, never
// played) so the track list can show each track's real duration up front,
// the way the old Spotify embed's own list did -- preload="metadata" only
// pulls the file's header, not the whole track.
const durationCache = new Map<string, number>()
export function probeDuration(url: string): Promise<number | null> {
  const cached = durationCache.get(url)
  if (cached !== undefined) return Promise.resolve(cached)
  return new Promise((resolve) => {
    const probe = new Audio()
    probe.preload = 'metadata'
    const cleanup = () => {
      probe.removeEventListener('loadedmetadata', onLoaded)
      probe.removeEventListener('error', onError)
    }
    const onLoaded = () => {
      const d = isFinite(probe.duration) ? probe.duration : null
      if (d !== null) durationCache.set(url, d)
      cleanup()
      resolve(d)
    }
    const onError = () => {
      cleanup()
      resolve(null)
    }
    probe.addEventListener('loadedmetadata', onLoaded)
    probe.addEventListener('error', onError)
    probe.src = url
  })
}
