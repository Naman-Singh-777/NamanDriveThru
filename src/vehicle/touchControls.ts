import type { InputState } from './controls'
import { initialFullscreenPending } from '../fullscreen'

// On-screen touch controls for phones/tablets: a D-pad (accelerate/reverse/steer)
// plus a separate brake button, both mutating the SAME InputState object the
// keyboard binds to in controls.ts (that object is read every physics step by
// Vehicle.applyControls in the main.ts loop), so this needs zero changes to
// vehicle.ts or the input contract -- it's just a second writer of the same
// shared state, exactly like keyboard already is.
//
// The actual DOM/CSS for the buttons lives in index.html (kept inline there,
// matching how the rest of the page's styling is already done); this module
// only wires Pointer Events to it and does the best-effort landscape lock.

const BTN_IDS = {
  up: 'touch-btn-up',
  down: 'touch-btn-down',
  left: 'touch-btn-left',
  right: 'touch-btn-right',
  brake: 'touch-btn-brake'
} as const

function bindHoldButton(id: string, onChange: (pressed: boolean) => void): void {
  const el = document.getElementById(id)
  if (!el) return

  // Pointer Events unify touch/mouse/pen and (unlike click) fire independently
  // per finger, so holding "up" and "left" at the same time with two thumbs
  // works correctly -- each button tracks its own pointer ids.
  const active = new Set<number>()

  const press = (e: PointerEvent) => {
    e.preventDefault()
    active.add(e.pointerId)
    onChange(true)
  }
  const release = (e: PointerEvent) => {
    active.delete(e.pointerId)
    if (active.size === 0) onChange(false)
  }

  el.addEventListener('pointerdown', press)
  el.addEventListener('pointerup', release)
  el.addEventListener('pointercancel', release)
  // finger slides off the button while still down -- treat like a release so
  // a car can't get stuck accelerating/steering forever because a thumb drifted
  el.addEventListener('pointerleave', release)
  el.addEventListener('pointerout', release)
  // Safari/iOS quirk: suppress the synthetic mouse events + callout menu that
  // can otherwise double-fire alongside pointer events on a long-press.
  el.addEventListener('contextmenu', (e) => e.preventDefault())
}

// Best-effort fullscreen + landscape lock for the browsers that support it
// (mainly Android Chrome; the Screen Orientation Lock API has no effect on
// iOS Safari at all). Must run inside a real user-gesture handler, so it's
// attempted on the first touch anywhere on the controls. Failures are
// expected and silently ignored -- the CSS "rotate your device" overlay in
// index.html is the actual guaranteed fallback when locking isn't possible.
function tryLockLandscapeOnce(): void {
  let tried = false
  const attempt = async () => {
    if (tried) return
    tried = true
    try {
      const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> }
      // Only during the one-time initial entry: never re-request after it has settled or the visitor left.
      if (initialFullscreenPending() && document.fullscreenElement == null && el.requestFullscreen) {
        await el.requestFullscreen().catch(() => {})
      }
      const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined
      await orientation?.lock?.('landscape').catch(() => {})
    } catch {
      // unsupported -- ignore, CSS overlay handles it
    }
  }
  window.addEventListener('pointerdown', attempt, { once: true, passive: true })
}

// WEB-PHASE-4 REDO Phase 7: live input-mode detection for convertible/
//2-in-1 devices (e.g. a touchscreen laptop), which the CSS
// `@media (pointer: coarse)` alone can't reliably track -- some browsers
// never update it when the same machine switches between keyboard+mouse and
// tablet use. This sets a `data-input-mode` attribute on <html> the instant
// a REAL interaction of either kind is observed, and index.html's CSS gives
// that attribute higher specificity than the media query, so it always wins
// once set -- the on-screen controls appear/disappear live, mid-session, with
// no reload. Until the first real interaction, the media query's initial
// guess still applies (so a phone with no mouse at all still shows controls
// immediately on load).
function initAdaptiveInputMode(): void {
  const root = document.documentElement
  let mode: 'touch' | 'pointer' | null = null
  let sawRealInput = false
  const setMode = (next: 'touch' | 'pointer') => {
    if (mode === next) return
    mode = next
    root.setAttribute('data-input-mode', next)
    if (next === 'touch') tryLockLandscapeOnce() // arm it even if the session started in keyboard/mouse mode
  }

  // Best guess BEFORE any interaction, so the right controls are decided
  // before the game even finishes loading. Pointer media queries alone lie on
  // touchscreen laptops (a Windows laptop here reports pointer:coarse, no
  // fine pointer, no hover, 10 touch points), so they are combined with the
  // OS: only a phone/tablet OS with no mouse or trackpad starts in touch
  // mode. A touchscreen laptop starts in keyboard/mouse mode and flips to
  // touch on its first real tap. The listeners below re-run the guess if the
  // device's pointer capabilities change (dock/undock, tablet mode) until a
  // real input arrives, after which real input always wins.
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  const mobileOS =
    nav.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod/i.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1) // iPadOS posing as a Mac
  const guess = () => {
    if (sawRealInput) return
    const noFinePointer = !window.matchMedia('(any-pointer: fine)').matches
    setMode(mobileOS && noFinePointer ? 'touch' : 'pointer')
  }
  guess()
  for (const q of ['(pointer: coarse)', '(any-pointer: fine)', '(any-pointer: coarse)']) {
    window.matchMedia(q).addEventListener('change', guess)
  }

  // Real interaction always wins, checked continuously: each event is one
  // string compare once the mode already matches, so this costs ~nothing.
  // Pointer Events carry pointerType, so a tap's synthetic follow-up mouse
  // events (which are not pointer events) can never flip the mode back.
  const real = (next: 'touch' | 'pointer') => {
    sawRealInput = true
    setMode(next)
  }
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') real('pointer')
    else if (e.pointerType === 'touch' || e.pointerType === 'pen') real('touch')
  }
  window.addEventListener('pointerdown', onPointer, { passive: true, capture: true })
  window.addEventListener('pointermove', onPointer, { passive: true, capture: true })
  window.addEventListener('keydown', () => real('pointer'))
}

export function bindTouchControls(state: InputState): void {
  bindHoldButton(BTN_IDS.up, (p) => { state.forward = p })
  bindHoldButton(BTN_IDS.down, (p) => { state.reverse = p })
  bindHoldButton(BTN_IDS.left, (p) => { state.left = p })
  bindHoldButton(BTN_IDS.right, (p) => { state.right = p })
  bindHoldButton(BTN_IDS.brake, (p) => { state.brake = p })

  initAdaptiveInputMode()
  if (window.matchMedia('(pointer: coarse)').matches) {
    tryLockLandscapeOnce()
  }
}
