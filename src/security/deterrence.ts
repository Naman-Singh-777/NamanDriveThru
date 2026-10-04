// WEB-PHASE-4 REDO Phase 18 -- ADDITIONAL CLIENT-SIDE DETERRENCE.
//
// WHAT THIS IS: a single, isolated, opt-in nuisance layer that makes casual
// right-click-"View source"/"Inspect" and the most common DevTools keyboard
// shortcuts slightly less convenient on this page.
//
// WHAT THIS IS NOT, AND CAN NEVER BE: real protection. This file ships to
// every visitor's browser as plain, readable JavaScript, in a public repo.
// Anyone who actually wants to read this site's source, inspect its network
// traffic, or open DevTools can do so in seconds regardless of anything
// below -- by disabling JS, using browser extensions, opening DevTools
// BEFORE this script runs (e.g. from an already-open DevTools window, or
// via the browser's own menu -- "F12" is a shortcut for "open DevTools",
// not the only door to it), using a different browser, reading the public
// GitHub repo directly, or simply viewing this very file. Nothing in a
// static, client-side-only site can stop someone from copying it; that is
// a property of how browsers work, not a bug in this code. See the
// WEB-PHASE-4 REDO Phase 18 session log for the full reasoning. This module
// exists purely because it was explicitly requested as a deterrent for
// casual visitors -- never represent it, in code, docs, or conversation, as
// "security" or "protection."
//
// WHAT IT DELIBERATELY DOES NOT TOUCH (so the game keeps working):
//   - WASD / Enter / NumpadEnter / Escape / M / G / C / F / L / R / O and
//     every other in-game key the vehicle, camera and checkpoint code reads
//     (src/vehicle/**, src/main.ts) -- this module's keydown listener only
//     ever calls preventDefault() for the small, specific DevTools-opening
//     combinations listed below, and returns immediately for everything
//     else without calling stopPropagation(), so every other listener on
//     the page (including the game's own) still receives every key exactly
//     as before.
//   - Typing/selecting/copy-pasting in actual form fields -- this module
//     never calls preventDefault() on plain Ctrl/Cmd+C/V/X/A, only on the
//     specific DevTools-opening combinations below.
//   - Pointer Lock -- no mouse/click handling here at all.
//   - Any outbound link (GitHub, LinkedIn, Instagram, Drive) -- those are
//     plain <a target="_blank"> elements; a disabled context menu and a
//     blocked Ctrl+Shift+I do not affect a left-click/tap on a link.
//   - Anti-debugging tricks (no `debugger;` loops, no DevTools-open
//     detection/redirect, no console clearing/spam, no self-destructing
//     state) -- the attached security research is explicit that these
//     actively break legitimate users (slow machines, accessibility tools,
//     screen readers) while adding no real protection, so none are used.
//
// Deliberately global/irreversible by design (deterrence, not a toggle):
// this module does not expose a way to turn itself off at runtime, and
// Developer Mode (src/security/devMode.ts) does not disable it either --
// only editing/removing this file does.

const BLOCKED_KEY_COMBOS: Array<(e: KeyboardEvent) => boolean> = [
  // F12 -- the single most common "open DevTools" key on every platform.
  (e) => e.key === 'F12',
  // Ctrl/Cmd+Shift+I -- DevTools (Elements/Inspect).
  (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i'),
  // Ctrl/Cmd+Shift+J -- DevTools (Console).
  (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'J' || e.key === 'j'),
  // Ctrl/Cmd+Shift+C -- DevTools (element picker/inspect mode).
  (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c'),
  // Ctrl/Cmd+U -- View Source. (macOS has no separate Cmd+Option "view
  // source" shortcut; Option+Cmd+I/J/C above already cover macOS DevTools.)
  (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'U' || e.key === 'u'),
]

function onContextMenu(e: MouseEvent): void {
  e.preventDefault()
}

function onKeyDown(e: KeyboardEvent): void {
  for (const isBlocked of BLOCKED_KEY_COMBOS) {
    if (isBlocked(e)) {
      e.preventDefault()
      return
    }
  }
  // Not one of the specific combos above -- let it through untouched for
  // every other listener on the page (game controls included).
}

let installed = false

/** Call once, as early as possible. Idempotent. Deterrence-only -- see the file header. */
export function initDeterrence(): void {
  if (installed) return
  installed = true
  window.addEventListener('contextmenu', onContextMenu)
  // capture:false deliberately -- this must not run ahead of (or instead
  // of) the game's own keydown listener for every key it doesn't block.
  window.addEventListener('keydown', onKeyDown)
}
