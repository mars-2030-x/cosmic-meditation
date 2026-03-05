import {
  QUALITY_PROFILES,
  STAGE_CONDITIONS,
  type BreathSnapshot,
  type MeditationStage,
  type QualityProfile,
  type QualityTier,
} from '../types'
import { EventBus } from './EventBus'

export interface AppStateEvents {
  qualityChanged: QualityTier
  stageChanged: MeditationStage
  depthBandChanged: 0 | 1 | 2 | 3
}

export class AppState {
  readonly events: EventBus<AppStateEvents>

  private _qualityTier: QualityTier
  private _qualityProfile: QualityProfile
  private _stage: MeditationStage = 'entry'
  private _depthBand: 0 | 1 | 2 | 3 = 0
  private readonly sessionStartedAtMs: number

  constructor(events: EventBus<AppStateEvents> = new EventBus<AppStateEvents>()) {
    this.events = events
    this.sessionStartedAtMs = performance.now()
    this._qualityTier = AppState.detectQualityTier()
    this._qualityProfile = QUALITY_PROFILES[this._qualityTier]
  }

  get qualityTier(): QualityTier {
    return this._qualityTier
  }

  get qualityProfile(): QualityProfile {
    return this._qualityProfile
  }

  get stage(): MeditationStage {
    return this._stage
  }

  get depthBand(): 0 | 1 | 2 | 3 {
    return this._depthBand
  }

  get elapsedSeconds(): number {
    return (performance.now() - this.sessionStartedAtMs) / 1000
  }

  setQualityTier(tier: QualityTier): void {
    if (tier === this._qualityTier) {
      return
    }

    this._qualityTier = tier
    this._qualityProfile = QUALITY_PROFILES[tier]
    this.events.emit('qualityChanged', tier)
  }

  updateFromBreath(snapshot: BreathSnapshot): void {
    const nextStage = this.resolveStage(snapshot, this.elapsedSeconds)
    if (nextStage !== this._stage) {
      this._stage = nextStage
      this.events.emit('stageChanged', nextStage)
    }

    const nextBand = this.depthToBand(snapshot.depth)
    if (nextBand !== this._depthBand) {
      this._depthBand = nextBand
      this.events.emit('depthBandChanged', nextBand)
    }
  }

  private resolveStage(
    snapshot: BreathSnapshot,
    elapsedSeconds: number,
  ): MeditationStage {
    for (let index = STAGE_CONDITIONS.length - 1; index >= 0; index -= 1) {
      const condition = STAGE_CONDITIONS[index]
      if (
        snapshot.depth >= condition.minDepth &&
        snapshot.cycleCount >= condition.minCycles &&
        elapsedSeconds >= condition.minDurationSeconds
      ) {
        return condition.stage
      }
    }

    return 'entry'
  }

  private depthToBand(depth: number): 0 | 1 | 2 | 3 {
    const clampedDepth = Math.min(1, Math.max(0, depth))
    if (clampedDepth >= 0.75) {
      return 3
    }
    if (clampedDepth >= 0.5) {
      return 2
    }
    if (clampedDepth >= 0.25) {
      return 1
    }
    return 0
  }

  private static detectQualityTier(): QualityTier {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 'low'
    }

    const hardwareThreads = navigator.hardwareConcurrency ?? 4
    const navWithMemory = navigator as Navigator & { deviceMemory?: number }
    const deviceMemory = navWithMemory.deviceMemory ?? 8
    const mobileGpuLikely = AppState.isMobileGpuRenderer()

    if (hardwareThreads <= 4 || deviceMemory <= 4 || mobileGpuLikely) {
      return 'low'
    }
    if (hardwareThreads <= 8 || deviceMemory <= 8) {
      return 'medium'
    }
    return 'high'
  }

  private static isMobileGpuRenderer(): boolean {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl')
    if (gl === null) {
      return false
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info') as
      | { UNMASKED_RENDERER_WEBGL: number }
      | null
    if (debugInfo === null) {
      return false
    }

    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    if (typeof renderer !== 'string') {
      return false
    }

    const normalized = renderer.toLowerCase()
    return /(adreno|mali|powervr|apple gpu|intel\(r\) uhd)/.test(normalized)
  }
}
