// Fullscreen on the first click, tap or key press, with a three-press Escape to leave it.
//
// Browsers only allow fullscreen from a user gesture, so the page asks for it
// exactly once, straight from the first activating gesture (see EntryState: one
// attempt, never repeated, whatever the outcome). Escape is also how a menu closes, so a single
// Escape must never throw the visitor out of fullscreen. Where the Keyboard
// Lock API exists (Chromium, while fullscreen) Escape is delivered to the page
// instead of the browser, and this module counts presses: three within a short
// window leave fullscreen, a lone press does nothing here. An Escape that
// closes a menu is never counted. Browsers without Keyboard Lock (Firefox,
// Safari) reserve Escape for themselves, so there it exits natively.

const ESC_PRESSES_TO_EXIT = 3
const ESC_WINDOW_MS = 2200
const GESTURES = ['pointerdown', 'pointerup', 'keydown'] as const

// One-time onboarding state. The first activating gesture asks for fullscreen once;
// whatever happens next is final. A refusal is not retried and a later exit is never
// answered by pulling the visitor back in. Only ever moves forward.
type EntryState =
  | 'INITIAL_LOADING_FULLSCREEN_PENDING'
  | 'FULLSCREEN_REQUESTED'
  | 'INITIAL_FULLSCREEN_ESTABLISHED'
  | 'FULLSCREEN_EXITED_AFTER_INITIAL_ENTRY'
  | 'INITIAL_FULLSCREEN_UNAVAILABLE'

type LockableKeyboard = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void }

let state: EntryState = 'INITIAL_LOADING_FULLSCREEN_PENDING'

// True only until the single initial attempt has been made (or fullscreen is ruled out).
// Lets other first-gesture code (touchControls) skip its own fullscreen request afterwards.
export const initialFullscreenPending = (): boolean => state === 'INITIAL_LOADING_FULLSCREEN_PENDING'

export function initFullscreen(isOverlayBusy: () => boolean): void {
  const root = document.documentElement
  if (!document.fullscreenEnabled || typeof root.requestFullscreen !== 'function') {
    state = 'INITIAL_FULLSCREEN_UNAVAILABLE'
    return
  }

  const keyboard = (navigator as Navigator & { keyboard?: LockableKeyboard }).keyboard
  let presses = 0
  let pressTimer: number | undefined
  let hintEl: HTMLElement | null = null
  let hintTimer: number | undefined

  const stopListening = (): void => {
    for (const type of GESTURES) window.removeEventListener(type, onGesture, true)
  }

  // Only what the browser counts as user activation can start fullscreen: a mouse press,
  // the release of a touch/pen contact, or a key other than Escape (which also closes menus).
  // A touch pointerdown would be refused, so it must not use up the single attempt.
  const activates = (e: Event): boolean => {
    if (e instanceof KeyboardEvent) return e.code !== 'Escape'
    if (e instanceof PointerEvent) return e.type === 'pointerdown' ? e.pointerType === 'mouse' : e.pointerType !== 'mouse'
    return false
  }

  // Runs inside the gesture's own event handler (so the browser sees real activation) and
  // never calls preventDefault/stopPropagation, so the same click still reaches the page.
  const onGesture = (e: Event): void => {
    if (state !== 'INITIAL_LOADING_FULLSCREEN_PENDING' || !activates(e)) return
    state = 'FULLSCREEN_REQUESTED'
    stopListening() // one attempt only
    try {
      Promise.resolve(root.requestFullscreen({ navigationUI: 'hide' })).then(
        () => {
          if (state === 'FULLSCREEN_REQUESTED' && document.fullscreenElement) state = 'INITIAL_FULLSCREEN_ESTABLISHED'
        },
        () => {
          if (state === 'FULLSCREEN_REQUESTED') state = 'INITIAL_FULLSCREEN_UNAVAILABLE' // refused: carry on normally
        },
      )
    } catch {
      state = 'INITIAL_FULLSCREEN_UNAVAILABLE'
    }
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
    state = 'FULLSCREEN_EXITED_AFTER_INITIAL_ENTRY' // a deliberate exit: never pull them back in
    resetPresses()
    stopListening()
    try {
      keyboard?.unlock?.()
    } catch {
      // nothing locked
    }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      if (state === 'INITIAL_LOADING_FULLSCREEN_PENDING' || state === 'FULLSCREEN_REQUESTED') {
        state = 'INITIAL_FULLSCREEN_ESTABLISHED'
        stopListening()
      }
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
}