import * as Tone from 'tone'
import type { BreathPhase, IAudioEngine } from '../types'

const CHORD_PROGRESSIONS: ReadonlyArray<readonly string[]> = [
  ['C3', 'G3', 'D4', 'G4'],
  ['A2', 'E3', 'B3', 'E4'],
  ['F2', 'C3', 'G3', 'C4'],
  ['D2', 'A2', 'E3', 'A3'],
]

export class SoundEngine implements IAudioEngine {
  private readonly output: Tone.Gain
  private readonly filter: Tone.Filter
  private readonly reverb: Tone.Reverb
  private readonly pad: Tone.PolySynth<Tone.Synth>
  private readonly shimmerLfo: Tone.LFO
  private readonly pulseLoop: Tone.Loop

  private started = false
  private disposed = false
  private breathPhase: BreathPhase = 'idle'
  private breathIntensity = 0
  private ambientDepth = 0

  constructor() {
    this.output = new Tone.Gain(0.06).toDestination()
    this.filter = new Tone.Filter({
      type: 'lowpass',
      frequency: 620,
      Q: 0.8,
      rolloff: -24,
    })
    this.reverb = new Tone.Reverb({
      decay: 8.5,
      preDelay: 0.08,
      wet: 0.22,
    })
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: {
        attack: 2.8,
        decay: 1.2,
        sustain: 0.72,
        release: 6.5,
      },
    })

    this.shimmerLfo = new Tone.LFO({
      frequency: 0.07,
      min: 220,
      max: 1_200,
      type: 'sine',
    }).start()

    this.pad.connect(this.reverb)
    this.reverb.connect(this.filter)
    this.filter.connect(this.output)
    this.shimmerLfo.connect(this.filter.frequency)

    this.pulseLoop = new Tone.Loop((time) => {
      this.triggerAmbientChord(time)
    }, '2m')
    this.pulseLoop.humanize = 0.015
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) {
      return
    }

    await Tone.start()
    await this.reverb.ready

    const transport = Tone.getTransport()
    transport.bpm.rampTo(42, 0.5)
    this.pulseLoop.start(0)
    if (transport.state !== 'started') {
      transport.start()
    }

    this.started = true
    this.triggerAmbientChord(Tone.now() + 0.05)
  }

  setBreathParameters(phase: BreathPhase, intensity: number): void {
    this.breathPhase = phase
    this.breathIntensity = clamp01(intensity)

    const phaseOffset =
      phase === 'inhale' ? 240 : phase === 'hold' ? 110 : phase === 'exhale' ? -120 : -180
    const targetCutoff =
      280 + this.ambientDepth * 960 + this.breathIntensity * 520 + phaseOffset
    this.filter.frequency.rampTo(Math.max(120, targetCutoff), 0.22)

    const targetGain = clamp(
      0.03 + this.ambientDepth * 0.08 + this.breathIntensity * 0.05,
      0.02,
      0.19,
    )
    this.output.gain.rampTo(targetGain, 0.22)

    const detune =
      (phase === 'inhale' ? 12 : phase === 'hold' ? 4 : phase === 'exhale' ? -8 : 0) +
      (this.breathIntensity - 0.5) * 14
    this.pad.set({ detune })
  }

  setAmbientDepth(depth: number): void {
    this.ambientDepth = clamp01(depth)

    const wet = 0.14 + this.ambientDepth * 0.5
    this.reverb.wet.rampTo(wet, 0.7)

    this.shimmerLfo.min = 180 + this.ambientDepth * 400
    this.shimmerLfo.max = 950 + this.ambientDepth * 1_450
    this.shimmerLfo.frequency.value = 0.05 + this.ambientDepth * 0.09
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true

    this.pulseLoop.stop(0)
    this.pulseLoop.dispose()

    this.shimmerLfo.stop()
    this.shimmerLfo.dispose()

    this.pad.releaseAll()
    this.pad.dispose()
    this.reverb.dispose()
    this.filter.dispose()
    this.output.dispose()

    const transport = Tone.getTransport()
    if (transport.state === 'started') {
      transport.stop()
    }
    transport.cancel(0)

    this.started = false
  }

  private triggerAmbientChord(time: number): void {
    if (!this.started || this.disposed) {
      return
    }

    const baseChord = this.selectChordByDepth()
    const chord = [...baseChord]
    if (this.breathPhase === 'inhale' && this.breathIntensity > 0.75) {
      chord.push('G5')
    }

    const velocity = clamp(0.24 + this.ambientDepth * 0.25 + this.breathIntensity * 0.18, 0.18, 0.72)
    this.pad.triggerAttackRelease(chord, '1m', time, velocity)
  }

  private selectChordByDepth(): readonly string[] {
    const chordIndex = Math.min(
      CHORD_PROGRESSIONS.length - 1,
      Math.floor(this.ambientDepth * CHORD_PROGRESSIONS.length),
    )
    return CHORD_PROGRESSIONS[chordIndex]
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}
