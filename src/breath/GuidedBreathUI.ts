import type {
  BreathPhase,
  BreathSnapshot,
  IBreathSource,
  Unsubscribe,
} from '../types'

interface BreathSegment {
  phase: Exclude<BreathPhase, 'idle'>
  durationMs: number
}

export interface GuidedBreathUIOptions {
  container?: HTMLElement
}

const BREATH_PATTERN: BreathSegment[] = [
  { phase: 'inhale', durationMs: 4_000 },
  { phase: 'hold', durationMs: 7_000 },
  { phase: 'exhale', durationMs: 8_000 },
]

export class GuidedBreathUI implements IBreathSource {
  phase: BreathPhase = 'idle'
  intensity = 0
  depth = 0

  private phaseProgress = 0
  private phaseRemainingSeconds: number | null = null
  private cycleCount = 0
  private consistency = 0.75
  private activeSegmentIndex = 0
  private segmentStartedAtMs = 0
  private lastTickAtMs = 0
  private isRunning = false
  private rafId: number | null = null

  private readonly subscribers = new Set<(state: BreathSnapshot) => void>()
  private readonly root: HTMLDivElement
  private readonly phaseLabel: HTMLSpanElement
  private readonly progressBar: HTMLDivElement
  private readonly cycleLabel: HTMLSpanElement
  private readonly depthLabel: HTMLSpanElement
  private readonly toggleButton: HTMLButtonElement
  private readonly toggleHandler: () => void

  constructor(options: GuidedBreathUIOptions = {}) {
    const host = options.container ?? document.body

    this.root = document.createElement('div')
    this.root.style.cssText = [
      'position: fixed',
      'left: 16px',
      'bottom: 16px',
      'z-index: 30',
      'width: min(320px, calc(100vw - 32px))',
      'padding: 14px 16px',
      'border-radius: 14px',
      'background: rgba(4, 8, 24, 0.78)',
      'backdrop-filter: blur(8px)',
      'border: 1px solid rgba(170, 190, 255, 0.26)',
      'color: #eef3ff',
      'font-family: "Segoe UI", Tahoma, sans-serif',
      'box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35)',
    ].join(';')

    const title = document.createElement('h2')
    title.textContent = 'Guided 4-7-8 Breath'
    title.style.cssText = 'margin: 0 0 8px 0; font-size: 15px; font-weight: 600;'

    const subtitle = document.createElement('p')
    subtitle.textContent = '화면 안내에 따라 호흡하세요 \u2022 Inhale 4s \u00B7 Hold 7s \u00B7 Exhale 8s'
    subtitle.style.cssText =
      'margin: 0 0 10px 0; font-size: 12px; color: rgba(232, 238, 255, 0.76);'

    const row = document.createElement('div')
    row.style.cssText =
      'display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;'

    const phaseTitle = document.createElement('span')
    phaseTitle.textContent = 'Phase'
    phaseTitle.style.cssText = 'font-size: 12px; color: rgba(232, 238, 255, 0.74);'

    this.phaseLabel = document.createElement('span')
    this.phaseLabel.style.cssText = 'font-size: 14px; font-weight: 600;'

    row.append(phaseTitle, this.phaseLabel)

    const progressTrack = document.createElement('div')
    progressTrack.style.cssText =
      'height: 8px; border-radius: 999px; overflow: hidden; background: rgba(255, 255, 255, 0.14); margin-bottom: 10px;'
    this.progressBar = document.createElement('div')
    this.progressBar.style.cssText =
      'height: 100%; width: 0%; background: linear-gradient(90deg, #89a6ff, #8fe1ff); transition: width 120ms linear;'
    progressTrack.append(this.progressBar)

    const meta = document.createElement('div')
    meta.style.cssText =
      'display: flex; justify-content: space-between; gap: 12px; margin-bottom: 12px; font-size: 12px;'

    this.cycleLabel = document.createElement('span')
    this.depthLabel = document.createElement('span')
    meta.append(this.cycleLabel, this.depthLabel)

    this.toggleButton = document.createElement('button')
    this.toggleButton.type = 'button'
    this.toggleButton.style.cssText = [
      'width: 100%',
      'border: none',
      'border-radius: 10px',
      'padding: 10px 12px',
      'font-size: 13px',
      'font-weight: 600',
      'cursor: pointer',
      'background: linear-gradient(90deg, #8ac3ff, #8fffe8)',
      'color: #05132c',
    ].join(';')

    this.toggleHandler = () => {
      if (this.isRunning) {
        this.stop()
      } else {
        this.start()
      }
    }
    this.toggleButton.addEventListener('click', this.toggleHandler)

    this.root.append(title, subtitle, row, progressTrack, meta, this.toggleButton)
    host.append(this.root)

    this.render()
    this.publishSnapshot()
  }

  start(): void {
    if (this.isRunning) {
      return
    }

    this.resetSession()
    this.isRunning = true
    this.phase = BREATH_PATTERN[0].phase
    this.segmentStartedAtMs = performance.now()
    this.lastTickAtMs = this.segmentStartedAtMs
    this.phaseRemainingSeconds = Math.ceil(BREATH_PATTERN[0].durationMs / 1000)
    this.publishSnapshot()
    this.render()
    this.rafId = requestAnimationFrame(this.tick)
  }

  stop(): void {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    this.phase = 'idle'
    this.phaseProgress = 0
    this.phaseRemainingSeconds = null
    this.intensity = 0
    this.consistency = Math.max(0.25, this.consistency * 0.92)
    this.publishSnapshot()
    this.render()
  }

  subscribe(callback: (state: BreathSnapshot) => void): Unsubscribe {
    this.subscribers.add(callback)
    callback(this.snapshot())

    return () => {
      this.subscribers.delete(callback)
    }
  }

  dispose(): void {
    this.stop()
    this.toggleButton.removeEventListener('click', this.toggleHandler)
    this.subscribers.clear()
    this.root.remove()
  }

  private readonly tick = (timestampMs: number): void => {
    if (!this.isRunning) {
      return
    }

    const segment = BREATH_PATTERN[this.activeSegmentIndex]
    const elapsedMs = timestampMs - this.segmentStartedAtMs
    const deltaMs = Math.max(1, timestampMs - this.lastTickAtMs)
    this.lastTickAtMs = timestampMs

    this.phase = segment.phase
    this.phaseProgress = Math.min(1, elapsedMs / segment.durationMs)
    this.phaseRemainingSeconds = Math.max(
      0,
      Math.ceil((segment.durationMs - elapsedMs) / 1000),
    )
    const targetIntensity = this.targetIntensity(segment.phase, this.phaseProgress)
    this.intensity += (targetIntensity - this.intensity) * 0.18

    const depthGainRate =
      segment.phase === 'inhale'
        ? 0.010
        : segment.phase === 'hold'
          ? 0.007
          : 0.014
    const consistencyWeight = 0.65 + this.consistency * 0.35
    const depthGain = (deltaMs / 1000) * depthGainRate * consistencyWeight
    this.depth = Math.min(1, this.depth + depthGain)
    this.consistency += (1 - this.consistency) * 0.02

    if (elapsedMs >= segment.durationMs) {
      this.advanceSegment(timestampMs)
    }

    this.publishSnapshot()
    this.render()
    this.rafId = requestAnimationFrame(this.tick)
  }

  private advanceSegment(timestampMs: number): void {
    this.activeSegmentIndex += 1

    if (this.activeSegmentIndex >= BREATH_PATTERN.length) {
      this.activeSegmentIndex = 0
      this.cycleCount += 1
      this.depth = Math.min(1, this.depth + 0.02 + this.consistency * 0.015)
    }

    this.segmentStartedAtMs = timestampMs
  }

  private targetIntensity(phase: Exclude<BreathPhase, 'idle'>, progress: number): number {
    switch (phase) {
      case 'inhale':
        return progress
      case 'hold':
        return 0.92
      case 'exhale':
        return 1 - progress
    }
  }

  private snapshot(): BreathSnapshot {
    return {
      phase: this.phase,
      phaseProgress: this.phaseProgress,
      intensity: this.intensity,
      depth: this.depth,
      cycleCount: this.cycleCount,
      consistency: this.consistency,
    }
  }

  private publishSnapshot(): void {
    const nextSnapshot = this.snapshot()
    for (const callback of this.subscribers) {
      callback(nextSnapshot)
    }
  }

  private render(): void {
    this.phaseLabel.textContent = this.formatPhaseLabel(
      this.phase,
      this.phaseRemainingSeconds,
    )
    this.progressBar.style.width = `${Math.round(this.phaseProgress * 100)}%`
    this.cycleLabel.textContent = `Cycles: ${this.cycleCount}`
    this.depthLabel.textContent = `Depth: ${(this.depth * 100).toFixed(0)}%`
    this.toggleButton.textContent = this.isRunning ? 'Stop Session' : 'Start Session'
  }

  private formatPhaseLabel(phase: BreathPhase, remainingSeconds: number | null): string {
    const withRemaining = (label: string): string => {
      if (remainingSeconds === null) {
        return label
      }
      return `${label}  ${remainingSeconds}s`
    }

    switch (phase) {
      case 'inhale':
        return withRemaining('Inhale')
      case 'hold':
        return withRemaining('Hold')
      case 'exhale':
        return withRemaining('Exhale')
      case 'idle':
        return 'Idle'
    }
  }

  private resetSession(): void {
    this.phase = 'idle'
    this.phaseProgress = 0
    this.phaseRemainingSeconds = null
    this.intensity = 0
    this.depth = 0
    this.cycleCount = 0
    this.consistency = 0.75
    this.activeSegmentIndex = 0
  }
}
