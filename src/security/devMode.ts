// WEB-PHASE-4 REDO Phase 18 -- "Developer Mode" feature.
//
// Two modes:
//   - User Mode (default, everyone): completely unchanged. The existing
//     one-shot `wf13:visited:*` localStorage gate (src/vehicle/achievements.ts)
//     persists exactly as it always has.
//   - Developer Mode (opt-in, passphrase-gated, meant for the site owner
//     only): every page load wipes the `wf13:visited:*` keys BEFORE
//     anything else reads them, so the site always boots looking like a
//     brand-new visitor -- for testing every achievement/checkpoint flow
//     repeatedly without manually clearing localStorage each time.
//
// HOW "AUTHENTICATED" IS HONESTLY MEANT HERE: there is no backend and never
// will be on a static GitHub Pages site, so there is no way to keep a
// secret truly secret from someone holding the full client-side source (the
// same limitation the Phase 18 security audit applies to everything else
// on this site). This is a passphrase gate, not an account system: the
// passphrase is stored here only as a SHA-256 hash (not plaintext), which
// stops a casual glance at the source from revealing it outright, but a
// short passphrase + its public hash is realistically crackable offline by
// anyone who tries. Treat this exactly like the deterrence module next to
// it: good enough to keep Developer Mode from being something a random
// visitor stumbles into, not a real access-control boundary. Change the
// passphrase any time by replacing PASSPHRASE_HASH_HEX below (see the
// comment above it for how).

const DEVMODE_FLAG_KEY = 'wf13:devmode'
const VISITED_PREFIX = 'wf13:visited:'

// SHA-256 hex digest of the developer passphrase "naman-dev-2026" --
// CHANGE THIS. To generate a new hash for a new passphrase, open this
// site's DevTools console and run:
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('your-new-phrase'))
//     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')))
// then paste the printed 64-character hex string in below.
const PASSPHRASE_HASH_HEX = '42adcc8b219e5d30a6b58698ba9ce1e22921992ae81f8646578b44403c592b20'

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function isDevModeOn(): boolean {
  try {
    return localStorage.getItem(DEVMODE_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

function clearVisitedState(): void {
  try {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(VISITED_PREFIX)) toRemove.push(k)
    }
    toRemove.forEach((k) => localStorage.removeItem(k))
  } catch {
    // localStorage unavailable -- nothing to clear, harmless.
  }
}

/**
 * Call once, as early as possible -- before achievements.ts (or anything
 * else) reads `wf13:visited:*` for the very first time this page load.
 * No-op in User Mode.
 */
export function applyDevModeStateReset(): void {
  if (isDevModeOn()) clearVisitedState()
}

async function handleToggleRequest(): Promise<void> {
  const enabling = !isDevModeOn()
  const phrase = window.prompt(
    enabling
      ? 'Enter the developer passphrase to turn Developer Mode ON:'
      : 'Enter the developer passphrase to turn Developer Mode OFF:'
  )
  if (phrase == null) return // cancelled
  const hash = await sha256Hex(phrase)
  if (hash !== PASSPHRASE_HASH_HEX) {
    window.alert('Incorrect passphrase.')
    return
  }
  if (enabling) {
    try {
      localStorage.setItem(DEVMODE_FLAG_KEY, '1')
    } catch {
      // ignore -- see clearVisitedState()
    }
    clearVisitedState()
    window.alert(
      'Developer Mode is ON.\n\nEvery reload now presents the site as a brand-new first-time visit. Press Ctrl+Alt+Shift+D again (same passphrase) to turn it back off.'
    )
  } else {
    try {
      localStorage.removeItem(DEVMODE_FLAG_KEY)
    } catch {
      // ignore
    }
    window.alert('Developer Mode is OFF. Normal one-shot achievement behavior is restored.')
  }
  location.reload()
}

function onKeyDown(e: KeyboardEvent): void {
  // Ctrl+Alt+Shift+D -- a combination the game never reads (D alone steers;
  // nothing in this codebase checks ctrlKey+altKey+shiftKey together), so
  // this cannot fire during normal driving.
  if (e.ctrlKey && e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
    e.preventDefault()
    void handleToggleRequest()
  }
}

let installed = false

/** Call once, as early as possible. Idempotent. */
export function initDevModeToggle(): void {
  if (installed) return
  installed = true
  window.addEventListener('keydown', onKeyDown)
}
