import { createNoise3D } from 'simplex-noise'
import type { ChunkCoord, ChunkData } from '../types'

export interface ChunkGeneratorOptions {
  starsPerChunk: number
  chunkSize?: number
  seed?: string
}

export class ChunkGenerator {
  private readonly chunkSize: number
  private readonly starsPerChunk: number
  private readonly seedHash: number
  private readonly noise3D: ReturnType<typeof createNoise3D>

  constructor(options: ChunkGeneratorOptions) {
    this.chunkSize = options.chunkSize ?? 140
    this.starsPerChunk = options.starsPerChunk
    this.seedHash = this.hashString(options.seed ?? 'cosmic-meditation')
    this.noise3D = createNoise3D(this.createSeededRandom(this.seedHash))
  }

  generate(coord: ChunkCoord): ChunkData {
    const key = ChunkGenerator.toChunkKey(coord)
    const random = this.createChunkRandom(coord)

    const baseX = coord.cx * this.chunkSize
    const baseY = coord.cy * this.chunkSize
    const baseZ = coord.cz * this.chunkSize

    const nebulaSignal = this.noise3D(
      coord.cx * 0.37 + 17.7,
      coord.cy * 0.37 - 11.1,
      coord.cz * 0.37 + 29.3,
    )
    const hasNebula = nebulaSignal > 0.42

    const nebulaCenter: [number, number, number] | undefined = hasNebula
      ? [
          baseX + (random() - 0.5) * this.chunkSize * 0.6,
          baseY + (random() - 0.5) * this.chunkSize * 0.6,
          baseZ + (random() - 0.5) * this.chunkSize * 0.6,
        ]
      : undefined

    const nebulaRadius = hasNebula
      ? this.chunkSize * (0.2 + random() * 0.24)
      : undefined

    const positions = new Float32Array(this.starsPerChunk * 3)
    const colors = new Float32Array(this.starsPerChunk * 3)
    const sizes = new Float32Array(this.starsPerChunk)

    for (let index = 0; index < this.starsPerChunk; index += 1) {
      const positionOffset = index * 3

      let x = baseX + (random() - 0.5) * this.chunkSize
      let y = baseY + (random() - 0.5) * this.chunkSize
      let z = baseZ + (random() - 0.5) * this.chunkSize

      if (hasNebula && nebulaCenter !== undefined && nebulaRadius !== undefined && random() < 0.34) {
        const angle = random() * Math.PI * 2
        const elevation = Math.acos(2 * random() - 1)
        const radius = nebulaRadius * Math.pow(random(), 1.8)
        x = nebulaCenter[0] + radius * Math.sin(elevation) * Math.cos(angle)
        y = nebulaCenter[1] + radius * Math.sin(elevation) * Math.sin(angle)
        z = nebulaCenter[2] + radius * Math.cos(elevation)
      }

      const density =
        (this.noise3D(x * 0.012, y * 0.012, z * 0.012) + 1) * 0.5
      const nebulaInfluence =
        hasNebula && nebulaCenter !== undefined && nebulaRadius !== undefined
          ? this.nebulaInfluence(x, y, z, nebulaCenter, nebulaRadius)
          : 0
      const brightness = clamp01(
        0.42 + density * 0.36 + nebulaInfluence * 0.34 + random() * 0.18,
      )

      positions[positionOffset] = x
      positions[positionOffset + 1] = y
      positions[positionOffset + 2] = z

      const hueBias = 0.15 + density * 0.22 + nebulaInfluence * 0.33
      colors[positionOffset] = clamp01(0.35 + brightness * 0.55 + hueBias * 0.08)
      colors[positionOffset + 1] = clamp01(0.42 + brightness * 0.48 + hueBias * 0.12)
      colors[positionOffset + 2] = clamp01(0.6 + brightness * 0.32 + hueBias * 0.3)

      sizes[index] = 0.35 + brightness * 1.5 + random() * 0.55
    }

    return {
      key,
      coord,
      positions,
      colors,
      sizes,
      starCount: this.starsPerChunk,
      hasNebula,
      nebulaCenter,
      nebulaRadius,
    }
  }

  static toChunkKey(coord: ChunkCoord): string {
    return `${coord.cx}:${coord.cy}:${coord.cz}`
  }

  private nebulaInfluence(
    x: number,
    y: number,
    z: number,
    center: [number, number, number],
    radius: number,
  ): number {
    const dx = x - center[0]
    const dy = y - center[1]
    const dz = z - center[2]
    const distanceRatio = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius
    return clamp01(1 - distanceRatio * distanceRatio)
  }

  private createChunkRandom(coord: ChunkCoord): () => number {
    const mix =
      this.seedHash ^
      (coord.cx * 374_761_393) ^
      (coord.cy * 668_265_263) ^
      (coord.cz * 2_147_483_647)
    return this.createSeededRandom(mix)
  }

  private createSeededRandom(seedInput: number): () => number {
    let seed = seedInput | 0
    return () => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return (seed >>> 0) / 4_294_967_296
    }
  }

  private hashString(value: string): number {
    let hash = 2_166_136_261
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16_777_619)
    }
    return hash | 0
  }
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}
