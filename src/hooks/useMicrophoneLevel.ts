import { useCallback, useEffect, useRef, useState } from 'react'

export type MicrophoneStatus = 'sleeping' | 'requesting' | 'listening' | 'unavailable'

const NOISE_FLOOR = 0.012
const USEFUL_LEVEL = 0.13
const ATTACK_SECONDS = 0.045
const RELEASE_SECONDS = 0.32
const FAST_ENVELOPE_SECONDS = 0.025
const SLOW_ENVELOPE_SECONDS = 0.28
const PEAK_RELEASE_SECONDS = 0.22

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export function useMicrophoneLevel() {
  const [status, setStatus] = useState<MicrophoneStatus>('sleeping')
  const [displayLevel, setDisplayLevel] = useState(0)
  const levelRef = useRef(0)
  const peakRef = useRef(0)

  const contextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const requestGenerationRef = useRef(0)
  const mountedRef = useRef(true)

  const releaseResources = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    sourceRef.current?.disconnect()
    analyserRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((track) => track.stop())

    const context = contextRef.current
    if (context && context.state !== 'closed') {
      void context.close()
    }

    sourceRef.current = null
    analyserRef.current = null
    streamRef.current = null
    contextRef.current = null
    levelRef.current = 0
    peakRef.current = 0
  }, [])

  const start = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current
    releaseResources()
    setDisplayLevel(0)

    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      setStatus('unavailable')
      return
    }

    setStatus('requesting')

    let stream: MediaStream | null = null
    let context: AudioContext | null = null

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      if (!mountedRef.current || requestGeneration !== requestGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      context = new AudioContext()
      await context.resume()

      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0
      source.connect(analyser)

      contextRef.current = context
      streamRef.current = stream
      sourceRef.current = source
      analyserRef.current = analyser

      const samples = new Float32Array(analyser.fftSize)
      let smoothedLevel = 0
      let fastEnvelope = 0
      let slowEnvelope = 0
      let lastTime = performance.now()
      let lastDisplayUpdate = 0

      const sample = (now: number) => {
        if (!analyserRef.current) return

        const delta = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000))
        lastTime = now
        analyser.getFloatTimeDomainData(samples)

        let sumSquares = 0
        for (let index = 0; index < samples.length; index += 1) {
          const sampleValue = samples[index]
          sumSquares += sampleValue * sampleValue
        }

        const rms = Math.sqrt(sumSquares / samples.length)
        const normalized = Math.pow(
          clamp01((rms - NOISE_FLOOR) / (USEFUL_LEVEL - NOISE_FLOOR)),
          0.72,
        )

        const smoothingTime = normalized > smoothedLevel ? ATTACK_SECONDS : RELEASE_SECONDS
        smoothedLevel +=
          (normalized - smoothedLevel) * (1 - Math.exp(-delta / smoothingTime))
        fastEnvelope +=
          (normalized - fastEnvelope) * (1 - Math.exp(-delta / FAST_ENVELOPE_SECONDS))
        slowEnvelope +=
          (normalized - slowEnvelope) * (1 - Math.exp(-delta / SLOW_ENVELOPE_SECONDS))

        const transient = clamp01((fastEnvelope - slowEnvelope - 0.025) * 4.8)
        peakRef.current = Math.max(
          transient,
          peakRef.current * Math.exp(-delta / PEAK_RELEASE_SECONDS),
        )
        levelRef.current = clamp01(smoothedLevel)

        if (now - lastDisplayUpdate > 80) {
          lastDisplayUpdate = now
          setDisplayLevel(levelRef.current)
        }

        animationFrameRef.current = requestAnimationFrame(sample)
      }

      setStatus('listening')
      animationFrameRef.current = requestAnimationFrame(sample)
    } catch {
      stream?.getTracks().forEach((track) => track.stop())
      if (context && context.state !== 'closed') void context.close()
      releaseResources()
      if (mountedRef.current && requestGeneration === requestGenerationRef.current) {
        setStatus('unavailable')
      }
    }
  }, [releaseResources])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      requestGenerationRef.current += 1
      releaseResources()
    }
  }, [releaseResources])

  return { status, displayLevel, levelRef, peakRef, start }
}
