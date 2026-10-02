// WEB-PHASE-4 REDO Phase 7: a quick (1s) full-screen "light speed"/hyperspace
// flash, played right before a checkpoint's overlay actually opens, and again
// right before it actually closes (see requestOpenOverlay/requestCloseOverlay
// in overlay.ts) -- covers the cut into/out of the terminal's inverted-color
// interior the same way a hyperspace jump hides a scene transition. Pure CSS/
// DOM: a fixed full-screen layer (markup/CSS in index.html) that gets a
// one-shot animation class toggled on, then removed once it finishes.
//
// This is a first-pass look (radiating streaks + a white flash) built without
// a visual reference -- the user has their own tutorial for the exact effect
// they want, to refine this against once shared.
const DEFAULT_DURATION_MS = 1000

let el: HTMLElement | null = null
function getEl(): HTMLElement {
  if (!el) el = document.getElementById('lightspeed-overlay')!
  return el
}

export function playLightspeed(durationMs: number = DEFAULT_DURATION_MS): Promise<void> {
  const node = getEl()
  // Force a reflow between remove/add so the CSS animation restarts cleanly
  // even if this is called again in rapid succession.
  node.classList.remove('is-active')
  void node.offsetWidth
  node.classList.add('is-active')
  return new Promise((resolve) => {
    window.setTimeout(() => {
      node.classList.remove('is-active')
      resolve()
    }, durationMs)
  })
}
