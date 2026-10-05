import * as THREE from 'three'
import type { CheckpointDef } from './checkpoint'

// Overview-only location labels. Pure DOM, pointer-events:none, never added to
// the three.js scene -- so they cannot touch the map, colliders, or drivable
// path. main.ts passes a 0..1 alpha each frame (0 whenever the overview camera
// is not active), and at 0 every label is display:none.
const NAMES: Record<string, string> = { port: 'PORT', platform: 'PLATFORM', city: 'CITY' }

export class OverviewLabels {
  private readonly items: { el: HTMLDivElement; world: THREE.Vector3 }[] = []
  private readonly ndc = new THREE.Vector3()
  private shown = false

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
      this.items.push({ el, world: def.position.clone() })
    }
  }

  update(camera: THREE.PerspectiveCamera, alpha: number): void {
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
      it.el.style.transform = 'translate(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px) translate(-50%, -140%)'
    }
  }
}