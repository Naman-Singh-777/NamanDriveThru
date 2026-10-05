// Fullscreen by default, with a three-press Escape to leave it.
//
// Browsers only allow fullscreen from a user gesture, so the page asks for it
// on the first key press, click or tap (and once up front, in case the
// browser already allows it). Escape is also how a menu closes, so a single
// Escape must never throw the visitor out of fullscreen. Where the Keyboard
// Lock API exists (Chromium, while fullscreen) Escape is delivered to the page
// instead of the browser, and this module counts presses: three within a short
// window leave fullscreen, a lone press does nothing here. An Escape that
// closes a menu is never counted. Browsers without Keyboard Lock (Firefox,
// Safari) reserve Escape for themselves, so there it exits natively.

const ESC_PRESSES_TO_EXIT = 3
const ESC_WINDOW_MS = 2200
const GESTURES = ['pointerdown', 'pointerup', 'mousedown', 'click', 'touchend', 'keydown'] as const

type LockableKeyboard = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void }

export function initFullscreen(isOverlayBusy: () => boolean): void {
  const root = document.documentElement
  if (!document.fullscreenEnabled || typeof root.requestFullscreen !== 'function') return

  const keyboard = (navigator as Navigator & { keyboard?: LockableKeyboard }).keyboard
  let wantFullscreen = true // flips off once the visitor deliberately leaves
  let presses = 0
  let pressTimer: number | undefined
  let hintEl: HTMLElement | null = null
  let hintTimer: number | undefined

  let entering = false
  const enter = (): void => {
    if (!wantFullscreen || entering || document.fullscreenElement) return
    entering = true
    root
      .requestFullscreen({ navigationUI: 'hide' })
      .catch(() => {
        // No user gesture yet (or the browser said no): the next gesture retries.
      })
      .finally(() => {
        entering = false
      })
  }

  const onGesture = (e: Event): void => {
    // Escape is not a gesture the browser accepts for fullscreen, and a menu
    // close must not be the thing that re-enters it either.
    if (e instanceof KeyboardEvent && e.code === 'Escape') return
    enter()
  }
  for (const type of GESTURES) window.addEventListener(type, onGesture, { capture: true, passive: true })

  const hint = (text: string): void => {
    if (!hintEl) {
      hintEl = document.createElement('div')
      hintEl.setAttribute('role', 'status')
      hintEl.setAttribute('aria-live', 'polite')
      hintEl.style.cssText =
        'position:fixed;left:50%;bottom:26px;z-index:80;transform:translate(-50%,8px);opacity:0;' +
        'pointer-events:none;padding:10px 18px;border-radius:999px;box-sizing:border-box;' +
        'max-width:calc(100vw - 36px);text-align:center;font:600 13px/1.2 system-ui,sans-serif;' +
        'letter-spacing:0.04em;color:#eaf2ff;background:rgba(14,22,34,0.55);' +
        'backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
        'border:1px solid rgba(180,210,255,0.28);box-shadow:0 8px 24px rgba(0,0,0,0.4);' +
        'transition:opacity .18s ease,transform .18s ease;'
      document.body.appendChild(hintEl)
    }
    hintEl.textContent = text
    void hintEl.offsetWidth
    hintEl.style.opacity = '1'
    hintEl.style.transform = 'translate(-50%,0)'
    window.clearTimeout(hintTimer)
    hintTimer = window.setTimeout(hideHint, ESC_WINDOW_MS)
  }
  function hideHint(): void {
    if (!hintEl) return
    hintEl.style.opacity = '0'
    hintEl.style.transform = 'translate(-50%,8px)'
  }

  const resetPresses = (): void => {
    presses = 0
    window.clearTimeout(pressTimer)
    hideHint()
  }

  const leave = (): void => {
    wantFullscreen = false // a deliberate exit: never pull them back in
    resetPresses()
    for (const type of GESTURES) window.removeEventListener(type, onGesture, true)
    try {
      keyboard?.unlock?.()
    } catch {
      // nothing locked
    }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      // Deliver Escape to the page while fullscreen so a single press is ours.
      void keyboard?.lock?.(['Escape']).catch(() => {})
    } else {
      // Any exit means the visitor chose to leave (our three Escapes, a browser
      // Escape where Keyboard Lock is missing, F11, a long Escape hold), so
      // never drag them back in on the next click.
      leave()
    }
  })

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat || !document.fullscreenElement) return
    // Closing (or opening) a menu is what this Escape is for: not counted.
    if (isOverlayBusy()) {
      resetPresses()
      return
    }
    presses++
    window.clearTimeout(pressTimer)
    if (presses >= ESC_PRESSES_TO_EXIT) {
      leave()
      return
    }
    pressTimer = window.setTimeout(resetPresses, ESC_WINDOW_MS)
    const left = ESC_PRESSES_TO_EXIT - presses
    hint(`Press Esc ${left} more time${left === 1 ? '' : 's'} to exit fullscreen`)
  })

  enter()
}