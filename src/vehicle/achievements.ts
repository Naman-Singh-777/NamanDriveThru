import type { CheckpointId } from './checkpoint'

// WEB-PHASE-4 REDO Phase 13: Steam-style "Achievement Unlocked" toast + a
// short key-unlock popup, fired exactly once per checkpoint the very first
// time it's genuinely activated (ENTER while inside it, or the touch "OPEN"
// prompt tap -- see activateCheckpoint() in main.ts, the single call site
// every activation path already converges on). After that first visit, the
// matching keyboard shortcut (M/G/C) -- or, on touch devices with no
// keyboard, a small on-screen shortcut chip -- stays permanently available
// (tracked in localStorage, so it survives reloads) to reopen that
// checkpoint's menu from anywhere on the map, through the exact same
// requestOpenOverlay() light-speed animation every other entry point uses.
// DOM/CSS skeleton lives in index.html (same convention as touch-controls
// and the checkpoint overlay); this module only wires behaviour.

const STORAGE_PREFIX = 'wf13:visited:'

export function hasVisited(id: CheckpointId): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + id) === '1'
  } catch {
    return false
  }
}

// Returns true only the first time this is ever called for a given id (the
// localStorage write "sticks" across reloads) -- false on every later call,
// including every call this same session after the first.
function markVisited(id: CheckpointId): boolean {
  if (hasVisited(id)) return false
  try {
    localStorage.setItem(STORAGE_PREFIX + id, '1')
  } catch {
    // localStorage unavailable (private mode, etc.) -- harmless: the
    // achievement/popup just replay next time instead of staying one-shot,
    // and the touch chip won't persist across a reload either.
  }
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
    achievementTitle: 'Judging My Music Taste',
    achievementSubtitle: 'You found the playlists. Be nice about it.',
    keyPopupText: 'Press M anytime to jump back into Music.'
  },
  port: {
    chipId: 'shortcut-chip-port',
    achievementTitle: 'Stalking the Commit History',
    achievementSubtitle: "Reading my code like it's gossip now, huh?",
    keyPopupText: 'Press G anytime to reopen Projects.'
  },
  city: {
    chipId: 'shortcut-chip-city',
    achievementTitle: 'Added to Close Friends (Hopefully)',
    achievementSubtitle: 'Found the socials. No turning back now.',
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

// Bottom-right, holds for 5s, per spec. display stays 'none' at rest (not
// just opacity:0) and is only flipped on for the duration it's actually
// shown -- a reported "perpetual translucent box" in this corner traced to
// a GPU-compositor ghost on an element that's opacity:0 but still live in
// the render tree; display:none removes that possibility entirely.
function showToast(meta: ShortcutMeta): void {
  if (toastTimer !== undefined) window.clearTimeout(toastTimer)
  if (toastHideTimer !== undefined) window.clearTimeout(toastHideTimer)
  toastTitleEl.textContent = meta.achievementTitle
  toastSubEl.textContent = meta.achievementSubtitle
  toastEl.style.display = 'flex'
  void toastEl.offsetWidth // force a layout flush so display:none -> flex doesn't eat the transition
  toastEl.classList.add('is-visible')
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('is-visible')
    toastHideTimer = window.setTimeout(() => { toastEl.style.display = 'none' }, TOAST_TRANSITION_MS)
  }, 5000)
}

// Splits the popup text into one <span> per letter so the exit animation
// (see triggerSmokeOut below) can dissipate it letter by letter, per the
// user-supplied smoke-text reference.
function setPopupLetters(text: string): void {
  popupTextEl.textContent = ''
  for (const ch of text) {
    const span = document.createElement('span')
    span.textContent = ch === ' ' ? '\u00A0' : ch
    popupTextEl.appendChild(span)
  }
}

const SMOKE_LETTER_STEP_MS = 9
const SMOKE_LETTER_MAX_DELAY_MS = 350
const SMOKE_DURATION_MS = 600

// Staggers each letter's smoke-dissipate animation (CSS does the actual
// rotate/translate/scale/blur/fade -- see #key-unlock-popup.is-poofing in
// index.html) and fades the pill's own chrome out alongside it.
function triggerSmokeOut(): void {
  const letters = Array.from(popupTextEl.children) as HTMLElement[]
  letters.forEach((span, i) => {
    span.style.animationDelay = `${Math.min(i * SMOKE_LETTER_STEP_MS, SMOKE_LETTER_MAX_DELAY_MS)}ms`
  })
  popupEl.classList.remove('is-visible')
  popupEl.classList.add('is-poofing')
}

// Dead center, holds for 2s, then "poofs" -- a letter-by-letter smoke
// dissipation, distinct from its gentler scale-in entrance -- per spec.
// Same display:none-at-rest guard as the achievement toast above.
function showKeyPopup(meta: ShortcutMeta): void {
  if (popupTimer !== undefined) window.clearTimeout(popupTimer)
  if (popupPoofTimer !== undefined) window.clearTimeout(popupPoofTimer)
  popupEl.classList.remove('is-poofing')
  setPopupLetters(meta.keyPopupText)
  popupEl.style.display = 'block'
  void popupEl.offsetWidth
  popupEl.classList.add('is-visible')
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
  pendingKeyPopup = id
}

// Called from main.ts's overlay-close callback with whichever checkpoint
// just closed. Only fires (2s later, per spec) when that close belongs to a
// first-ever visit still owed its key-unlock popup -- a no-op on every
// ordinary close after that.
export function notifyOverlayClosed(id: CheckpointId): void {
  if (pendingKeyPopup !== id) return
  pendingKeyPopup = null
  window.setTimeout(() => showKeyPopup(META[id]), 2000)
}

// onActivate: the same (id) => activateCheckpoint(...) callback main.ts
// wires to the M/G/C keydown branches -- reused here so tapping an
// already-unlocked chip on a touch device opens the exact same way.
export function initAchievements(onActivate: (id: CheckpointId) => void): void {
  toastEl = document.getElementById('achievement-toast')!
  toastTitleEl = document.getElementById('achievement-toast-title')!
  toastSubEl = document.getElementById('achievement-toast-subtitle')!
  popupEl = document.getElementById('key-unlock-popup')!
  popupTextEl = document.getElementById('key-unlock-popup-text')!

  for (const id of Object.keys(META) as CheckpointId[]) {
    // Returning visitor: reveal whichever chips already unlocked in a
    // previous session, with no toast/popup replay.
    if (hasVisited(id)) revealChip(id)
    document.getElementById(META[id].chipId)?.addEventListener('pointerup', (e) => {
      e.preventDefault()
      onActivate(id)
    })
  }
}
