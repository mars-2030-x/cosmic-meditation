import { SoundEngine } from './audio/SoundEngine'
import { GuidedBreathUI } from './breath/GuidedBreathUI'
import { AppState, type AppStateEvents } from './core/AppState'
import { EventBus } from './core/EventBus'
import { ChunkGenerator } from './cosmos/ChunkGenerator'
import { CosmicSpace } from './cosmos/CosmicSpace'
import type { BreathSnapshot } from './types'

const app = document.querySelector<HTMLDivElement>('#app')
if (app === null) {
  throw new Error('Missing #app mount container.')
}

document.body.style.margin = '0'
document.body.style.background = '#020611'
document.body.style.color = '#ecf1ff'
document.body.style.fontFamily = '"Segoe UI", Tahoma, sans-serif'
app.style.position = 'relative'
app.style.width = '100vw'
app.style.height = '100dvh'
app.style.overflow = 'hidden'

const canvasHost = document.createElement('div')
canvasHost.style.cssText = 'position: absolute; inset: 0;'
app.append(canvasHost)

const hud = document.createElement('div')
hud.style.cssText = [
  'position: fixed',
  'top: 14px',
  'left: 14px',
  'z-index: 40',
  'padding: 12px 14px',
  'border-radius: 12px',
  'border: 1px solid rgba(160, 185, 255, 0.28)',
  'background: rgba(6, 10, 25, 0.72)',
  'backdrop-filter: blur(8px)',
  'min-width: 180px',
  'font-size: 12px',
  'line-height: 1.6',
].join(';')
app.append(hud)

const qualityValue = createHudRow(hud, 'Quality', 'detecting')
const stageValue = createHudRow(hud, 'Stage', 'entry')
const perfValue = createHudRow(hud, 'Performance', '0 fps')
const audioValue = createHudRow(hud, 'Audio', 'awaiting gesture')

const eventBus = new EventBus<AppStateEvents>()
const appState = new AppState(eventBus)
qualityValue.textContent = appState.qualityTier
stageValue.textContent = appState.stage

const chunkGenerator = new ChunkGenerator({
  starsPerChunk: appState.qualityProfile.starsPerChunk,
  seed: 'cosmic-meditation-v1',
})
const cosmic = new CosmicSpace({
  mount: canvasHost,
  qualityProfile: appState.qualityProfile,
  chunkGenerator,
})
const breath = new GuidedBreathUI({ container: app })
const sound = new SoundEngine()

const stopStageSync = eventBus.on('stageChanged', (stage) => {
  stageValue.textContent = stage
})
const stopDepthSync = eventBus.on('depthBandChanged', (depthBand) => {
  cosmic.setDepthBand(depthBand)
})
const stopQualitySync = eventBus.on('qualityChanged', (tier) => {
  qualityValue.textContent = tier
})

cosmic.setDepthBand(appState.depthBand)

const stopBreathSync = breath.subscribe((snapshot) => {
  appState.updateFromBreath(snapshot)
  applyBreathState(snapshot)
})

function applyBreathState(snapshot: BreathSnapshot): void {
  cosmic.setBreathUniforms(snapshot.phase, snapshot.intensity)
  sound.setBreathParameters(snapshot.phase, snapshot.intensity)
  sound.setAmbientDepth(snapshot.depth)
}

let audioStarted = false
const activateAudio = async (): Promise<void> => {
  if (audioStarted) {
    return
  }

  try {
    await sound.start()
    audioStarted = true
    audioValue.textContent = 'active'
    // 성공 시에만 리스너 해제 — 실패하면 다음 제스처에서 재시도 가능
    window.removeEventListener('pointerdown', gestureHandler)
    window.removeEventListener('keydown', gestureHandler)
  } catch (error) {
    audioValue.textContent = 'tap to retry'
    console.warn('Audio activation failed, will retry on next gesture:', error)
  }
}

const gestureHandler = (): void => {
  void activateAudio()
}
window.addEventListener('pointerdown', gestureHandler)
window.addEventListener('keydown', gestureHandler)

const perfTimer = window.setInterval(() => {
  const metrics = cosmic.getPerformanceMetrics()
  const fps = metrics.fps.toFixed(0)
  if (metrics.memoryMB > 0) {
    perfValue.textContent = `${fps} fps • ${metrics.memoryMB.toFixed(1)} MB`
  } else {
    perfValue.textContent = `${fps} fps`
  }
}, 500)

let disposed = false
const dispose = (): void => {
  if (disposed) {
    return
  }
  disposed = true

  window.clearInterval(perfTimer)
  window.removeEventListener('pointerdown', gestureHandler)
  window.removeEventListener('keydown', gestureHandler)

  stopBreathSync()
  stopStageSync()
  stopDepthSync()
  stopQualitySync()

  breath.dispose()
  cosmic.dispose()
  sound.dispose()
}

window.addEventListener('beforeunload', dispose, { once: true })

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    dispose()
  })
}

function createHudRow(parent: HTMLElement, label: string, value: string): HTMLSpanElement {
  const row = document.createElement('div')

  const key = document.createElement('span')
  key.textContent = `${label}: `
  key.style.color = 'rgba(214, 228, 255, 0.8)'

  const content = document.createElement('span')
  content.textContent = value
  content.style.color = '#f6f8ff'
  content.style.fontWeight = '600'

  row.append(key, content)
  parent.append(row)
  return content
}
