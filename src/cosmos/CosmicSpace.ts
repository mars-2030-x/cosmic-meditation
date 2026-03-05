import * as THREE from 'three'
import type {
  BreathPhase,
  ChunkCoord,
  FrameMetrics,
  ICosmicRenderer,
  QualityProfile,
} from '../types'
import { ChunkGenerator } from './ChunkGenerator'

export interface CosmicSpaceOptions {
  mount: HTMLElement
  qualityProfile: QualityProfile
  chunkGenerator: ChunkGenerator
}

export class CosmicSpace implements ICosmicRenderer {
  private readonly mount: HTMLElement
  private readonly qualityProfile: QualityProfile
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly renderer: THREE.WebGLRenderer
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.PointsMaterial
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly resizeHandler: () => void
  private readonly basePointSize: number

  private depthBand: 0 | 1 | 2 | 3 = 0
  private breathPhase: BreathPhase = 'idle'
  private breathIntensity = 0
  private lastFrameTimeMs = 0
  private animationFrameId: number | null = null
  private disposed = false

  private metrics: FrameMetrics = {
    fps: 0,
    frameTime: 0,
    memoryMB: 0,
  }

  constructor(options: CosmicSpaceOptions) {
    this.mount = options.mount
    this.qualityProfile = options.qualityProfile

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x020611)
    this.scene.fog = new THREE.FogExp2(0x030913, 0.00135)

    this.camera = new THREE.PerspectiveCamera(68, 1, 1, 3_000)
    this.camera.position.set(0, 0, 460)

    this.renderer = new THREE.WebGLRenderer({
      antialias: options.qualityProfile.tier !== 'low',
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x020611, 1)
    this.mount.append(this.renderer.domElement)

    const { geometry, averageSize } = this.buildGeometry(options.chunkGenerator)
    this.geometry = geometry
    this.basePointSize = 0.45 + averageSize * 0.35

    this.material = new THREE.PointsMaterial({
      size: this.basePointSize,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      opacity: 0.7,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
    })

    this.points = new THREE.Points(this.geometry, this.material)
    this.scene.add(this.points)

    this.resizeHandler = () => {
      this.resize()
    }
    window.addEventListener('resize', this.resizeHandler)
    this.resize()
    this.animationFrameId = requestAnimationFrame(this.animate)
  }

  setBreathUniforms(phase: BreathPhase, intensity: number): void {
    this.breathPhase = phase
    this.breathIntensity = clamp(intensity, 0, 1)
  }

  setDepthBand(band: 0 | 1 | 2 | 3): void {
    this.depthBand = band
  }

  getPerformanceMetrics(): FrameMetrics {
    return { ...this.metrics }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }

    window.removeEventListener('resize', this.resizeHandler)
    this.scene.remove(this.points)
    this.geometry.dispose()
    this.material.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private buildGeometry(generator: ChunkGenerator): {
    geometry: THREE.BufferGeometry
    averageSize: number
  } {
    const coords = this.collectActiveCoords()
    const chunks = coords.map((coord) => generator.generate(coord))
    const totalStars = chunks.reduce((sum, chunk) => sum + chunk.starCount, 0)

    const positions = new Float32Array(totalStars * 3)
    const colors = new Float32Array(totalStars * 3)
    let colorOffset = 0
    let positionOffset = 0
    let sizeAccumulator = 0

    for (const chunk of chunks) {
      positions.set(chunk.positions, positionOffset)
      colors.set(chunk.colors, colorOffset)

      if (
        chunk.hasNebula &&
        chunk.nebulaCenter !== undefined &&
        chunk.nebulaRadius !== undefined
      ) {
        this.applyNebulaTint(
          positions,
          colors,
          positionOffset,
          chunk.starCount,
          chunk.nebulaCenter,
          chunk.nebulaRadius,
        )
      }

      for (const size of chunk.sizes) {
        sizeAccumulator += size
      }

      positionOffset += chunk.positions.length
      colorOffset += chunk.colors.length
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    return {
      geometry,
      averageSize: totalStars > 0 ? sizeAccumulator / totalStars : 1,
    }
  }

  private collectActiveCoords(): ChunkCoord[] {
    if (this.qualityProfile.activeChunkRadius >= 1) {
      const coords: ChunkCoord[] = []
      for (let cx = -1; cx <= 1; cx += 1) {
        for (let cy = -1; cy <= 1; cy += 1) {
          for (let cz = -1; cz <= 1; cz += 1) {
            coords.push({ cx, cy, cz })
          }
        }
      }
      return coords
    }

    if (this.qualityProfile.activeChunkRadius >= 0.67) {
      return [
        { cx: -1, cy: -1, cz: -1 },
        { cx: 0, cy: -1, cz: -1 },
        { cx: -1, cy: 0, cz: -1 },
        { cx: 0, cy: 0, cz: -1 },
        { cx: -1, cy: -1, cz: 0 },
        { cx: 0, cy: -1, cz: 0 },
        { cx: -1, cy: 0, cz: 0 },
        { cx: 0, cy: 0, cz: 0 },
      ]
    }

    return [
      { cx: 0, cy: 0, cz: 0 },
      { cx: 1, cy: 0, cz: 0 },
      { cx: -1, cy: 0, cz: 0 },
      { cx: 0, cy: 1, cz: 0 },
      { cx: 0, cy: -1, cz: 0 },
      { cx: 0, cy: 0, cz: 1 },
      { cx: 0, cy: 0, cz: -1 },
    ]
  }

  private applyNebulaTint(
    positions: Float32Array,
    colors: Float32Array,
    startOffset: number,
    starCount: number,
    center: [number, number, number],
    radius: number,
  ): void {
    for (let index = 0; index < starCount; index += 1) {
      const offset = startOffset + index * 3
      const dx = positions[offset] - center[0]
      const dy = positions[offset + 1] - center[1]
      const dz = positions[offset + 2] - center[2]
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const influence = clamp(1 - distance / radius, 0, 1)

      colors[offset] = clamp(colors[offset] + influence * 0.1, 0, 1)
      colors[offset + 1] = clamp(colors[offset + 1] + influence * 0.05, 0, 1)
      colors[offset + 2] = clamp(colors[offset + 2] + influence * 0.18, 0, 1)
    }
  }

  private readonly animate = (timeMs: number): void => {
    if (this.disposed) {
      return
    }

    const deltaMs =
      this.lastFrameTimeMs > 0 ? Math.max(1, timeMs - this.lastFrameTimeMs) : 16.67
    const deltaSeconds = deltaMs / 1000
    this.lastFrameTimeMs = timeMs

    this.metrics.frameTime = deltaMs
    this.metrics.fps = 1000 / deltaMs
    this.metrics.memoryMB = this.readMemoryUsageMB()

    this.updateScene(deltaSeconds, timeMs / 1000)
    this.renderer.render(this.scene, this.camera)
    this.animationFrameId = requestAnimationFrame(this.animate)
  }

  private updateScene(deltaSeconds: number, timeSeconds: number): void {
    const pulse = this.phasePulse(timeSeconds)
    const targetSize =
      this.basePointSize +
      this.breathIntensity * 0.95 +
      this.depthBand * 0.28 +
      pulse * 0.16
    this.material.size += (targetSize - this.material.size) * 0.08
    this.material.opacity = clamp(
      0.48 + this.depthBand * 0.09 + this.breathIntensity * 0.24,
      0.3,
      0.95,
    )

    const hue = wrap01(0.6 - this.depthBand * 0.032 + pulse * 0.015)
    const saturation = clamp(0.58 + this.breathIntensity * 0.18, 0, 1)
    const lightness = clamp(0.56 + this.depthBand * 0.06, 0, 1)
    this.material.color.setHSL(hue, saturation, lightness)

    const rotationSpeed = 0.018 + this.depthBand * 0.007 + this.breathIntensity * 0.01
    this.points.rotation.y += deltaSeconds * rotationSpeed
    this.points.rotation.x += deltaSeconds * (0.0025 + this.breathIntensity * 0.002)

    const targetZ = 460 - this.depthBand * 16 - this.breathIntensity * 18
    this.camera.position.z += (targetZ - this.camera.position.z) * 0.06
    this.camera.lookAt(0, 0, 0)
  }

  private phasePulse(timeSeconds: number): number {
    switch (this.breathPhase) {
      case 'inhale':
        return Math.sin(Math.PI * this.breathIntensity)
      case 'hold':
        return 0.35 + Math.sin(timeSeconds * 0.8) * 0.05
      case 'exhale':
        return -Math.sin(Math.PI * this.breathIntensity) * 0.75
      case 'idle':
        return Math.sin(timeSeconds * 0.25) * 0.04
    }
  }

  private resize(): void {
    const width = Math.max(1, this.mount.clientWidth || window.innerWidth)
    const height = Math.max(1, this.mount.clientHeight || window.innerHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  private readMemoryUsageMB(): number {
    const performanceWithMemory = performance as Performance & {
      memory?: { usedJSHeapSize?: number }
    }
    const bytes = performanceWithMemory.memory?.usedJSHeapSize
    if (typeof bytes !== 'number') {
      return 0
    }
    return bytes / (1024 * 1024)
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

function wrap01(value: number): number {
  if (value >= 1) {
    return value - Math.floor(value)
  }
  if (value < 0) {
    return value - Math.floor(value)
  }
  return value
}
