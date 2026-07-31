import { Canvas } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { ListeningCube } from './components/ListeningCube'
import type { AnimationInfo } from './components/ListeningCube'
import { useMicrophoneLevel } from './hooks/useMicrophoneLevel'

const STATUS_LABELS = {
  sleeping: 'Sleeping',
  requesting: 'Asking permission',
  listening: 'Listening',
  unavailable: 'Microphone unavailable',
} as const

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setReducedMotion(mediaQuery.matches)
    mediaQuery.addEventListener('change', updatePreference)
    return () => mediaQuery.removeEventListener('change', updatePreference)
  }, [])

  return reducedMotion
}

function App() {
  const [manualLevel, setManualLevel] = useState(0)
  const [animationInfo, setAnimationInfo] = useState<AnimationInfo | null>(null)
  const { status, displayLevel, levelRef, peakRef, start } = useMicrophoneLevel()
  const reducedMotion = usePrefersReducedMotion()
  const isListening = status === 'listening'
  const isRequesting = status === 'requesting'
  const currentResponse = isListening ? displayLevel : manualLevel

  const handleAnimationInfo = useCallback((info: AnimationInfo) => {
    setAnimationInfo(info)
  }, [])

  const buttonLabel = isListening
    ? 'Listening now'
    : status === 'unavailable'
      ? 'Try microphone again'
      : isRequesting
        ? 'Waking up…'
        : 'Wake it up'

  return (
    <main className="experience-shell">
      <div className="ambient-glow ambient-glow--one" aria-hidden="true" />
      <div className="ambient-glow ambient-glow--two" aria-hidden="true" />

      <div className="scene" aria-label="An interactive cube with a listening ear on each side">
        <Canvas
          shadows
          dpr={[1, 1.75]}
          camera={{ position: [0, 0.25, 5.25], fov: 38, near: 0.1, far: 50 }}
          gl={{ antialias: true, alpha: true }}
        >
          <fog attach="fog" args={['#070811', 6.2, 12]} />
          <ambientLight intensity={0.55} color="#8290bd" />
          <hemisphereLight args={['#9baee7', '#17111c', 1.35]} />
          <spotLight
            position={[4.5, 6, 4]}
            intensity={55}
            angle={0.42}
            penumbra={0.82}
            color="#f4d8cf"
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <pointLight position={[-4, 1.5, 2]} intensity={12} color="#6e7bff" />
          <pointLight position={[3, -2, -1]} intensity={8} color="#d06df0" />

          <Suspense fallback={null}>
            <ListeningCube
              microphoneLevelRef={levelRef}
              peakRef={peakRef}
              manualLevel={manualLevel}
              isListening={isListening}
              reducedMotion={reducedMotion}
              onAnimationInfo={handleAnimationInfo}
            />
          </Suspense>
        </Canvas>
      </div>

      <header className="masthead">
        <div className="eyebrow">
          <span className="eyebrow-mark" aria-hidden="true" />
          Sound study 001
        </div>
        <h1>
          This cube
          <br />
          has ears<span className="title-dot">.</span>
        </h1>
        <p className="intro">
          {isListening ? 'Talk. Clap. Play something.' : 'Give it something to listen to.'}
        </p>
      </header>

      <div className={`status-pill status-pill--${status}`} role="status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        {STATUS_LABELS[status]}
      </div>

      {animationInfo && (animationInfo.error || animationInfo.mode === 'none') && (
        <aside className="model-warning" role="alert">
          <span className="warning-icon" aria-hidden="true">!</span>
          <span>
            <strong>Assembled model diagnostic</strong>
            {animationInfo.error ?? 'No usable ear animation or morph target was found.'}
          </span>
        </aside>
      )}

      {animationInfo && !animationInfo.error && animationInfo.mode !== 'none' && (
        <aside
          className="model-diagnostic"
          title={animationInfo.trackNames.join(', ') || undefined}
          aria-label="Ear asset development diagnostic"
        >
          <div className="diagnostic-heading">
            <span className="diagnostic-tag">Dev</span>
            <span>{animationInfo.assetFilename}</span>
          </div>
          <dl>
            <div>
              <dt>Bounds</dt>
              <dd>{animationInfo.bounds.map((value) => value.toFixed(4)).join(' × ')}</dd>
            </div>
            <div>
              <dt>Control</dt>
              <dd>
                {animationInfo.mode === 'clip' ? 'Mixer scrubbing' : 'Direct morph'} / scale{' '}
                {animationInfo.uniformScale.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt>Clip</dt>
              <dd>
                {animationInfo.clipNames.join(', ') || 'None'} /{' '}
                {animationInfo.duration?.toFixed(3) ?? '—'}s
              </dd>
            </div>
            <div>
              <dt>Tracks</dt>
              <dd>{animationInfo.trackNames.join(' / ') || 'None'}</dd>
            </div>
            <div>
              <dt>Morphs</dt>
              <dd>
                {animationInfo.morphTargets
                  .map((target) => `${target.meshName}: ${target.name} [${target.index}]`)
                  .join(' / ') || 'None'}
              </dd>
            </div>
            <div>
              <dt>Response</dt>
              <dd>{currentResponse.toFixed(2)}</dd>
            </div>
          </dl>
        </aside>
      )}

      <section className="control-deck" aria-label="Listening controls">
        <button
          className="wake-button"
          type="button"
          onClick={() => void start()}
          disabled={isListening || isRequesting}
        >
          <span className="button-orbit" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path d="M12 14.75a3.5 3.5 0 0 0 3.5-3.5v-4a3.5 3.5 0 1 0-7 0v4a3.5 3.5 0 0 0 3.5 3.5Z" />
              <path d="M5.75 11.25a6.25 6.25 0 0 0 12.5 0M12 17.5v3M9 20.5h6" />
            </svg>
          </span>
          {buttonLabel}
        </button>

        <div className="slider-control">
          <div className="control-label-row">
            <label htmlFor="ear-response">Ear response test.</label>
            <output htmlFor="ear-response">{Math.round(manualLevel * 100)} / 100</output>
          </div>
          <input
            id="ear-response"
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={manualLevel}
            onChange={(event) => setManualLevel(Number(event.target.value))}
            style={{ '--slider-progress': `${manualLevel * 100}%` } as React.CSSProperties}
          />
          <div className="slider-scale" aria-hidden="true">
            <span>Quiet</span>
            <span>Loud</span>
          </div>
        </div>

        <div className="level-readout" aria-label={`Microphone level ${Math.round(displayLevel * 100)} percent`}>
          <div className="level-heading">
            <span>Input</span>
            <span>{isListening ? displayLevel.toFixed(2) : '—'}</span>
          </div>
          <div className="level-track" aria-hidden="true">
            <span style={{ transform: `scaleX(${isListening ? displayLevel : 0})` }} />
          </div>
        </div>
      </section>

      <p className="interaction-hint">Drag to look · Scroll to move closer</p>
    </main>
  )
}

export default App
