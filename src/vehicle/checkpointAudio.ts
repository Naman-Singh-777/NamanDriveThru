// WEB-PHASE-4 REDO: small, self-contained Web Audio synth for the checkpoint
// terminals' two audio cues -- no external sound files, nothing to load/host.
// - playProximityCue(): a quiet sci-fi "sensor sweep" -- three quick ascending
//   digital blips over a faint filtered shimmer -- meant to play just as a
//   checkpoint's proximity activates (before the overlay opens). Replaces an
//   earlier radio-static version per the user's own request for something
//   more "appropriate sci-fi"; still explicitly kept quiet and brief (not an
//   alarm/siren).
// - playActivationChime(): a clean short ascending tone sequence on actual
//   ENTER activation -- the "satisfying feedback" cue, paired with the
//   particle burst and camera shake in checkpoint.ts/main.ts.
// Both lazily create a single shared AudioContext on first use (browsers
// require a user gesture first anyway, and by the time either of these can
// fire the player has already pressed a driving key, so this is always
// called after one).

let ctx: AudioContext | null = null
// WEB-PHASE-4 REDO Phase 11: every SFX node below routes through this single
// master gain instead of straight to ctx.destination, so setSfxDucking() can
// turn the map's sound effects down while music is playing without touching
// each cue's own internal gain envelope.
let sfxMaster: GainNode | null = null

function getCtx(): AudioContext {
  if (!ctx) {
    // 'playback' asks for a larger output buffer: a few extra milliseconds of
    // latency on the SFX cues, in exchange for music that does not drop out
    // when the driving scene is hogging the CPU/GPU.
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new Ctor({ latencyHint: 'playback' })
    sfxMaster = ctx.createGain()
    sfxMaster.gain.value = 1
    sfxMaster.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// Shared across the whole app (see src/vehicle/musicPlayer.ts) so the
// checkpoint cues and the music player are nodes on the ONE real
// AudioContext a page is meant to have, not two independent ones.
export function getSharedAudioContext(): AudioContext {
  return getCtx()
}

// Called by musicPlayer.ts whenever a track starts/stops playing -- ramps
// the map's own sound effects (proximity cue, activation chime) down to a
// lower volume while music is audible, and back up to full once it isn't,
// rather than a hard, clicky cut.
export function setSfxDucking(active: boolean): void {
  getCtx() // ensures sfxMaster exists
  const g = sfxMaster!.gain
  const now = ctx!.currentTime
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  g.linearRampToValueAtTime(active ? 0.35 : 1, now + 0.35)
}

let noiseBuffer: AudioBuffer | null = null
function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer
  const len = c.sampleRate * 1 // 1s of noise, looped
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  noiseBuffer = buf
  return buf
}

// Quiet sci-fi "sensor sweep": three quick ascending digital blips (clean
// square-wave, filtered) over a very faint high, sweeping shimmer of filtered
// noise underneath for texture -- reads as a scanner/terminal detecting the
// car, not an alarm. Peaks under 0.08 gain, done in well under a second.
export function playProximityCue(): void {
  const c = getCtx()
  const t0 = c.currentTime
  const duration = 0.42

  // Faint shimmer bed -- filtered noise swept upward, very quiet, purely
  // textural underneath the three blips below.
  const shimmer = c.createBufferSource()
  shimmer.buffer = getNoiseBuffer(c)
  shimmer.loop = true
  const shimmerFilter = c.createBiquadFilter()
  shimmerFilter.type = 'bandpass'
  shimmerFilter.frequency.setValueAtTime(3200, t0)
  shimmerFilter.frequency.linearRampToValueAtTime(5200, t0 + duration)
  shimmerFilter.Q.value = 1.2
  const shimmerGain = c.createGain()
  shimmerGain.gain.setValueAtTime(0, t0)
  shimmerGain.gain.linearRampToValueAtTime(0.018, t0 + 0.05)
  shimmerGain.gain.linearRampToValueAtTime(0, t0 + duration)
  shimmer.connect(shimmerFilter)
  shimmerFilter.connect(shimmerGain)
  shimmerGain.connect(sfxMaster!)
  shimmer.start(t0)
  shimmer.stop(t0 + duration)

  // Three quick ascending digital blips -- a "sensor lock" readout.
  const blipFreqs = [1046, 1318, 1568] // a bright, clean ascending triad
  blipFreqs.forEach((freq, i) => {
    const start = t0 + i * 0.1
    const osc = c.createOscillator()
    osc.type = 'square'
    osc.frequency.value = freq
    const blipFilter = c.createBiquadFilter()
    blipFilter.type = 'lowpass'
    blipFilter.frequency.value = 2600
    const g = c.createGain()
    g.gain.setValueAtTime(0, start)
    g.gain.linearRampToValueAtTime(0.06, start + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0008, start + 0.09)
    osc.connect(blipFilter)
    blipFilter.connect(g)
    g.connect(sfxMaster!)
    osc.start(start)
    osc.stop(start + 0.1)
  })
}

// WEB-PHASE-4 REDO Phase 17: a small, cute "achievement unlocked" jingle --
// a bright 3-note bell figure (sine + a touch of triangle for sparkle) that
// bounces up then lands a fifth above where it started, plus a quick high
// "sparkle" grace note on top. Distinct from playActivationChime() (which
// plays on every checkpoint entry) -- this one only plays once per
// checkpoint, the moment its achievement toast appears.
export function playAchievementChime(): void {
  const c = getCtx()
  const t0 = c.currentTime
  const master = c.createGain()
  master.gain.value = 0.13
  master.connect(sfxMaster!)

  // The bouncy little "ta-da" -- up a fourth, up a minor third, a tiny
  // flourish on top (bright triangle wave, not sine, for extra sparkle).
  const notes: { freq: number; start: number; dur: number; type: OscillatorType }[] = [
    { freq: 784, start: 0, dur: 0.16, type: 'sine' }, // G5
    { freq: 1046, start: 0.09, dur: 0.18, type: 'sine' }, // C6
    { freq: 1568, start: 0.2, dur: 0.3, type: 'triangle' } // G6 sparkle, lands and lingers
  ]
  notes.forEach(({ freq, start, dur, type }) => {
    const t = t0 + start
    const osc = c.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    const g = c.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(1, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    osc.connect(g)
    g.connect(master)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  })
}

// Clean short ascending 4-note chime -- the "data sync complete" activation
// cue. Sine tones, quick attack/decay, restrained overall volume.
export function playActivationChime(): void {
  const c = getCtx()
  const t0 = c.currentTime
  const notes = [660, 880, 1108, 1320] // a bright, clean quasi-arpeggio
  const master = c.createGain()
  master.gain.value = 0.11
  master.connect(sfxMaster!)

  notes.forEach((freq, i) => {
    const start = t0 + i * 0.07
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    const g = c.createGain()
    g.gain.setValueAtTime(0, start)
    g.gain.linearRampToValueAtTime(1, start + 0.015)
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.32)
    osc.connect(g)
    g.connect(master)
    osc.start(start)
    osc.stop(start + 0.34)
  })
}
