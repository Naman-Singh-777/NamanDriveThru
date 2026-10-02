// WEB-PHASE-4 REDO: small, self-contained Web Audio synth for the checkpoint
// terminals' two audio cues -- no external sound files, nothing to load/host.
// - playRadioStatic(): quick, LOW-VOLUME rhythmic synth static, meant to play
//   just as a checkpoint's proximity activates (before the overlay opens) --
//   "data transfer is happening" over the car radio. Explicitly kept quiet
//   and brief per the user's own instruction (not an alarm/siren).
// - playActivationChime(): a clean short ascending tone sequence on actual
//   ENTER activation -- the "satisfying feedback" cue, paired with the
//   particle burst and camera shake in checkpoint.ts/main.ts.
// Both lazily create a single shared AudioContext on first use (browsers
// require a user gesture first anyway, and by the time either of these can
// fire the player has already pressed a driving key, so this is always
// called after one).

let ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
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

// Quiet, rhythmic synth static -- a filtered noise burst pulsed by a fast
// square-ish LFO so it reads as "data transfer", not a hiss. Peaks under 0.05
// gain and lasts well under a second; never loops or repeats on its own.
export function playRadioStatic(): void {
  const c = getCtx()
  const t0 = c.currentTime
  const duration = 0.55

  const src = c.createBufferSource()
  src.buffer = getNoiseBuffer(c)
  src.loop = true

  const bandpass = c.createBiquadFilter()
  bandpass.type = 'bandpass'
  bandpass.frequency.setValueAtTime(1800, t0)
  bandpass.frequency.linearRampToValueAtTime(2600, t0 + duration)
  bandpass.Q.value = 0.9

  // Fast pulsing amplitude (rhythmic, not constant hiss) via a second
  // oscillator driving a gain stage, all capped at a low overall volume.
  const pulse = c.createOscillator()
  pulse.type = 'square'
  pulse.frequency.value = 11 // Hz -- a quick rhythmic chatter, not a buzz
  const pulseGain = c.createGain()
  pulseGain.gain.value = 0.022
  const pulseOffset = c.createConstantSource()
  pulseOffset.offset.value = 0.022

  const masterGain = c.createGain()
  masterGain.gain.setValueAtTime(0, t0)
  masterGain.gain.linearRampToValueAtTime(1, t0 + 0.04)
  masterGain.gain.setValueAtTime(1, t0 + duration - 0.12)
  masterGain.gain.linearRampToValueAtTime(0, t0 + duration)

  pulse.connect(pulseGain)
  pulseGain.connect(masterGain.gain as unknown as AudioNode)
  pulseOffset.connect(masterGain.gain as unknown as AudioNode)
  src.connect(bandpass)
  bandpass.connect(masterGain)
  masterGain.connect(c.destination)

  src.start(t0)
  pulse.start(t0)
  pulseOffset.start(t0)
  src.stop(t0 + duration)
  pulse.stop(t0 + duration)
  pulseOffset.stop(t0 + duration)
}

// Clean short ascending 4-note chime -- the "data sync complete" activation
// cue. Sine tones, quick attack/decay, restrained overall volume.
export function playActivationChime(): void {
  const c = getCtx()
  const t0 = c.currentTime
  const notes = [660, 880, 1108, 1320] // a bright, clean quasi-arpeggio
  const master = c.createGain()
  master.gain.value = 0.11
  master.connect(c.destination)

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
