// ============================================================
// Phase 0: Interface Contracts
// All cross-module contracts are defined here first.
// This file must compile with zero errors before any other
// module is implemented.
// ============================================================

// --- Breath System ---

export type BreathPhase = 'inhale' | 'hold' | 'exhale' | 'idle'

export interface BreathSnapshot {
  phase: BreathPhase
  /** 0-1 progress within the current phase */
  phaseProgress: number
  /** 0-1 immediate intensity (fast track input) */
  intensity: number
  /** 0-1 accumulated meditation depth (slow track input) */
  depth: number
  cycleCount: number
  consistency: number
}

export type Unsubscribe = () => void

/** Implemented by GuidedBreathUI and MicBreathDetector */
export interface IBreathSource {
  readonly phase: BreathPhase
  readonly intensity: number
  readonly depth: number
  start(): void
  stop(): void
  subscribe(callback: (state: BreathSnapshot) => void): Unsubscribe
}

// --- Renderer ---

export interface FrameMetrics {
  fps: number
  frameTime: number
  memoryMB: number
}

/** Implemented by CosmicSpace */
export interface ICosmicRenderer {
  /** Fast track: called every frame with immediate breath values */
  setBreathUniforms(phase: BreathPhase, intensity: number): void
  /** Slow track: called when depthBand changes (0-3) */
  setDepthBand(band: 0 | 1 | 2 | 3): void
  getPerformanceMetrics(): FrameMetrics
  dispose(): void
}

// --- Audio ---

/** Implemented by SoundEngine */
export interface IAudioEngine {
  /** Fast track: called every frame with immediate breath values */
  setBreathParameters(phase: BreathPhase, intensity: number): void
  /** Slow track: called when meditationDepth meaningfully changes */
  setAmbientDepth(depth: number): void
  start(): Promise<void>
  dispose(): void
}

// --- Chunk / Procedural Generation ---

export interface ChunkCoord {
  cx: number
  cy: number
  cz: number
}

export interface ChunkData {
  key: string
  coord: ChunkCoord
  /** Star positions as flat [x,y,z, x,y,z, ...] array */
  positions: Float32Array
  /** Star colors as flat [r,g,b, r,g,b, ...] array */
  colors: Float32Array
  /** Per-star size scalar */
  sizes: Float32Array
  starCount: number
  hasNebula: boolean
  nebulaCenter?: [number, number, number]
  nebulaRadius?: number
}

// --- Performance / Quality ---

export type QualityTier = 'high' | 'medium' | 'low'

export interface QualityProfile {
  tier: QualityTier
  activeChunkRadius: number   // 1 = 3x3x3=27, 0.67 = 2x2x2=8, cross=7
  starsPerChunk: number
  bloomEnabled: boolean
  colorGradeEnabled: boolean
  maxSpatialAudioSources: number
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  high: {
    tier: 'high',
    activeChunkRadius: 1,
    starsPerChunk: 2000,
    bloomEnabled: true,
    colorGradeEnabled: true,
    maxSpatialAudioSources: 3,
  },
  medium: {
    tier: 'medium',
    activeChunkRadius: 0.67,
    starsPerChunk: 1000,
    bloomEnabled: true,
    colorGradeEnabled: false,
    maxSpatialAudioSources: 2,
  },
  low: {
    tier: 'low',
    activeChunkRadius: 0.5,
    starsPerChunk: 500,
    bloomEnabled: false,
    colorGradeEnabled: false,
    maxSpatialAudioSources: 0,
  },
}

// --- Meditation Stages ---

export type MeditationStage = 'entry' | 'explore' | 'deepening' | 'deep'

export interface MeditationStageCondition {
  stage: MeditationStage
  minDepth: number
  minCycles: number
  minDurationSeconds: number
}

export const STAGE_CONDITIONS: MeditationStageCondition[] = [
  { stage: 'entry',    minDepth: 0.0, minCycles: 0,  minDurationSeconds: 0  },
  { stage: 'explore',  minDepth: 0.1, minCycles: 2,  minDurationSeconds: 30 },
  { stage: 'deepening',minDepth: 0.3, minCycles: 8,  minDurationSeconds: 120 },
  { stage: 'deep',     minDepth: 0.6, minCycles: 15, minDurationSeconds: 300 },
]
