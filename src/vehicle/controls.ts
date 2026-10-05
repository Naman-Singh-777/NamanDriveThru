// WASD + Arrow key input, combined into one logical state so either scheme
// (or both at once) drives the car without duplicate/stuck-key bugs.
export interface InputState {
  forward: boolean
  reverse: boolean
  left: boolean
  right: boolean
  brake: boolean
}

const FORWARD_KEYS = new Set(['KeyW', 'ArrowUp'])
const REVERSE_KEYS = new Set(['KeyS', 'ArrowDown'])
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft'])
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight'])
const BRAKE_KEYS = new Set(['Space'])
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'])

export function createControls(): InputState {
  // Keys currently down, in the order they were pressed. Opposite keys (W/S, A/D)
  // are resolved by recency: the one pressed last wins, and the earlier one takes
  // over again if the later one is released while it is still down.
  const held: string[] = []
  const state: InputState = { forward: false, reverse: false, left: false, right: false, brake: false }

  function axis(a: Set<string>, b: Set<string>): 1 | -1 | 0 {
    for (let i = held.length - 1; i >= 0; i--) {
      if (a.has(held[i])) return 1
      if (b.has(held[i])) return -1
    }
    return 0
  }

  function recompute() {
    const fr = axis(FORWARD_KEYS, REVERSE_KEYS)
    const lr = axis(LEFT_KEYS, RIGHT_KEYS)
    state.forward = fr === 1
    state.reverse = fr === -1
    state.left = lr === 1
    state.right = lr === -1
    state.brake = held.some((k) => BRAKE_KEYS.has(k))
  }

  function releaseAll() {
    held.length = 0
    recompute()
  }

  window.addEventListener('keydown', (e) => {
    if (NAV_KEYS.has(e.code)) e.preventDefault()
    const i = held.indexOf(e.code)
    if (i === -1) held.push(e.code)
    else if (!e.repeat) {
      // A fresh press of a key we thought was already down means we missed its keyup.
      held.splice(i, 1)
      held.push(e.code)
    }
    recompute()
  })
  window.addEventListener('keyup', (e) => {
    const i = held.indexOf(e.code)
    if (i !== -1) held.splice(i, 1)
    recompute()
  })
  // Keyups can be swallowed when focus changes or the page goes fullscreen,
  // which would leave a key "stuck" down and fight the one actually pressed.
  window.addEventListener('blur', releaseAll)
  document.addEventListener('visibilitychange', releaseAll)
  document.addEventListener('fullscreenchange', releaseAll)

  return state
}
