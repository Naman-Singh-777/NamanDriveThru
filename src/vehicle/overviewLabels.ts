import * as THREE from 'three'
import type { Checkpoint, CheckpointDef } from './checkpoint'

// Overview-only location labels. Pure DOM, pointer-events:none, never added to
// the three.js scene -- so they cannot touch the map, colliders, or drivable
// path. main.ts passes a 0..1 alpha each frame (0 whenever the overview camera
// is not active), and at 0 every label is display:none.
const NAMES: Record<string, string> = { port: 'PORT', platform: 'PLATFORM', city: 'CITY' }

// While the car is inside a checkpoint the floating "PROJECTS <enter>" prompt
// opens on the same spot the label sits on, and the two text pills overlap.
// The label of the active checkpoint steps clear of the prompt (above it, or
// below it when above would leave the screen) and eases back when it closes.
const PROMPT_ANCHOR_LIFT = 6 // same world-space lift checkpoint.ts anchors the prompt at
const GAP = 6 // px kept between the two pills
const EDGE = 4 // px minimum distance from the top of the viewport

export class OverviewLabels {
  private readonly items: { id: string; el: HTMLDivElement; world: THREE.Vector3; dy: number }[] = []
  private readonly ndc = new THREE.Vector3()
  private readonly pNdc = new THREE.Vector3()
  private shown = false
  private last = 0

  constructor(defs: CheckpointDef[]) {
    for (const def of defs) {
      const el = document.createElement('div')
      const css = el.style
      const tint = def.color.getStyle()
      css.position = 'fixed'
      css.left = '0'
      css.top = '0'
      css.zIndex = '13'
      css.pointerEvents = 'none'
      css.display = 'none'
      css.willChange = 'transform, opacity'
      css.padding = '5px 12px 4px 15px'
      css.borderRadius = '999px'
      css.border = '1px solid ' + tint
      css.background = 'rgba(8, 14, 28, 0.66)'
      css.boxShadow = '0 0 10px ' + tint
      css.color = '#eaf3ff'
      css.font = '800 17px/1 "Big Shoulders Display", "Arial Narrow", Impact, sans-serif'
      css.letterSpacing = '0.22em'
      css.whiteSpace = 'nowrap'
      el.setAttribute('aria-hidden', 'true')
      el.textContent = NAMES[def.id] ?? def.label.toUpperCase()
      document.body.appendChild(el)
      this.items.push({ id: def.id, el, world: def.position.clone(), dy: 0 })
    }
  }

  update(camera: THREE.PerspectiveCamera, alpha: number, active: Checkpoint | null = null): void {
    if (alpha <= 0.001) {
      if (this.shown) {
        for (const it of this.items) it.el.style.display = 'none'
        this.shown = false
      }
      return
    }
    this.shown = true
    camera.updateMatrixWorld()
    const w = window.innerWidth
    const h = window.innerHeight
    const now = performance.now()
    const k = 1 - Math.exp(-Math.min(0.1, Math.max(0, (now - this.last) / 1000)) * 16)
    this.last = now
    for (const it of this.items) {
      this.ndc.copy(it.world).project(camera)
      if (this.ndc.z > 1 || this.ndc.z < -1) {
        it.el.style.display = 'none'
        continue
      }
      const x = (this.ndc.x * 0.5 + 0.5) * w
      const y = (-this.ndc.y * 0.5 + 0.5) * h
      it.el.style.display = 'block'
      it.el.style.opacity = alpha.toFixed(3)
      const target = active && active.def.id === it.id ? this.clearance(it.el, x, y, active, camera) : 0
      it.dy += (target - it.dy) * k
      if (Math.abs(target - it.dy) < 0.05) it.dy = target
      it.el.style.transform = 'translate(' + x.toFixed(1) + 'px, ' + (y + it.dy).toFixed(1) + 'px) translate(-50%, -140%)'
    }
  }

  // Vertical shift (px) that takes this label off the checkpoint's prompt, or 0
  // when they do not overlap. Positions mirror the CSS transforms: the label is
  // centred on x and translated -140% of its own height, the prompt is centred
  // on its anchor and sits entirely above it.
  private clearance(el: HTMLDivElement, x: number, y: number, cp: Checkpoint, camera: THREE.PerspectiveCamera): number {
    const prompt = cp.promptEl
    if (prompt.style.display === 'none') return 0
    const pH = prompt.offsetHeight
    const pW = prompt.offsetWidth
    if (!pH) return 0
    const pos = cp.def.position
    this.pNdc.set(pos.x, pos.y + PROMPT_ANCHOR_LIFT, pos.z).project(camera)
    if (this.pNdc.z > 1) return 0
    const xP = (this.pNdc.x * 0.5 + 0.5) * window.innerWidth
    const yP = (-this.pNdc.y * 0.5 + 0.5) * window.innerHeight
    const lW = el.offsetWidth
    const lH = el.offsetHeight
    const lTop = y - 1.4 * lH
    const lBottom = y - 0.4 * lH
    const overlapX = Math.abs(x - xP) < (lW + pW) / 2 + GAP
    const overlapY = lBottom > yP - pH - GAP && lTop < yP + GAP
    if (!overlapX || !overlapY) return 0
    const up = yP - pH - GAP - lBottom
    return lTop + up >= EDGE ? up : yP + GAP - lTop
  }
}