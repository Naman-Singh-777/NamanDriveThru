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
  const held = new Set<string>()
  const state: InputState = { forward: false, reverse: false, left: false, right: false, brake: false }

  function recompute() {
    state.forward = [...FORWARD_KEYS].some((k) => held.has(k))
    state.reverse = [...REVERSE_KEYS].some((k) => held.has(k))
    state.left = [...LEFT_KEYS].some((k) => held.has(k))
    state.right = [...RIGHT_KEYS].some((k) => held.has(k))
    state.brake = [...BRAKE_KEYS].some((k) => held.has(k))
  }

  window.addEventListener('keydown', (e) => {
    if (NAV_KEYS.has(e.code)) e.preventDefault()
    held.add(e.code)
    recompute()
  })
  window.addEventListener('keyup', (e) => {
    held.delete(e.code)
    recompute()
  })
  window.addEventListener('blur', () => {
    held.clear()
    recompute()
  })

  return state
}
