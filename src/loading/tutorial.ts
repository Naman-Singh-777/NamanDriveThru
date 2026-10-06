// Loading screen + tutorial. The markup lives in index.html (so it paints before any
// script), the look in wizard.css / campfire.css / loading.css. This module only drives
// it: the four tutorial steps, the 75/25 scene scaling, the real-loading gate, and the
// "skip / start" button that spits water on the campfire and then opens the game.
import './wizard.css'
import './campfire.css'
import './loading.css'
import './extras.css'

const STEP_COUNT = 4

const root = document.getElementById('loading')
const stage = document.getElementById('ld-stage')
const sceneBox = document.getElementById('ld-scene-box')
const action = root?.querySelector<HTMLElement>('.ld-action') ?? null
const progress = document.getElementById('ld-progress')
const fill = document.getElementById('loading-fill')
const skip = document.getElementById('ld-skip') as HTMLButtonElement | null
const skipText = document.getElementById('ld-skip-text')
const next = document.getElementById('ld-next') as HTMLButtonElement | null
const footNote = document.getElementById('ld-foot-note')
const stepsEl = document.getElementById('ld-steps')
const dots = Array.from(document.querySelectorAll<HTMLElement>('#ld-dots span'))
const steps = Array.from(document.querySelectorAll<HTMLElement>('#ld-steps .ld-step'))

let active = !!root
let loaded = false
let launched = false
let step = 0
let resolveStart: () => void = () => {}
const started = new Promise<void>((r) => {
  resolveStart = r
})

/** True from page load until the visitor presses SKIP TUTORIAL / START. */
export function isTutorialActive(): boolean {
  return active
}

/** Resolves once the visitor has pressed SKIP TUTORIAL / START. */
export function waitForStart(): Promise<void> {
  return started
}

/** Called by main.ts once the whole environment has really finished loading. */
export function markLoaded(): void {
  if (!root || loaded) return
  loaded = true
  progress?.setAttribute('hidden', '')
  skip?.removeAttribute('hidden')
  updateChrome()
  if (skip && !isTouch) skip.focus({ preventScroll: true })
}

// ---------- touch vs desktop copy (mirrors the game's own input-mode switching) ----------
// The same first guess the game's own controls make (touchControls.ts): only a phone/tablet OS with no
// mouse or trackpad starts in touch mode. `(pointer: coarse)` alone is wrong on touchscreen laptops, which
// report coarse and no fine pointer, so a PC used to show the phone instructions here.
const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
const mobileOS =
  nav.userAgentData?.mobile === true ||
  /Android|iPhone|iPad|iPod/i.test(nav.userAgent) ||
  (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1) // iPadOS posing as a Mac
let sawRealInput = false
const guessTouch = (): boolean => mobileOS && !window.matchMedia('(any-pointer: fine)').matches
let isTouch = guessTouch()
function applyInputMode(): void {
  root?.classList.toggle('is-touch', isTouch)
}
// until a real tap/click/key arrives, follow changes in the device's pointer capabilities
for (const q of ['(pointer: coarse)', '(any-pointer: fine)', '(any-pointer: coarse)']) {
  window.matchMedia(q).addEventListener('change', () => {
    if (sawRealInput) return
    isTouch = guessTouch()
    applyInputMode()
  })
}
// a real interaction always wins, in either direction
window.addEventListener(
  'pointerdown',
  (e) => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
    sawRealInput = true
    const t = e.pointerType !== 'mouse'
    if (t !== isTouch) {
      isTouch = t
      applyInputMode()
    }
  },
  { capture: true, passive: true },
)
window.addEventListener(
  'keydown',
  () => {
    sawRealInput = true
    if (isTouch && active) {
      isTouch = false
      applyInputMode()
    }
  },
  { capture: true, passive: true },
)

// ---------- steps ----------
function updateChrome(): void {
  const last = step === STEP_COUNT - 1
  steps.forEach((s, i) => s.classList.toggle('is-active', i === step))
  dots.forEach((d, i) => d.classList.toggle('on', i <= step))
  if (next) next.hidden = last
  const label = last ? 'START' : 'Skip tutorial'
  if (skipText) skipText.textContent = label
  skip?.style.setProperty('--content', `'${label}'`)
  if (footNote) {
    footNote.classList.toggle('is-ready', loaded)
    footNote.textContent = !loaded
      ? last
        ? 'Almost there. START appears the moment the world has loaded.'
        : 'Still loading. You can read ahead.'
      : last
        ? 'All set. Press START to drive.'
        : 'The world is ready. Skip any time.'
  }
  stepsEl?.scrollTo({ top: 0 })
  requestAnimationFrame(updateScrollHint)
}

// A soft fade at the bottom of the step list while there is more to scroll to.
function updateScrollHint(): void {
  if (!stepsEl) return
  stepsEl.classList.toggle('has-more', stepsEl.scrollHeight - stepsEl.scrollTop - stepsEl.clientHeight > 6)
}

function goNext(): void {
  if (step >= STEP_COUNT - 1) return
  step++
  updateChrome()
  // the NEXT button disappears on the last step; hand focus to START when it exists
  if (step === STEP_COUNT - 1 && loaded && skip && !isTouch) skip.focus({ preventScroll: true })
}

// ---------- scale the 640 x 480 scene to whatever the left 75% offers ----------
function fit(): void {
  if (!stage || !action) return
  const w = stage.clientWidth - 24
  const h = stage.clientHeight - action.offsetHeight - 48
  const k = Math.max(0.3, Math.min(1.5, Math.min(w / 640, h / 480)))
  stage.style.setProperty('--k', k.toFixed(4))
  updateScrollHint()
  // the step demo box (and the supplied maze loaders inside it) follow the viewport height
  const dh = window.innerHeight <= 520 ? 84 : Math.max(104, Math.min(180, window.innerHeight * 0.21))
  root?.style.setProperty('--dh', `${dh.toFixed(0)}px`)
  root?.style.setProperty('--ms1', Math.min(2.6, (dh * 0.8) / 40).toFixed(2))
  root?.style.setProperty('--ms2', ((dh * 0.8) / 70).toFixed(2))
}

// ---------- real progress for assistive tech ----------
function mirrorProgress(): void {
  if (!fill || !progress) return
  const sync = (): void => progress.setAttribute('aria-valuenow', String(Math.round(parseFloat(fill.style.width) || 0)))
  new MutationObserver(sync).observe(fill, { attributes: true, attributeFilter: ['style'] })
}

// ---------- skip / start: spit water on the fire, then open the game ----------
const reduceMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms))

function rectCenter(el: Element | null): { x: number; y: number; w: number; h: number } | null {
  const r = el?.getBoundingClientRect()
  if (!r || r.width === 0) return null
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
}

// The campfire's flames and logs are absolutely positioned (their wrappers measure 0 high), so the
// water's target is the union of the real flame and log boxes.
function fireBounds(scope: HTMLElement): { x: number; y: number; w: number; h: number } | null {
  let l = Infinity
  let t = Infinity
  let r = -Infinity
  let b = -Infinity
  scope.querySelectorAll('#ld-campfire .flame, #ld-campfire .log').forEach((el) => {
    const q = el.getBoundingClientRect()
    if (q.width === 0 || q.height === 0) return
    l = Math.min(l, q.left)
    t = Math.min(t, q.top)
    r = Math.max(r, q.right)
    b = Math.max(b, q.bottom)
  })
  if (!isFinite(l)) return rectCenter(document.getElementById('ld-fire-wrap'))
  return { x: (l + r) / 2, y: t + (b - t) * 0.5, w: r - l, h: b - t }
}

function spitWater(from: DOMRect, to: { x: number; y: number; w: number; h: number }): void {
  const x0 = from.left + from.width / 2
  const y0 = from.top + from.height * 0.1
  const DROPS = 30
  for (let i = 0; i < DROPS; i++) {
    const drop = document.createElement('div')
    drop.className = 'ld-drop'
    document.body.appendChild(drop)
    const spreadX = (Math.random() - 0.5) * to.w * 0.55
    const spreadY = (Math.random() - 0.3) * to.h * 0.25
    const sx = x0 + (Math.random() - 0.5) * from.width * 0.5
    const x1 = to.x + spreadX
    const y1 = to.y + spreadY
    const arc = 70 + Math.random() * 70 + Math.abs(y1 - y0) * 0.1
    const size = 0.7 + Math.random() * 0.8
    const frames: Keyframe[] = []
    const N = 14
    for (let s = 0; s <= N; s++) {
      const t = s / N
      const x = sx + (x1 - sx) * t
      const y = y0 + (y1 - y0) * t - arc * 4 * t * (1 - t)
      frames.push({
        transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(size * (1 - 0.35 * t)).toFixed(2)})`,
        opacity: s === 0 ? 0 : s === N ? 0 : 1,
        offset: t,
      })
    }
    const anim = drop.animate(frames, { duration: 620 + Math.random() * 220, delay: i * 24, easing: 'linear', fill: 'both' })
    anim.onfinish = () => drop.remove()
  }
}

function steam(to: { x: number; y: number; w: number; h: number }): void {
  for (let i = 0; i < 6; i++) {
    const puff = document.createElement('div')
    puff.className = 'ld-puff'
    document.body.appendChild(puff)
    const x = to.x + (Math.random() - 0.5) * to.w * 0.5
    const y = to.y + to.h * 0.1
    const rise = 90 + Math.random() * 70
    const drift = (Math.random() - 0.5) * 50
    const anim = puff.animate(
      [
        { transform: `translate(${x - 32}px, ${y - 32}px) scale(0.5)`, opacity: 0 },
        { transform: `translate(${x - 32 + drift * 0.4}px, ${y - 32 - rise * 0.4}px) scale(1.1)`, opacity: 0.85, offset: 0.35 },
        { transform: `translate(${x - 32 + drift}px, ${y - 32 - rise}px) scale(1.9)`, opacity: 0 },
      ],
      { duration: 1500 + Math.random() * 500, delay: i * 120, easing: 'ease-out', fill: 'both' },
    )
    anim.onfinish = () => puff.remove()
  }
}

// The shapes always fall with the fire. The supplied loop only drops them in one window of its 10 seconds,
// so on a press outside that window they would keep hovering over a dead fire. Freeze each one where it is
// and let it fall to the spot the loop itself lands them on.
function dropShapes(scope: HTMLElement): void {
  const rest = 'translateY(0px) rotate(-360deg)'
  scope.querySelectorAll<HTMLElement>('.objects .square, .objects .circle, .objects .triangle').forEach((el, i) => {
    const now = getComputedStyle(el).transform
    el.style.animation = 'none'
    el.style.transform = rest
    el.animate(
      [
        { transform: now === 'none' ? rest : now, offset: 0, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)' },
        { transform: rest, offset: 0.72, easing: 'ease-out' },
        { transform: 'translateY(-9px) rotate(-360deg)', offset: 0.86, easing: 'ease-in' },
        { transform: rest, offset: 1 },
      ],
      { duration: 700, delay: i * 90, fill: 'both' },
    )
  })
}

// The wizard keeps casting while the shapes hover. When the shapes fall his arms and hands come
// down to his sides again: each part is frozen where it is and eased back to its resting pose.
function lowerArms(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLElement>('.right-arm, .left-arm, .right-arm .right-hand, .left-arm .left-hand').forEach((el) => {
    const now = getComputedStyle(el).transform
    el.style.animation = 'none'
    const rest = getComputedStyle(el).transform
    el.animate(
      [{ transform: now === 'none' ? rest : now }, { transform: rest }],
      { duration: 900, delay: 140, easing: 'cubic-bezier(0.45, 0, 0.3, 1)', fill: 'both' },
    )
  })
}

// After the fire is out the wizard lets out a tired sigh, as if it happens every single time: he
// breathes in and puffs his chest out, then breathes out long and slow, slumping, head drooping toward
// the dead fire, with a soft cloud of breath drifting that way. Everything is frozen where it is and
// eased with the Web Animations API, same technique as lowerArms().
function sigh(scope: HTMLElement): void {
  const body = scope.querySelector<HTMLElement>('.wizard .body')
  const head = scope.querySelector<HTMLElement>('.wizard .head')
  if (!body || !head) return
  const IN = 650
  const OUT = 950
  const total = IN + OUT
  // head: freeze the casting loop where it is, then lift with the breath and sink with the sigh
  const now = getComputedStyle(head).transform
  head.style.animation = 'none'
  head.animate(
    [
      { transform: now === 'none' ? 'rotate(0deg)' : now, offset: 0, easing: 'ease-in-out' },
      { transform: 'translateY(-5px) rotate(1deg)', offset: IN / total, easing: 'ease-in-out' },
      { transform: 'translateY(6px) rotate(-9deg)', offset: 1 },
    ],
    { duration: total, fill: 'both' },
  )
  // chest: the robe swells on the in-breath, then settles a touch lower than it started
  body.style.transformOrigin = '50% 100%'
  body.animate(
    [
      { transform: 'scale(1, 1)', offset: 0, easing: 'ease-out' },
      { transform: 'scale(1.12, 1.05)', offset: IN / total, easing: 'ease-in-out' },
      { transform: 'scale(0.97, 0.965)', offset: 1 },
    ],
    { duration: total, fill: 'both' },
  )
  // breath: a few soft clouds leave his mouth on the out-breath and drift toward the fire
  const face = scope.querySelector('.wizard .head .face')?.getBoundingClientRect()
  if (!face) return
  const x0 = face.left + 4
  const y0 = face.top + face.height * 0.9
  for (let i = 0; i < 4; i++) {
    const puff = document.createElement('div')
    puff.className = 'ld-puff'
    document.body.appendChild(puff)
    const dx = -(46 + i * 22 + Math.random() * 14)
    const dy = 8 + i * 5 + Math.random() * 8
    const s0 = 0.28 + i * 0.05
    const s1 = 0.75 + i * 0.22
    const anim = puff.animate(
      [
        { transform: `translate(${x0 - 32}px, ${y0 - 32}px) scale(${s0})`, opacity: 0 },
        { transform: `translate(${x0 - 32 + dx * 0.4}px, ${y0 - 32 + dy * 0.4}px) scale(${(s0 + s1) / 2})`, opacity: 0.8, offset: 0.3 },
        { transform: `translate(${x0 - 32 + dx}px, ${y0 - 32 + dy}px) scale(${s1})`, opacity: 0 },
      ],
      { duration: 1250 + i * 120, delay: IN + i * 110, easing: 'ease-out', fill: 'both' },
    )
    anim.onfinish = () => puff.remove()
  }
}
async function launch(): Promise<void> {
  if (!root || launched || !loaded) return
  launched = true
  const btn = skip
  const fire = fireBounds(root)
  const quick = reduceMotion() || !btn || !fire

  if (!quick && btn && fire) {
    btn.classList.add('is-spitting')
    spitWater(btn.getBoundingClientRect(), fire)
    await sleep(520)
    root.classList.add('is-dousing')
    dropShapes(root)
    lowerArms(root)
    const glow = root.querySelectorAll<HTMLElement>('.ld-glow, .ld-firelight')
    glow.forEach((g) => g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1300, delay: 250, easing: 'ease-in', fill: 'forwards' }))
    await sleep(380)
    btn.classList.add('is-spent')
    steam(fire)
    await sleep(700)
    sigh(root) // fire is out and his arms are down: breathe in, puff the chest, sigh it out
    await sleep(1400)
  } else {
    root.classList.add('is-dousing')
    await sleep(250)
  }

  active = false
  root.classList.add('is-leaving')
  resolveStart() // the game starts under the fading screen
  await sleep(750)
  root.style.display = 'none'
}

// ---------- init ----------
if (root && stage && sceneBox && action && skip && next) {
  applyInputMode()
  fit()
  new ResizeObserver(fit).observe(stage)
  mirrorProgress()
  updateChrome()
  next.addEventListener('click', goNext)
  skip.addEventListener('click', () => void launch())
  stepsEl?.addEventListener('scroll', updateScrollHint, { passive: true })
  if (!isTouch) next.focus({ preventScroll: true })
}
