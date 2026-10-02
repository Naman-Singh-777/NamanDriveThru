import { externalLinks } from './config/externalLinks'
import type { CheckpointId } from './vehicle/checkpoint'

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
    el.loading = 'lazy'
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
// "GitHub pinned repos" profile widgets use); if it's unreachable we fall
// back to the account's most-recently-pushed public repos via the official
// REST API, clearly labelled as such rather than mislabeled as "pinned".
async function fetchPortProjects(username: string): Promise<{ name: string; description: string; href: string }[]> {
  try {
    const res = await fetch(`https://gh-pinned-repos.egoist.dev/?username=${encodeURIComponent(username)}`)
    if (!res.ok) throw new Error(`pinned endpoint ${res.status}`)
    const pinned = (await res.json()) as { repo: string; owner: string; description: string | null }[]
    if (!Array.isArray(pinned) || pinned.length === 0) throw new Error('empty pinned list')

    const withLiveUrls = await Promise.all(
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
    return withLiveUrls
  } catch {
    // Fallback: most-recently-pushed public repos, official REST API, no auth.
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=pushed&per_page=6`)
    if (!res.ok) throw new Error(`repos fallback ${res.status}`)
    const repos = (await res.json()) as { name: string; description: string | null; homepage: string | null; html_url: string }[]
    return repos.map((r) => ({
      name: r.name,
      description: r.description || '',
      href: r.homepage && r.homepage.trim() ? r.homepage.trim() : r.html_url
    }))
  }
}

function driveSectionHtml(): string {
  const url = externalLinks.driveUrl?.trim()
  if (!url) return ''
  const label = externalLinks.driveLabel?.trim() || 'Drive'
  return `
    <h3 class="checkpoint-overlay__section-heading">${escapeHtml(label)}</h3>
    <ul class="checkpoint-overlay__menu">
      <li>
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>
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
            <a href="${escapeHtml(p.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.name)}</a>
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

function renderPlatform(): void {
  const embeds = externalLinks.spotifyEmbeds
  if (embeds.length === 0) {
    bodyEl.innerHTML = renderMessage('Spotify not configured yet.')
    return
  }
  bodyEl.innerHTML = ''
  for (const embed of embeds) {
    const iframe = getOrCreatePlatformIframe(embed.type, embed.id)
    bodyEl.appendChild(iframe) // moves the SAME node back in — playback state/position is untouched
  }
}

function renderCity(): void {
  const s = externalLinks.social
  const github = s.github || (externalLinks.githubUsername ? `https://github.com/${externalLinks.githubUsername}` : '')
  const entries: { label: string; href: string }[] = []
  if (github) entries.push({ label: 'GitHub', href: github })
  if (s.linkedin) entries.push({ label: 'LinkedIn', href: s.linkedin })
  if (s.instagram) entries.push({ label: 'Instagram', href: s.instagram })
  if (s.email) entries.push({ label: 'Email', href: `mailto:${s.email}` })
  if (s.email2) entries.push({ label: 'Email (alt)', href: `mailto:${s.email2}` })

  if (entries.length === 0) {
    bodyEl.innerHTML = renderMessage('Social links not configured yet.')
    return
  }
  bodyEl.innerHTML = `
    <ul class="checkpoint-overlay__social">
      ${entries
        .map(
          (e) => `<li><a href="${escapeHtml(e.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.label)}</a></li>`
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

// onClose: called whenever the overlay closes (ESC, X, backdrop click) — the
// caller (main.ts) uses it to know playback/driving focus has returned to
// the 3D scene, without this module needing to know anything about checkpoints.
export function initOverlay(onClose: () => void): void {
  overlayEl = document.getElementById('checkpoint-overlay')!
  panelEl = document.getElementById('checkpoint-overlay-panel')!
  titleEl = document.getElementById('checkpoint-overlay-title')!
  bodyEl = document.getElementById('checkpoint-overlay-body')!
  closeBtn = document.getElementById('checkpoint-overlay-close')!
  platformHolderEl = document.getElementById('checkpoint-platform-holder')!
  onCloseCb = onClose

  closeBtn.addEventListener('click', closeOverlay)
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeOverlay() // backdrop click, not the panel itself
  })
  panelEl.addEventListener('click', (e) => e.stopPropagation())
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && isOverlayOpen()) closeOverlay()
  })
}
