import { externalLinks } from './config/externalLinks'
import type { CheckpointId } from './vehicle/checkpoint'
import { playLightspeed } from './vehicle/lightspeed'

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
let titleEl: HTMLElement
let bodyEl: HTMLElement
let closeBtn: HTMLElement
// Persistent, off-screen (not display:none — see index.html CSS) home for
// each Spotify embed iframe. Moving an iframe between DOM parents does not
// reload it in any evergreen browser, so parking it here on close (instead
// of ever letting innerHTML wipe it) is what makes the music keep playing in
// the background while driving, exactly like leaving a Spotify tab open —
// no Web Playback SDK / OAuth needed for that.
let platformHolderEl: HTMLElement
let openId: CheckpointId | null = null
let onCloseCb: (() => void) | null = null

// One real <iframe> per configured embed, created once and cached by id so
// re-opening Platform (or closing it) never recreates/reloads it.
const platformIframes = new Map<string, HTMLIFrameElement>()

function getOrCreatePlatformIframe(type: string, id: string): HTMLIFrameElement {
  let el = platformIframes.get(id)
  if (!el) {
    el = document.createElement('iframe')
    el.className = 'checkpoint-overlay__spotify'
    el.src = `https://open.spotify.com/embed/${type}/${encodeURIComponent(id)}?utm_source=generator&theme=0`
    el.width = '100%'
    el.height = '352'
    el.style.border = '0'
    // WEB-PHASE-4 REDO Phase 7: NOT 'lazy' -- the browser's native iframe
    // lazy-loading treats an element parked far outside the viewport (the
    // off-screen holder below) as "not worth loading/keeping active", which
    // is exactly what was silently pausing playback while driving with the
    // overlay closed. 'eager' plus keeping the holder inside real viewport
    // bounds (see .checkpoint-platform-holder in index.html) is what
    // actually keeps this iframe alive in the background.
    el.loading = 'eager'
    el.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture'
    platformIframes.set(id, el)
  }
  return el
}

export function isOverlayOpen(): boolean {
  return openId !== null
}

export function closeOverlay(): void {
  if (openId === null) return
  const wasPlatform = openId === 'platform'
  openId = null
  overlayEl.classList.remove('is-open')
  overlayEl.setAttribute('aria-hidden', 'true')
  if (wasPlatform) {
    // Reparent every live Spotify iframe back into the off-screen holder
    // BEFORE wiping bodyEl, so clearing bodyEl's markup never touches (and
    // never destroys/reloads) the iframes themselves — playback continues.
    for (const el of platformIframes.values()) platformHolderEl.appendChild(el)
  }
  bodyEl.innerHTML = ''
  onCloseCb?.()
}

// WEB-PHASE-4 REDO Phase 7: a small inline icon in front of every anchor's
// text except the Spotify embeds (per explicit request) -- plain inline SVG,
// no external icon font/image requests, each sized/colored to sit cleanly in
// front of the existing link text. "Icon" strings are simplified brand
// glyphs (GitHub is used for every project link too, since every Port entry
// is a GitHub repo), not pixel-exact logo artwork.
type IconKey = 'github' | 'linkedin' | 'instagram' | 'email' | 'drive'
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
    '<path fill="#FFC107" d="M7.7 3h8.6l4.3 7.4h-8.6z"/><path fill="#4285F4" d="M12.9 10.4h7.7l-4.3 7.6h-7.7z"/><path fill="#34A853" d="M3 10.4h7.7l-4 7.6H7z"/>'
}
function icon(key: IconKey): string {
  return `<svg class="checkpoint-overlay__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${ICON_PATHS[key]}</svg>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function renderMessage(msg: string): string {
  return `<p class="checkpoint-overlay__empty">${escapeHtml(msg)}</p>`
}

// GitHub's public REST API has no unauthenticated "pinned repos" endpoint —
// pinned items are GraphQL-only, and GraphQL requires a token this static
// client-side site must never embed (see externalLinks.ts). We use the
// no-auth, read-only community endpoint below (the same approach most
// "GitHub pinned repos" profile widgets use). WEB-PHASE-4 REDO Phase 7: the
// earlier "recently pushed" fallback is REMOVED per explicit request — Port
// must only ever show repos actually pinned on the GitHub profile, never a
// substitute list; if the pinned endpoint is unreachable or empty this now
// surfaces an honest "couldn't load" message instead (see renderPort below),
// rather than silently showing non-pinned repos.
async function fetchPortProjects(username: string): Promise<{ name: string; description: string; href: string }[]> {
  const res = await fetch(`https://gh-pinned-repos.egoist.dev/?username=${encodeURIComponent(username)}`)
  if (!res.ok) throw new Error(`pinned endpoint ${res.status}`)
  const pinned = (await res.json()) as { repo: string; owner: string; description: string | null }[]
  if (!Array.isArray(pinned)) throw new Error('malformed pinned list')

  return Promise.all(
    pinned.map(async (p) => {
      const owner = p.owner || username
      let href = `https://github.com/${owner}/${p.repo}`
      let description = p.description || ''
      try {
        const detail = await fetch(`https://api.github.com/repos/${owner}/${p.repo}`)
        if (detail.ok) {
          const d = (await detail.json()) as { homepage?: string | null; html_url: string; description?: string | null }
          if (d.homepage && d.homepage.trim()) href = d.homepage.trim()
          else href = d.html_url
          description = description || d.description || ''
        }
      } catch {
        // homepage lookup failed — keep the plain repo link already set above
      }
      return { name: p.repo, description, href }
    })
  )
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
  bodyEl.innerHTML = `${drive}<h3 class="checkpoint-overlay__section-heading">Projects</h3><p class="checkpoint-overlay__empty">Loading projects&hellip;</p>`
  try {
    const projects = await fetchPortProjects(username)
    if (openId !== 'port') return // overlay was closed/changed while the fetch was in flight
    if (projects.length === 0) {
      bodyEl.innerHTML = `${drive}<h3 class="checkpoint-overlay__section-heading">Projects</h3>${renderMessage('No pinned repositories found.')}`
      return
    }
    bodyEl.innerHTML = `
      ${drive}
      <h3 class="checkpoint-overlay__section-heading">Projects</h3>
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
    bodyEl.innerHTML = `${drive}<h3 class="checkpoint-overlay__section-heading">Projects</h3>${renderMessage("Couldn't load projects from GitHub right now.")}`
  }
}

// WEB-PHASE-4 REDO Phase 6: Platform now opens into a browsable menu of
// configured albums/playlists (cover art + title, fetched from Spotify's own
// public no-auth oEmbed endpoint — no API key/OAuth, same spirit as the
// embed widget itself) and only shows a specific player once one is picked —
// "the songs come after". Adding a new entry to externalLinks.spotifyEmbeds
// is all a future playlist needs; nothing else in this file changes.
interface SpotifyOEmbedInfo {
  title: string
  thumbnailUrl: string
}
const oEmbedCache = new Map<string, SpotifyOEmbedInfo>()

async function fetchSpotifyOEmbed(type: string, id: string): Promise<SpotifyOEmbedInfo | null> {
  const cached = oEmbedCache.get(id)
  if (cached) return cached
  try {
    const canonical = `https://open.spotify.com/${type}/${id}`
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonical)}`)
    if (!res.ok) return null
    const data = await res.json()
    const info: SpotifyOEmbedInfo = { title: typeof data.title === 'string' ? data.title : 'Untitled', thumbnailUrl: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : '' }
    oEmbedCache.set(id, info)
    return info
  } catch {
    return null
  }
}

// Moves every cached Spotify iframe back into the off-screen holder — same
// "never destroy, just reparent" technique closeOverlay() already uses, so
// whatever is playing keeps playing uninterrupted while browsing the menu or
// switching to a different playlist.
function parkAllPlatformIframes(): void {
  for (const el of platformIframes.values()) platformHolderEl.appendChild(el)
}

async function renderPlatformMenu(): Promise<void> {
  const embeds = externalLinks.spotifyEmbeds
  parkAllPlatformIframes()
  if (embeds.length === 0) {
    bodyEl.innerHTML = renderMessage('Spotify not configured yet.')
    return
  }
  bodyEl.innerHTML = `
    <h3 class="checkpoint-overlay__section-heading">Playlists</h3>
    <ul class="checkpoint-overlay__spotify-menu">
      ${embeds
        .map(
          (e, i) => `
        <li class="checkpoint-overlay__spotify-card" data-embed-index="${i}" tabindex="0" role="button">
          <span class="checkpoint-overlay__spotify-cover" data-cover-index="${i}"></span>
          <span class="checkpoint-overlay__spotify-title" data-title-index="${i}">Loading&hellip;</span>
        </li>`
        )
        .join('')}
    </ul>
  `
  const cards = Array.from(bodyEl.querySelectorAll<HTMLLIElement>('.checkpoint-overlay__spotify-card'))
  cards.forEach((card, i) => {
    const activate = () => {
      if (openId !== 'platform') return
      showPlatformPlayer(embeds[i].type, embeds[i].id)
    }
    card.addEventListener('click', activate)
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        activate()
      }
    })
  })
  for (let i = 0; i < embeds.length; i++) {
    const embed = embeds[i]
    void fetchSpotifyOEmbed(embed.type, embed.id).then((info) => {
      if (openId !== 'platform') return // overlay closed/changed while this was in flight
      const coverEl = bodyEl.querySelector<HTMLElement>(`[data-cover-index="${i}"]`)
      const titleEl2 = bodyEl.querySelector<HTMLElement>(`[data-title-index="${i}"]`)
      if (!coverEl || !titleEl2) return // menu already replaced by a selected player
      if (info) {
        if (info.thumbnailUrl) coverEl.style.backgroundImage = `url('${info.thumbnailUrl.replace(/'/g, "%27")}')`
        titleEl2.textContent = info.title
      } else {
        titleEl2.textContent = embed.type.charAt(0).toUpperCase() + embed.type.slice(1)
      }
    })
  }
}

function showPlatformPlayer(type: string, id: string): void {
  const iframe = getOrCreatePlatformIframe(type, id)
  bodyEl.innerHTML = `
    <button type="button" class="checkpoint-overlay__back-link">&larr; Back to playlists</button>
    <div class="checkpoint-overlay__spotify-player"></div>
  `
  bodyEl.querySelector('.checkpoint-overlay__spotify-player')!.appendChild(iframe) // same node — playback untouched
  bodyEl.querySelector('.checkpoint-overlay__back-link')!.addEventListener('click', () => {
    if (openId !== 'platform') return
    void renderPlatformMenu()
  })
}

function renderPlatform(): void {
  void renderPlatformMenu()
}

function renderCity(): void {
  const s = externalLinks.social
  const github = s.github || (externalLinks.githubUsername ? `https://github.com/${externalLinks.githubUsername}` : '')
  const entries: { label: string; href: string; icon: IconKey }[] = []
  if (github) entries.push({ label: 'GitHub', href: github, icon: 'github' })
  if (s.linkedin) entries.push({ label: 'LinkedIn', href: s.linkedin, icon: 'linkedin' })
  if (s.instagram) entries.push({ label: 'Instagram', href: s.instagram, icon: 'instagram' })
  if (s.email) entries.push({ label: 'Email', href: `mailto:${s.email}`, icon: 'email' })
  if (s.email2) entries.push({ label: 'Email (alt)', href: `mailto:${s.email2}`, icon: 'email' })

  if (entries.length === 0) {
    bodyEl.innerHTML = renderMessage('Social links not configured yet.')
    return
  }
  bodyEl.innerHTML = `
    <ul class="checkpoint-overlay__social">
      ${entries
        .map(
          (e) => `<li><a href="${escapeHtml(e.href)}" target="_blank" rel="noopener noreferrer">${icon(e.icon)}${escapeHtml(e.label)}</a></li>`
        )
        .join('')}
    </ul>
  `
}

export function openOverlay(id: CheckpointId): void {
  if (openId === id) return
  openId = id
  titleEl.textContent = TITLES[id]
  overlayEl.classList.add('is-open')
  overlayEl.setAttribute('aria-hidden', 'false')

  if (id === 'port') void renderPort()
  else if (id === 'platform') renderPlatform()
  else renderCity()
}

// WEB-PHASE-4 REDO Phase 7: guards the one in-flight open/close transition at
// a time -- a second ENTER/ESC/click mid-flash is simply ignored rather than
// overlapping two 1s animations or double-firing open/close.
let transitioning = false

// The real entry point from main.ts's ENTER handler now (replacing a direct
// openOverlay call): plays the light-speed flash first, and only once it's
// done does the overlay actually open, with its background inverted for as
// long as it stays open (both per explicit request).
export function requestOpenOverlay(id: CheckpointId): void {
  if (transitioning || openId === id) return
  transitioning = true
  void playLightspeed().then(() => {
    openOverlay(id)
    panelEl.classList.add('is-inverted')
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
    panelEl.classList.remove('is-inverted')
    closeOverlay()
    transitioning = false
  })
}

// onClose: called whenever the overlay actually closes (after the closing
// light-speed flash finishes) — the caller (main.ts) uses it to know
// playback/driving focus has returned to the 3D scene, without this module
// needing to know anything about checkpoints.
export function initOverlay(onClose: () => void): void {
  overlayEl = document.getElementById('checkpoint-overlay')!
  panelEl = document.getElementById('checkpoint-overlay-panel')!
  titleEl = document.getElementById('checkpoint-overlay-title')!
  bodyEl = document.getElementById('checkpoint-overlay-body')!
  closeBtn = document.getElementById('checkpoint-overlay-close')!
  platformHolderEl = document.getElementById('checkpoint-platform-holder')!
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
