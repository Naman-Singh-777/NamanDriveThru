import { externalLinks } from './config/externalLinks'
import type { CheckpointId } from './vehicle/checkpoint'
import { playLightspeed } from './vehicle/lightspeed'
import {
  loadManifest,
  trackUrl,
  coverUrl,
  playTrack,
  togglePlayPause,
  playAdjacent,
  seekTo,
  onStateChange,
  getPlaybackState,
  probeDuration,
  type Playlist
} from './vehicle/musicPlayer'

// WEB-PHASE-4: the shared full-screen "glass" overlay all three checkpoints
// open into. DOM/CSS skeleton lives in index.html (same convention as
// touch-controls — see touchControls.ts); this module only wires behaviour
// and fills in content. Scene stays visible/rendering behind it (main.ts's
// animate loop is untouched and keeps running) — the panel is a translucent,
// blurred glass surface over it, not an opaque modal.

const TITLES: Record<CheckpointId, string> = {
  port: 'Projects',
  platform: 'Music',
  city: 'Connect'
}

let overlayEl: HTMLElement
let panelEl: HTMLElement
let titleRowEl: HTMLElement
// WEB-PHASE-4 REDO Phase 9: the main driving-scene canvas -- this, not the
// glass panel, is what gets inverted during a checkpoint visit (see
// requestOpenOverlay/requestCloseOverlay below). The backdrop-filter blur on
// #checkpoint-overlay already samples whatever's behind it, so inverting the
// canvas makes the blurred backdrop read as an inverted parallel-universe
// environment while the panel itself stays a normal, legible glass surface.
let appEl: HTMLElement
let titleEl: HTMLElement
let bodyEl: HTMLElement
let closeBtn: HTMLElement
let openId: CheckpointId | null = null
let onCloseCb: ((closedId: CheckpointId) => void) | null = null

// WEB-PHASE-4 REDO Phase 11: the Platform player's live UI (play/pause icon,
// progress, "now playing" row) subscribes to musicPlayer's onStateChange
// while the player screen is on screen. This holds that subscription's
// unsubscribe function so it can be dropped the moment the player screen
// goes away (back button or overlay close) without stopping playback
// itself -- the persistent <audio> element musicPlayer.ts owns lives
// directly on document.body, entirely outside bodyEl's markup, so clearing
// bodyEl.innerHTML on close never touches it and music keeps playing in the
// background exactly like before, with no DOM-reparenting trick needed.
let platformUnsub: (() => void) | null = null

export function isOverlayOpen(): boolean {
  return openId !== null
}

export function closeOverlay(): void {
  if (openId === null) return
  const closedId = openId
  openId = null
  overlayEl.classList.remove('is-open')
  overlayEl.setAttribute('aria-hidden', 'true')
  titleRowEl.classList.remove('is-port')
  platformUnsub?.()
  platformUnsub = null
  bodyEl.innerHTML = ''
  onCloseCb?.(closedId)
}

// WEB-PHASE-4 REDO Phase 7: a small inline icon in front of every anchor's
// text except the Spotify embeds (per explicit request) -- plain inline SVG,
// no external icon font/image requests, each sized/colored to sit cleanly in
// front of the existing link text. "Icon" strings are simplified brand
// glyphs (GitHub is used for every project link too, since every Port entry
// is a GitHub repo), not pixel-exact logo artwork.
type IconKey = 'github' | 'linkedin' | 'instagram' | 'email' | 'drive' | 'globe'
const ICON_PATHS: Record<IconKey, string> = {
  github:
    '<path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.19-3.37-1.19-.45-1.17-1.11-1.48-1.11-1.48-.91-.64.07-.63.07-.63 1 .07 1.53 1.05 1.53 1.05.89 1.57 2.34 1.12 2.91.86.09-.66.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/>',
  linkedin:
    '<path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45Z"/>',
  instagram:
    '<rect x="3" y="3" width="18" height="18" rx="5" ry="5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor"/>',
  email:
    '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M3.5 5.5h17a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M3 6.5l9 6.5 9-6.5"/>',
  drive:
    '<path fill="#FFC107" d="M7.7 3h8.6l4.3 7.4h-8.6z"/><path fill="#4285F4" d="M12.9 10.4h7.7l-4.3 7.6h-7.7z"/><path fill="#34A853" d="M3 10.4h7.7l-4 7.6H7z"/>',
  globe:
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="none" stroke="currentColor" stroke-width="1.6" d="M3 12h18M12 3c2.6 2.5 2.6 15.5 0 18M12 3c-2.6 2.5-2.6 15.5 0 18"/>'
}
function icon(key: IconKey): string {
  return `<svg class="checkpoint-overlay__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${ICON_PATHS[key]}</svg>`
}

// WEB-PHASE-4 REDO Phase 11: small transport glyphs for the self-hosted
// music player (replacing Spotify's own embedded controls) -- standard,
// generic play/pause/skip pictograms, same inline-SVG convention as icon()
// above, no external icon font/image requests.
type TransportKey = 'play' | 'pause' | 'prev' | 'next'
const TRANSPORT_PATHS: Record<TransportKey, string> = {
  play: '<path fill="currentColor" d="M8 5v14l11-7z"/>',
  pause: '<path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>',
  prev: '<path fill="currentColor" d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>',
  next: '<path fill="currentColor" d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>'
}
function transportIcon(key: TransportKey): string {
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">${TRANSPORT_PATHS[key]}</svg>`
}

// Placeholder cover glyph for a playlist folder with no image file in it
// (e.g. the connected "X's-Cigarettes After Sex" folder) -- a plain music
// note, sized/centered to fill the same cover slot a real cover image would.
function noCoverGlyph(): string {
  return `<svg class="checkpoint-overlay__nocover-icon" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z"/></svg>`
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function renderMessage(msg: string): string {
  return `<p class="checkpoint-overlay__empty">${escapeHtml(msg)}</p>`
}

// GitHub's public REST API has no unauthenticated "pinned repos" endpoint --
// pinned items are GraphQL-only, and GraphQL requires a token this static
// client-side site must never embed (see externalLinks.ts). We used the
// no-auth, read-only community endpoint https://gh-pinned-repos.egoist.dev
// (the same approach most "GitHub pinned repos" profile widgets use), but
// WEB-PHASE-4 REDO Phase 9 confirmed that endpoint is dead (it 404'd on
// every request back then) and WEB-PHASE-4 REDO Phase 18 confirmed it is
// STILL dead, now failing one step earlier with a CORS rejection instead of
// a 404 (the service itself is simply gone, not a rate limit or a config
// issue on our side -- a dead, unreachable third party has nothing to do
// with this site's own security). Calling fetch() against a confirmed-dead
// host only produced a scary-looking (but harmless and already-caught)
// console error on every Port visit for no benefit, so Phase 18 removed the
// live attempt entirely. Port now renders the snapshot below directly --
// the user's actual pinned repos as read directly off their public GitHub
// profile page on 2026-10-03 -- which is NOT the Phase-6 "recently pushed"
// fallback the user asked removed (that showed unrelated, non-pinned
// repos); this is a cached copy of the real pinned list itself. Update this
// array by hand if the pinned repos on github.com/Naman-Singh-777 ever
// change, or restore a live fetch() call in fetchPortProjects() below if a
// working replacement endpoint is ever found.
const PINNED_REPOS_FALLBACK: { name: string; description: string; href: string }[] = [
  { name: 'SmartStack', description: 'A system that reduces AI operational costs by 40-50% through query routing and resource optimization.', href: 'https://github.com/Naman-Singh-777/SmartStack' },
  { name: 'WhereAbouts_SE', description: 'Full-stack college event management platform (Next.js + Supabase) for student event discovery and registration.', href: 'https://github.com/Naman-Singh-777/WhereAbouts_SE' },
  { name: 'Career-Nexus', description: 'AI-powered career trajectory engine (Gemini) that parses resumes and builds learning roadmaps.', href: 'https://github.com/Naman-Singh-777/Career-Nexus' },
  { name: 'NamanDriveThru', description: 'This portfolio website.', href: 'https://github.com/Naman-Singh-777/NamanDriveThru' }
]

async function fetchPortProjects(_username: string): Promise<{ name: string; description: string; href: string }[]> {
  // Confirmed dead (see comment above) -- served directly from the
  // hand-maintained snapshot, no network round-trip, no console noise.
  return PINNED_REPOS_FALLBACK
}

// "Projects" heading with a small clickable GitHub avatar pinned to its far
// right (swapped down from the title row -- see initOverlay below) --
// shared by every renderPort() branch below so all four stay in sync. Only
// ever rendered while a GitHub username is configured (every caller already
// checked that before calling this), so the avatar is unconditional here.
function projectsHeadingHtml(): string {
  const ghUser = externalLinks.githubUsername.trim()
  const ghUrl = externalLinks.social.github || `https://github.com/${ghUser}`
  return `
    <h3 class="checkpoint-overlay__section-heading checkpoint-overlay__section-heading--with-badge">
      Projects
      <a class="checkpoint-overlay__github-badge" href="${ghUrl}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(ghUser)} on GitHub"><img src="https://github.com/${ghUser}.png?size=64" alt="" /></a>
    </h3>`
}

function driveSectionHtml(): string {
  const url = externalLinks.driveUrl?.trim()
  if (!url) return ''
  const label = externalLinks.driveLabel?.trim() || 'Drive'
  return `
    <h3 class="checkpoint-overlay__section-heading">${escapeHtml(label)}</h3>
    <ul class="checkpoint-overlay__menu">
      <li>
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${icon('drive')}${escapeHtml(label)}</a>
        <span class="checkpoint-overlay__desc">Google Drive</span>
      </li>
    </ul>
  `
}

async function renderPort(): Promise<void> {
  const username = externalLinks.githubUsername.trim()
  const drive = driveSectionHtml()
  if (!username) {
    bodyEl.innerHTML = drive || renderMessage('GitHub username not configured yet.')
    return
  }
  bodyEl.innerHTML = `${drive}${projectsHeadingHtml()}<p class="checkpoint-overlay__empty">Loading projects&hellip;</p>`
  try {
    const projects = await fetchPortProjects(username)
    if (openId !== 'port') return // overlay was closed/changed while the fetch was in flight
    if (projects.length === 0) {
      bodyEl.innerHTML = `${drive}${projectsHeadingHtml()}${renderMessage('No pinned repositories found.')}`
      return
    }
    bodyEl.innerHTML = `
      ${drive}
      ${projectsHeadingHtml()}
      <ul class="checkpoint-overlay__menu">
        ${projects
          .map(
            (p) => `
          <li>
            <a href="${escapeHtml(p.href)}" target="_blank" rel="noopener noreferrer">${icon('github')}${escapeHtml(p.name)}</a>
            ${p.description ? `<span class="checkpoint-overlay__desc">${escapeHtml(p.description)}</span>` : ''}
          </li>`
          )
          .join('')}
      </ul>
    `
  } catch {
    if (openId !== 'port') return
    bodyEl.innerHTML = `${drive}${projectsHeadingHtml()}${renderMessage("Couldn't load projects from GitHub right now.")}`
  }
}

// WEB-PHASE-4 REDO Phase 11: Platform's menu of playlists is now backed by
// the local, self-hosted music library instead of Spotify -- each entry is
// one subfolder of public/assets/music/ (auto-discovered at build time by
// scripts/generate-music-manifest.mjs into manifest.json, fetched here via
// musicPlayer.loadManifest()). Dropping a new folder (with a cover image and
// its song files inside it) in is all a future playlist needs; nothing else
// in this file changes. The grid markup/CSS classes below are unchanged
// from the Spotify-era version on purpose (same "exact same UI" look), just
// now fed from local data instead of an async Spotify oEmbed fetch.
async function renderPlatformMenu(landOnPlaying = false): Promise<void> {
  bodyEl.innerHTML = `<h3 class="checkpoint-overlay__section-heading">Playlists</h3><p class="checkpoint-overlay__empty">Loading playlists&hellip;</p>`
  const manifest = await loadManifest()
  if (openId !== 'platform') return // overlay closed/changed while this was in flight
  const playlists = manifest.playlists
  if (playlists.length === 0) {
    bodyEl.innerHTML = renderMessage('No music folders found yet.')
    return
  }
  // Opened with the M shortcut while a song is playing: land straight on that
  // song's playlist. The player's back link still returns to this grid.
  if (landOnPlaying) {
    const playing = getPlaybackState().playlistIdx
    if (playing >= 0 && playing < playlists.length) {
      showPlatformPlayer(playlists, playing)
      return
    }
  }
  bodyEl.innerHTML = `
    <h3 class="checkpoint-overlay__section-heading">Playlists</h3>
    <ul class="checkpoint-overlay__spotify-menu">
      ${playlists
        .map((p, i) => {
          const cover = coverUrl(p)
          return `
        <li class="checkpoint-overlay__spotify-card" data-playlist-index="${i}" tabindex="0" role="button">
          <span class="checkpoint-overlay__spotify-cover"${cover ? ` style="background-image:url('${cover.replace(/'/g, '%27')}')"` : ''}>${cover ? '' : noCoverGlyph()}</span>
          <span class="checkpoint-overlay__spotify-title">${escapeHtml(p.title)}</span>
        </li>`
        })
        .join('')}
    </ul>
  `
  const cards = Array.from(bodyEl.querySelectorAll<HTMLLIElement>('.checkpoint-overlay__spotify-card'))
  cards.forEach((card, i) => {
    const activate = () => {
      if (openId !== 'platform') return
      showPlatformPlayer(playlists, i)
    }
    card.addEventListener('click', activate)
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        activate()
      }
    })
  })
}

// WEB-PHASE-4 REDO Phase 11: replaces the old single-persistent-Spotify-
// iframe player with a custom transport UI driven by musicPlayer.ts's
// persistent <audio> engine (HRTF-panned + synthesized-reverb "surround"
// signal chain, ducking the map's own SFX while playing). The <audio>
// element itself lives outside this panel's markup (appended straight to
// document.body by musicPlayer.ts), so it is never touched when bodyEl is
// wiped on back-navigation or overlay close -- playback keeps going in the
// background exactly like the old iframe-parking trick did, without any
// DOM reparenting needed here.
function showPlatformPlayer(playlists: Playlist[], playlistIdx: number): void {
  platformUnsub?.()
  platformUnsub = null
  const playlist = playlists[playlistIdx]
  const cover = coverUrl(playlist)

  bodyEl.innerHTML = `
    <button type="button" class="checkpoint-overlay__back-link">&larr; Back to playlists</button>
    <div class="checkpoint-overlay__player">
      <div class="checkpoint-overlay__player-cover"${cover ? ` style="background-image:url('${cover.replace(/'/g, '%27')}')"` : ''}>${cover ? '' : noCoverGlyph()}</div>
      <div class="checkpoint-overlay__player-title">${escapeHtml(playlist.title)}</div>
      <div class="checkpoint-overlay__transport">
        <button type="button" class="checkpoint-overlay__transport-btn" data-action="prev" aria-label="Previous track">${transportIcon('prev')}</button>
        <button type="button" class="checkpoint-overlay__transport-btn checkpoint-overlay__transport-btn--play" data-action="toggle" aria-label="Play">${transportIcon('play')}</button>
        <button type="button" class="checkpoint-overlay__transport-btn" data-action="next" aria-label="Next track">${transportIcon('next')}</button>
      </div>
      <div class="checkpoint-overlay__scrub-row">
        <span class="checkpoint-overlay__time" data-time="current">0:00</span>
        <input type="range" class="checkpoint-overlay__scrubber" min="0" max="1000" value="0" aria-label="Seek" />
        <span class="checkpoint-overlay__time" data-time="total">0:00</span>
      </div>
    </div>
    <ul class="checkpoint-overlay__tracklist">
      ${playlist.tracks
        .map(
          (t, i) => `
        <li class="checkpoint-overlay__track" data-track-index="${i}" tabindex="0" role="button">
          <span class="checkpoint-overlay__track-num">${i + 1}</span>
          <span class="checkpoint-overlay__track-title">${escapeHtml(t.title)}</span>
          <span class="checkpoint-overlay__track-duration" data-duration-index="${i}">&hellip;</span>
        </li>`
        )
        .join('')}
    </ul>
  `

  bodyEl.querySelector('.checkpoint-overlay__back-link')!.addEventListener('click', () => {
    if (openId !== 'platform') return
    platformUnsub?.()
    platformUnsub = null
    void renderPlatformMenu()
  })

  const playerEl = bodyEl.querySelector<HTMLElement>('.checkpoint-overlay__player')!
  const toggleBtn = playerEl.querySelector<HTMLButtonElement>('[data-action="toggle"]')!
  const prevBtn = playerEl.querySelector<HTMLButtonElement>('[data-action="prev"]')!
  const nextBtn = playerEl.querySelector<HTMLButtonElement>('[data-action="next"]')!
  const scrubberEl = playerEl.querySelector<HTMLInputElement>('.checkpoint-overlay__scrubber')!
  const curTimeEl = playerEl.querySelector<HTMLElement>('[data-time="current"]')!
  const totalTimeEl = playerEl.querySelector<HTMLElement>('[data-time="total"]')!
  const trackRows = Array.from(bodyEl.querySelectorAll<HTMLLIElement>('.checkpoint-overlay__track'))

  let scrubbing = false

  const startOrToggle = () => {
    const state = getPlaybackState()
    if (state.playlistIdx === playlistIdx && state.trackIdx !== -1) togglePlayPause()
    else void playTrack(playlist, playlistIdx, 0)
  }
  toggleBtn.addEventListener('click', startOrToggle)
  prevBtn.addEventListener('click', () => playAdjacent(-1))
  nextBtn.addEventListener('click', () => playAdjacent(1))
  scrubberEl.addEventListener('input', () => {
    scrubbing = true
  })
  scrubberEl.addEventListener('change', () => {
    seekTo(Number(scrubberEl.value) / 1000)
    scrubbing = false
  })

  trackRows.forEach((row, i) => {
    const activate = () => void playTrack(playlist, playlistIdx, i)
    row.addEventListener('click', activate)
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        activate()
      }
    })
  })

  // Lazy per-track duration, same pattern Spotify's own tracklist used to
  // show -- probed from a detached, never-played <audio>, not ffprobe.
  // WEB-PHASE-4 REDO Phase 13 (perf): throttled to a handful of concurrent
  // probes instead of firing every track's metadata fetch in one burst --
  // a large playlist (e.g. 17 tracks) was opening that many simultaneous
  // requests, which is what actually made opening it feel sluggish (the
  // manifest/cover payloads themselves are a few KB each and were never the
  // bottleneck).
  const DURATION_PROBE_CONCURRENCY = 4
  let probeCursor = 0
  const probeNext = (): void => {
    const i = probeCursor++
    if (i >= playlist.tracks.length || openId !== 'platform') return
    void probeDuration(trackUrl(playlist, playlist.tracks[i])).then((d) => {
      if (openId !== 'platform') return
      const el = bodyEl.querySelector<HTMLElement>(`[data-duration-index="${i}"]`)
      if (el) el.textContent = d !== null ? formatTime(d) : '--:--'
      probeNext()
    })
  }
  for (let k = 0; k < Math.min(DURATION_PROBE_CONCURRENCY, playlist.tracks.length); k++) probeNext()

  function sync(): void {
    const state = getPlaybackState()
    const isThis = state.playlistIdx === playlistIdx
    toggleBtn.innerHTML = isThis && state.isPlaying ? transportIcon('pause') : transportIcon('play')
    toggleBtn.setAttribute('aria-label', isThis && state.isPlaying ? 'Pause' : 'Play')
    trackRows.forEach((row, i) => row.classList.toggle('is-playing', isThis && state.trackIdx === i))
    if (isThis) {
      curTimeEl.textContent = formatTime(state.currentTime)
      totalTimeEl.textContent = formatTime(state.duration)
      if (!scrubbing) scrubberEl.value = String(state.duration > 0 ? Math.round((state.currentTime / state.duration) * 1000) : 0)
    } else {
      curTimeEl.textContent = '0:00'
      totalTimeEl.textContent = '0:00'
      if (!scrubbing) scrubberEl.value = '0'
    }
  }

  platformUnsub = onStateChange(sync)
  sync()
}

function renderPlatform(landOnPlaying: boolean): void {
  void renderPlatformMenu(landOnPlaying)
}

// WEB-PHASE-4 REDO Phase 15: an email entry copies the address to the
// clipboard instead of opening a mailto: link, which otherwise just dumps
// the visitor on whatever "choose a mail app" prompt their OS/browser has
// -- per explicit request. Every other entry still opens its real link.
interface CityEntry {
  label: string
  icon: IconKey
  href?: string
  copy?: string
}

function renderCity(): void {
  const s = externalLinks.social
  const github = s.github || (externalLinks.githubUsername ? `https://github.com/${externalLinks.githubUsername}` : '')
  const entries: CityEntry[] = []
  if (github) entries.push({ label: 'GitHub', href: github, icon: 'github' })
  if (s.linkedin) entries.push({ label: 'LinkedIn', href: s.linkedin, icon: 'linkedin' })
  if (s.instagram) entries.push({ label: 'Instagram', href: s.instagram, icon: 'instagram' })
  if (s.email) entries.push({ label: 'Email', copy: s.email, icon: 'email' })
  if (s.email2) entries.push({ label: 'Email (alt)', copy: s.email2, icon: 'email' })

  if (entries.length === 0) {
    bodyEl.innerHTML = renderMessage('Social links not configured yet.')
    return
  }
  bodyEl.innerHTML = `
    <ul class="checkpoint-overlay__social">
      ${entries
        .map((e, i) =>
          e.copy
            ? `<li><button type="button" class="checkpoint-overlay__copy-btn" data-copy-index="${i}">${icon(e.icon)}${escapeHtml(e.label)}</button><span class="checkpoint-overlay__desc" data-copy-feedback="${i}">Click to copy</span></li>`
            : `<li><a href="${escapeHtml(e.href!)}" target="_blank" rel="noopener noreferrer">${icon(e.icon)}${escapeHtml(e.label)}</a></li>`
        )
        .join('')}
    </ul>
  `
  bodyEl.querySelectorAll<HTMLButtonElement>('[data-copy-index]').forEach((btn) => {
    const entry = entries[Number(btn.dataset.copyIndex)]
    if (!entry.copy) return
    const address = entry.copy
    btn.addEventListener('click', () => {
      void navigator.clipboard
        .writeText(address)
        .then(() => {
          const fb = bodyEl.querySelector(`[data-copy-feedback="${btn.dataset.copyIndex}"]`)
          if (!fb) return
          fb.textContent = 'Copied!'
          window.setTimeout(() => {
            fb.textContent = 'Click to copy'
          }, 1500)
        })
        .catch(() => {
          // Clipboard permission denied/unavailable -- harmless no-op, the
          // address is still shown right there to select and copy by hand.
        })
    })
  })
}

export function openOverlay(id: CheckpointId, opts: { landOnPlaying?: boolean } = {}): void {
  if (openId === id) return
  openId = id
  titleEl.textContent = TITLES[id]
  overlayEl.classList.add('is-open')
  overlayEl.setAttribute('aria-hidden', 'false')
  titleRowEl.classList.toggle('is-port', id === 'port')

  if (id === 'port') void renderPort()
  else if (id === 'platform') renderPlatform(!!opts.landOnPlaying)
  else renderCity()
}

// WEB-PHASE-4 REDO Phase 7: guards the one in-flight open/close transition at
// a time -- a second ENTER/ESC/click mid-flash is simply ignored rather than
// overlapping two 1s animations or double-firing open/close.
let transitioning = false

// True from the moment a menu starts opening until it has fully closed. The
// fullscreen Escape counter uses it so an Escape that belongs to a menu is
// never counted toward leaving fullscreen.
export function isOverlayBusy(): boolean {
  return openId !== null || transitioning
}

// The real entry point from main.ts's ENTER handler now (replacing a direct
// openOverlay call): plays the light-speed flash first, and only once it's
// done does the overlay actually open, with its background inverted for as
// long as it stays open (both per explicit request).
export function requestOpenOverlay(id: CheckpointId, opts: { landOnPlaying?: boolean } = {}): void {
  if (transitioning || openId === id) return
  transitioning = true
  void playLightspeed().then(() => {
    openOverlay(id, opts)
    appEl.classList.add('is-inverted')
    transitioning = false
  })
}

// The real entry point for every close trigger (ESC, X, backdrop) now: plays
// the light-speed flash first (hiding the cut back to normal colors), then
// actually closes -- driving resumes exactly when that finishes, "keep
// moving on" right after the flash.
function requestCloseOverlay(): void {
  if (transitioning || openId === null) return
  transitioning = true
  void playLightspeed().then(() => {
    appEl.classList.remove('is-inverted')
    closeOverlay()
    transitioning = false
  })
}

// onClose: called whenever the overlay actually closes (after the closing
// light-speed flash finishes) — the caller (main.ts) uses it to know
// playback/driving focus has returned to the 3D scene, without this module
// needing to know anything about checkpoints.
export function initOverlay(onClose: (closedId: CheckpointId) => void): void {
  overlayEl = document.getElementById('checkpoint-overlay')!
  panelEl = document.getElementById('checkpoint-overlay-panel')!
  titleRowEl = document.getElementById('checkpoint-overlay-title-row')!
  titleEl = document.getElementById('checkpoint-overlay-title')!
  bodyEl = document.getElementById('checkpoint-overlay-body')!
  closeBtn = document.getElementById('checkpoint-overlay-close')!
  appEl = document.getElementById('app')!
  onCloseCb = onClose

 closeBtn.addEventListener('click', requestCloseOverlay)
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) requestCloseOverlay() // backdrop click, not the panel itself
  })
  panelEl.addEventListener('click', (e) => e.stopPropagation())
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && isOverlayOpen()) requestCloseOverlay()
  })
}

// Everything the Platform and Port menus need is fetched while the world is still loading, so the
// playlists, covers, durations and the GitHub avatar are already there when the car reaches a
// checkpoint. Nothing here opens or changes a menu.
const warmed: (HTMLImageElement | undefined)[] = []
export function preloadOverlayData(): void {
  const ghUser = externalLinks.githubUsername.trim()
  if (ghUser) {
    const avatar = new Image()
    avatar.decoding = 'async'
    avatar.src = `https://github.com/${ghUser}.png?size=64`
    warmed.push(avatar)
  }
  void loadManifest().then((m) => {
    for (const p of m.playlists) {
      const cover = coverUrl(p)
      if (!cover) continue
      const img = new Image()
      img.decoding = 'async'
      img.src = cover
      warmed.push(img)
    }
  })
}

// Track lengths are read from each file's header, which is slow for files that keep it at the end. Doing
// it right after the world has loaded (while the tutorial is on screen) means the track list already
// shows every length. Two at a time, so it never competes with playback.
export function warmTrackDurations(): void {
  void loadManifest().then(async (m) => {
    const urls = m.playlists.flatMap((p) => p.tracks.map((t) => trackUrl(p, t)))
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < urls.length) await probeDuration(urls[next++])
    }
    await Promise.all([worker(), worker()])
  })
}
