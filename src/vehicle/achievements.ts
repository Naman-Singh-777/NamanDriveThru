import type { CheckpointId } from './checkpoint'
import { playAchievementChime } from './checkpointAudio'

// WEB-PHASE-4 REDO Phase 13: Steam-style "Achievement Unlocked" toast + a
// short key-unlock popup, fired exactly once per checkpoint the very first
// time it's genuinely activated (ENTER while inside it, or the touch "OPEN"
// prompt tap -- see activateCheckpoint() in main.ts, the single call site
// every activation path already converges on). After that first visit, the
// matching keyboard shortcut (M/G/C) -- or, on touch devices with no
// keyboard, a small on-screen shortcut chip -- stays available to reopen
// that checkpoint's menu from anywhere on the map, through the exact same
// requestOpenOverlay() light-speed animation every other entry point uses.
// DOM/CSS skeleton lives in index.html (same convention as touch-controls
// and the checkpoint overlay); this module only wires behaviour.
//
// Every entry to the site is a brand-new player: nothing about what a
// visitor has already unlocked is ever written to localStorage or
// sessionStorage, it only lives in memory for the current page load. A
// reload, a new tab or a return visit therefore replays every achievement
// toast, key-unlock popup and chip reveal from scratch. Within one sitting
// the behaviour is unchanged: visiting a checkpoint twice still only fires
// the toast/popup once, and M/G/C keep reopening freely after that.

const STORAGE_PREFIX = 'wf13:visited:'
const visited = new Set<CheckpointId>()

// Older builds saved this flag in localStorage, then sessionStorage. Drop any
// leftover copy so a stale flag can never mark someone as already seen.
function clearLegacyFlags(): void {
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      const s = store()
      for (let i = s.length - 1; i >= 0; i--) {
        const k = s.key(i)
        if (k && k.startsWith(STORAGE_PREFIX)) s.removeItem(k)
      }
    } catch {
      // storage unavailable -- nothing to clear
    }
  }
}

export function hasVisited(id: CheckpointId): boolean {
  return visited.has(id)
}

// Returns true only the first time this is called for a given id during this
// page load, false on every later call.
function markVisited(id: CheckpointId): boolean {
  if (visited.has(id)) return false
  visited.add(id)
  return true
}

interface ShortcutMeta {
  chipId: string
  achievementTitle: string
  achievementSubtitle: string
  keyPopupText: string
}

// Copy run through the /humanizer skill per the user's explicit request --
// satirical, self-aware, tied to the visitor's own growing curiosity, not
// generic "Achievement Unlocked: Checkpoint Found" filler.
const META: Record<CheckpointId, ShortcutMeta> = {
  platform: {
    chipId: 'shortcut-chip-platform',
    achievementTitle: 'Caught You Snooping',
    achievementSubtitle: 'You found the music. Of course you want more now.',
    keyPopupText: 'Press M anytime to jump back into Music.'
  },
  port: {
    chipId: 'shortcut-chip-port',
    achievementTitle: 'Now You Want The Code Too',
    achievementSubtitle: "One repo in and you're already hooked.",
    keyPopupText: 'Press G anytime to reopen Projects.'
  },
  city: {
    chipId: 'shortcut-chip-city',
    achievementTitle: "Okay, You're Fully Invested",
    achievementSubtitle: 'Found my socials. No quitting now.',
    keyPopupText: 'Press C anytime to reopen Connect.'
  }
}

let toastEl: HTMLElement
let toastTitleEl: HTMLElement
let toastSubEl: HTMLElement
let popupEl: HTMLElement
let popupTextEl: HTMLElement
let toastTimer: number | undefined
let toastHideTimer: number | undefined
let popupTimer: number | undefined
let popupPoofTimer: number | undefined

const TOAST_TRANSITION_MS = 300
// The toast's text smokes away this long before the box slides off, so the box leaves empty.
const TOAST_SMOKE_LEAD_MS = 650
const TOAST_HOLD_MS = 5000

const reduceMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ---------- smoke text ----------
// Every letter is its own span so the text can condense out of smoke when it appears and
// dissipate back into it when it goes (CSS keyframes smk-in / key-popup-smoke-out in
// index.html), with soft smoke puffs rising off the box at the same moments. Words are
// wrapped (nowrap) so long lines still break between words, not mid-word.
function smokeText(el: HTMLElement, text: string): HTMLElement[] {
  el.textContent = ''
  const letters: HTMLElement[] = []
  const words = text.split(' ')
  words.forEach((w, wi) => {
    const word = document.createElement('span')
    word.className = 'smk-w'
    for (const ch of w) {
      const s = document.createElement('span')
      s.className = 'smk-c'
      s.textContent = ch
      word.appendChild(s)
      letters.push(s)
    }
    el.appendChild(word)
    if (wi < words.length - 1) el.appendChild(document.createTextNode(' '))
  })
  return letters
}

function smokeIn(letters: HTMLElement[], baseDelayMs = 0): void {
  letters.forEach((s, i) => {
    s.style.animation = 'smk-in 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) both'
    s.style.animationDelay = `${baseDelayMs + Math.min(i * 16, 420)}ms`
  })
}

function smokeOut(letters: HTMLElement[]): void {
  letters.forEach((s, i) => {
    s.style.animation = `key-popup-smoke-out ${SMOKE_DURATION_MS}ms ease-in-out forwards`
    s.style.animationDelay = `${Math.min(i * SMOKE_LETTER_STEP_MS, SMOKE_LETTER_MAX_DELAY_MS)}ms`
  })
}

// A burst of soft smoke puffs rising off the box (layout size, so a box that is mid-slide
// still gets puffs in the right place).
function emitSmoke(host: HTMLElement, count: number): void {
  if (reduceMotion()) return
  let layer = host.querySelector<HTMLElement>(':scope > .smk-fx')
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 'smk-fx'
    host.appendChild(layer)
  }
  const w = host.offsetWidth
  const h = host.offsetHeight
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i')
    p.className = 'smk-puff'
    layer.appendChild(p)
    const x = w * (0.04 + Math.random() * 0.92)
    const y = h * (0.3 + Math.random() * 0.5)
    const rise = 26 + Math.random() * 46
    const drift = (Math.random() - 0.5) * 56
    const s0 = 0.5 + Math.random() * 0.4
    const s1 = 1.5 + Math.random() * 1.2
    const anim = p.animate(
      [
        { transform: `translate(${x}px, ${y}px) scale(${s0})`, opacity: 0 },
        { transform: `translate(${x + drift * 0.4}px, ${y - rise * 0.45}px) scale(${(s0 + s1) / 2})`, opacity: 0.75, offset: 0.3 },
        { transform: `translate(${x + drift}px, ${y - rise}px) scale(${s1})`, opacity: 0 }
      ],
      { duration: 900 + Math.random() * 700, delay: Math.random() * 260, easing: 'ease-out', fill: 'both' }
    )
    anim.onfinish = () => p.remove()
  }
}

let toastLetters: HTMLElement[] = []
let popupLetters: HTMLElement[] = []

// Bottom-right, holds for 5s, per spec. display stays 'none' at rest (not
// just opacity:0) and is only flipped on for the duration it's actually
// shown -- a reported "perpetual translucent box" in this corner traced to
// a GPU-compositor ghost on an element that's opacity:0 but still live in
// the render tree; display:none removes that possibility entirely.
// The title and subtitle condense out of smoke as the box slides in, and smoke off again
// just before it slides away.
function showToast(meta: ShortcutMeta): void {
  if (toastTimer !== undefined) window.clearTimeout(toastTimer)
  if (toastHideTimer !== undefined) window.clearTimeout(toastHideTimer)
  toastLetters = [...smokeText(toastTitleEl, meta.achievementTitle), ...smokeText(toastSubEl, meta.achievementSubtitle)]
  toastEl.style.display = 'flex'
  void toastEl.offsetWidth // force a layout flush so display:none -> flex doesn't eat the transition
  smokeIn(toastLetters, 220)
  toastEl.classList.add('is-visible')
  emitSmoke(toastEl, 16)
  toastTimer = window.setTimeout(() => {
    smokeOut(toastLetters)
    emitSmoke(toastEl, 14)
    toastTimer = window.setTimeout(() => {
      toastEl.classList.remove('is-visible')
      toastHideTimer = window.setTimeout(() => { toastEl.style.display = 'none' }, TOAST_TRANSITION_MS)
    }, TOAST_SMOKE_LEAD_MS)
  }, TOAST_HOLD_MS - TOAST_SMOKE_LEAD_MS)
}

const SMOKE_LETTER_STEP_MS = 9
const SMOKE_LETTER_MAX_DELAY_MS = 350
const SMOKE_DURATION_MS = 600

// Smoke-dissipates each letter (staggered) and fades the pill's own chrome out alongside it.
function triggerSmokeOut(): void {
  smokeOut(popupLetters)
  emitSmoke(popupEl, 14)
  popupEl.classList.remove('is-visible')
  popupEl.classList.add('is-poofing')
}

// Dead center: the line condenses out of smoke, holds for 2s, then "poofs" -- a
// letter-by-letter smoke dissipation -- per spec.
// Same display:none-at-rest guard as the achievement toast above.
function showKeyPopup(meta: ShortcutMeta): void {
  if (popupTimer !== undefined) window.clearTimeout(popupTimer)
  if (popupPoofTimer !== undefined) window.clearTimeout(popupPoofTimer)
  popupEl.classList.remove('is-poofing')
  popupLetters = smokeText(popupTextEl, meta.keyPopupText)
  popupEl.style.display = 'block'
  void popupEl.offsetWidth
  smokeIn(popupLetters, 120)
  popupEl.classList.add('is-visible')
  emitSmoke(popupEl, 16)
  popupTimer = window.setTimeout(() => {
    triggerSmokeOut()
    popupPoofTimer = window.setTimeout(() => {
      popupEl.classList.remove('is-poofing')
      popupEl.style.display = 'none'
    }, SMOKE_LETTER_MAX_DELAY_MS + SMOKE_DURATION_MS + 100)
  }, 2000)
}
function revealChip(id: CheckpointId): void {
  document.getElementById(META[id].chipId)?.classList.add('is-unlocked')
}

// Holds the checkpoint whose key-unlock popup is still owed -- set by
// registerVisit() on a genuine first visit, consumed by notifyOverlayClosed()
// once that checkpoint's menu actually closes (see main.ts/overlay.ts).
let pendingKeyPopup: CheckpointId | null = null

// Called from activateCheckpoint() in main.ts -- the one shared path every
// activation (ENTER, a touch prompt tap, or an already-unlocked M/G/C
// shortcut/chip) already goes through. A no-op after the real first visit.
export function registerVisit(id: CheckpointId): void {
  if (!markVisited(id)) return
  revealChip(id)
  showToast(META[id])
  playAchievementChime()
  pendingKeyPopup = id
}

// Called from main.ts's overlay-close callback with whichever checkpoint
// just closed. Only fires (1s later, per spec) when that close belongs to a
// first-ever visit still owed its key-unlock popup -- a no-op on every
// ordinary close after that.
export function notifyOverlayClosed(id: CheckpointId): void {
  if (pendingKeyPopup !== id) return
  pendingKeyPopup = null
  window.setTimeout(() => showKeyPopup(META[id]), 1000)
}

// onActivate: the same (id) => activateCheckpoint(...) callback main.ts
// wires to the M/G/C keydown branches -- reused here so tapping an
// already-unlocked chip on a touch device opens the exact same way.
export function initAchievements(onActivate: (id: CheckpointId) => void): void {
  clearLegacyFlags()
  toastEl = document.getElementById('achievement-toast')!
  toastTitleEl = document.getElementById('achievement-toast-title')!
  toastSubEl = document.getElementById('achievement-toast-subtitle')!
  popupEl = document.getElementById('key-unlock-popup')!
  popupTextEl = document.getElementById('key-unlock-popup-text')!

  for (const id of Object.keys(META) as CheckpointId[]) {
    document.getElementById(META[id].chipId)?.addEventListener('pointerup', (e) => {
      e.preventDefault()
      onActivate(id)
    })
  }
}
