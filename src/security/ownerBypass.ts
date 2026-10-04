// WEB-PHASE-4 REDO Phase 19 -- owner-only deterrence bypass.
//
// Replaces the old "Developer Mode" feature entirely (that reset-everything,
// passphrase-gated mode has been removed -- see achievements.ts, which now
// gives every visitor a fresh run automatically via sessionStorage, no
// toggle needed). The one piece of Developer Mode worth keeping on its own:
// a way for the site owner to turn OFF the right-click/DevTools-shortcut
// deterrence layer (src/security/deterrence.ts) for their own browser,
// since they're the one person who actually needs DevTools on this site
// regularly. Deterrence stays ON for every other visitor, unchanged.
//
// Same honesty note as before: this is a passphrase gate, not real auth --
// no backend exists to keep the passphrase secret from someone holding the
// full client-side source. It only has to be inconvenient for a casual
// visitor to flip, not cryptographically secure.

const BYPASS_FLAG_KEY = 'wf13:ownerbypass'

// SHA-256 hex digest of the same owner passphrase as before: "naman-dev-2026".
// Change it any time -- open DevTools console on the live site and run:
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('your-new-phrase'))
//     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')))
// then paste the printed hex string in below.
const PASSPHRASE_HASH_HEX = '42adcc8b219e5d30a6b58698ba9ce1e22921992ae81f8646578b44403c592b20'

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Checked once at page load, before deciding whether to install the deterrence listeners at all. */
export function isOwnerBypassOn(): boolean {
  try {
    return localStorage.getItem(BYPASS_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

async function handleToggleRequest(): Promise<void> {
  const enabling = !isOwnerBypassOn()
  const phrase = window.prompt(
    enabling
      ? 'Enter the owner passphrase to turn OFF right-click/DevTools blocking for this browser:'
      : 'Enter the owner passphrase to turn right-click/DevTools blocking back ON:'
  )
  if (phrase == null) return // cancelled
  const hash = await sha256Hex(phrase)
  if (hash !== PASSPHRASE_HASH_HEX) {
    window.alert('Incorrect passphrase.')
    return
  }
  try {
    if (enabling) localStorage.setItem(BYPASS_FLAG_KEY, '1')
    else localStorage.removeItem(BYPASS_FLAG_KEY)
  } catch {
    // ignore -- see isOwnerBypassOn()
  }
  window.alert(
    enabling
      ? 'Right-click and DevTools shortcuts are now unblocked for this browser. Reloading.'
      : 'Right-click and DevTools shortcuts are blocked again for this browser. Reloading.'
  )
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

/** Call once, as early as possible -- works even while deterrence is active, since it's a separate listener. */
export function initOwnerBypassToggle(): void {
  if (installed) return
  installed = true
  window.addEventListener('keydown', onKeyDown)
}
