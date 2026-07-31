import { OrbitControls, useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

export const EAR_MODEL_URL = '/assets/3d-models/the_good_ear_SubDiv1_ears_withCube.gltf'

const ASSET_FILENAME = 'the_good_ear_SubDiv1_ears_withCube.gltf'
const TARGET_FRAMING_SIZE = 4.8
const PEAK_ROTATION_RADIANS = 0.075
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const peakQuaternion = new THREE.Quaternion()

export type EarControlMode = 'clip' | 'morph' | 'none'

type MorphTargetInfo = {
  meshName: string
  name: string
  index: number
}

type MorphBinding = {
  mesh: THREE.Mesh
  index: number
}

type EarPivot = {
  node: THREE.Object3D
  baseQuaternion: THREE.Quaternion
}

type ClipAction = {
  clip: THREE.AnimationClip
  action: THREE.AnimationAction
}

export type AnimationInfo = {
  assetFilename: string
  mode: EarControlMode
  clipNames: string[]
  duration: number | null
  clipCount: number
  trackNames: string[]
  morphTargets: MorphTargetInfo[]
  bounds: [number, number, number]
  uniformScale: number
  visibleMeshCount: number
  error: string | null
}

type ListeningCubeProps = {
  microphoneLevelRef: React.RefObject<number>
  peakRef: React.RefObject<number>
  manualLevel: number
  isListening: boolean
  reducedMotion: boolean
  onAnimationInfo: (info: AnimationInfo) => void
}

function configureModelShadows(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
  })
}

function applyMorphInfluences(bindings: MorphBinding[], value: number) {
  for (const { mesh, index } of bindings) {
    if (mesh.morphTargetInfluences && index < mesh.morphTargetInfluences.length) {
      mesh.morphTargetInfluences[index] = value
    }
  }
}

function applyEarPeak(pivots: EarPivot[], peak: number, elapsedTime: number) {
  const angle = peak * (PEAK_ROTATION_RADIANS + Math.sin(elapsedTime * 24) * 0.018)
  peakQuaternion.setFromAxisAngle(Y_AXIS, -angle)

  for (const { node, baseQuaternion } of pivots) {
    node.quaternion.copy(baseQuaternion).multiply(peakQuaternion)
  }
}

function resetEarPivots(pivots: EarPivot[]) {
  for (const { node, baseQuaternion } of pivots) {
    node.quaternion.copy(baseQuaternion)
  }
}

function framePerspectiveCamera(
  camera: THREE.PerspectiveCamera,
  viewportWidth: number,
  viewportHeight: number,
  framedWidth: number,
  framedHeight: number,
) {
  const aspect = viewportWidth / Math.max(1, viewportHeight)
  const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov / 2)
  const verticalDistance = framedHeight / (2 * Math.tan(halfVerticalFov) * 0.72)
  const horizontalDistance = framedWidth / (2 * Math.tan(halfVerticalFov) * aspect * 0.82)
  const distance = Math.max(5.25, verticalDistance, horizontalDistance)

  camera.position.set(0, 0.2, distance)
  camera.near = Math.max(0.1, distance / 100)
  camera.far = Math.max(50, distance * 5)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
}

function scrubClipActions(actions: ClipAction[], response: number, mixer: THREE.AnimationMixer) {
  for (const { clip, action } of actions) {
    action.time = response * clip.duration
  }
  mixer.update(0)
}

function ResponsiveCamera({ framedWidth, framedHeight }: { framedWidth: number; framedHeight: number }) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera) || framedWidth <= 0 || framedHeight <= 0) return
    framePerspectiveCamera(camera, size.width, size.height, framedWidth, framedHeight)
  }, [camera, framedHeight, framedWidth, size.height, size.width])

  return null
}

export function ListeningCube({
  microphoneLevelRef,
  peakRef,
  manualLevel,
  isListening,
  reducedMotion,
  onAnimationInfo,
}: ListeningCubeProps) {
  const floatingGroupRef = useRef<THREE.Group>(null)
  const responseRef = useRef(0)
  const actionsRef = useRef<ClipAction[]>([])
  const { scene, animations } = useGLTF(EAR_MODEL_URL)
  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene])

  const asset = useMemo(() => {
    scene.updateMatrixWorld(true)

    const baseBounds = new THREE.Box3().setFromObject(scene, true)
    const framingBounds = new THREE.Box3().setFromObject(scene)
    const baseSize = baseBounds.getSize(new THREE.Vector3())
    const framingSize = framingBounds.getSize(new THREE.Vector3())
    const framingCenter = framingBounds.getCenter(new THREE.Vector3())
    const largestFramingDimension = Math.max(framingSize.x, framingSize.y, framingSize.z)
    const uniformScale = largestFramingDimension > 0 ? TARGET_FRAMING_SIZE / largestFramingDimension : 1
    const modelOffset = framingCenter.multiplyScalar(-1)

    const morphTargets: MorphTargetInfo[] = []
    const morphBindings: MorphBinding[] = []
    const earPivots: EarPivot[] = []
    const pivotNodes = new Set<THREE.Object3D>()
    let visibleMeshCount = 0

    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      if (child.visible) visibleMeshCount += 1
      if (!child.morphTargetInfluences?.length) return

      const dictionary = Object.entries(child.morphTargetDictionary ?? {}).sort(
        ([, leftIndex], [, rightIndex]) => leftIndex - rightIndex,
      )
      const targets = dictionary.length > 0 ? dictionary : [['Morph target 0', 0] as const]

      for (const [name, index] of targets) {
        morphTargets.push({ meshName: child.name, name, index })
        morphBindings.push({ mesh: child, index })
      }

      if (child.parent && !pivotNodes.has(child.parent)) {
        pivotNodes.add(child.parent)
        earPivots.push({ node: child.parent, baseQuaternion: child.parent.quaternion.clone() })
      }
    })

    const clips = animations.filter((candidate) =>
      candidate.tracks.some((track) => track.name.includes('morphTargetInfluences')),
    )
    const mode: EarControlMode = clips.length > 0 ? 'clip' : morphBindings.length > 0 ? 'morph' : 'none'
    const finiteBounds = [...baseSize.toArray(), ...framingSize.toArray()].every(Number.isFinite)
    const error =
      visibleMeshCount === 0
        ? 'The assembled glTF loaded but contains no visible meshes.'
        : !finiteBounds || largestFramingDimension <= 1e-7
          ? 'The assembled glTF has unusable or empty bounds and cannot be framed.'
          : mode === 'none'
            ? 'The assembled glTF contains neither usable morph animation tracks nor morph targets.'
            : null

    return {
      baseSize,
      framingSize,
      uniformScale,
      modelOffset,
      morphTargets,
      morphBindings,
      earPivots,
      clips,
      mode,
      visibleMeshCount,
      error,
    }
  }, [animations, scene])

  useEffect(() => {
    configureModelShadows(scene)
  }, [scene])

  useEffect(() => {
    if (asset.mode !== 'clip') return

    const actions = asset.clips.map((clip) => {
      const action = mixer.clipAction(clip, scene)
      action.reset()
      action.enabled = true
      action.clampWhenFinished = true
      action.setLoop(THREE.LoopOnce, 1)
      action.play()
      action.time = 0
      return { clip, action }
    })

    actionsRef.current = actions
    mixer.update(0)

    return () => {
      for (const { action } of actions) {
        action.time = 0
      }
      mixer.update(0)
      actionsRef.current = []
      mixer.stopAllAction()
      mixer.uncacheRoot(scene)
    }
  }, [asset.clips, asset.mode, mixer, scene])

  useEffect(() => {
    onAnimationInfo({
      assetFilename: ASSET_FILENAME,
      mode: asset.mode,
      clipNames: asset.clips.map((clip) => clip.name || 'Unnamed'),
      duration: asset.clips.length > 0 ? Math.max(...asset.clips.map((clip) => clip.duration)) : null,
      clipCount: animations.length,
      trackNames: asset.clips.flatMap((clip) => clip.tracks.map((track) => track.name)),
      morphTargets: asset.morphTargets,
      bounds: asset.baseSize.toArray(),
      uniformScale: asset.uniformScale,
      visibleMeshCount: asset.visibleMeshCount,
      error: asset.error,
    })
  }, [animations.length, asset, onAnimationInfo])

  useEffect(() => {
    return () => {
      applyMorphInfluences(asset.morphBindings, 0)
      resetEarPivots(asset.earPivots)
    }
  }, [asset.earPivots, asset.morphBindings])

  useFrame(({ clock }, delta) => {
    const liveLevel = microphoneLevelRef.current ?? 0
    const desiredResponse = isListening ? liveLevel : manualLevel
    responseRef.current = THREE.MathUtils.damp(
      responseRef.current,
      desiredResponse,
      desiredResponse > responseRef.current ? 14 : 5,
      delta,
    )

    if (asset.mode === 'clip') {
      scrubClipActions(actionsRef.current, responseRef.current, mixer)
    } else if (asset.mode === 'morph') {
      applyMorphInfluences(asset.morphBindings, responseRef.current)
    }

    const peak = reducedMotion ? 0 : (peakRef.current ?? 0)
    applyEarPeak(asset.earPivots, peak, clock.elapsedTime)

    const group = floatingGroupRef.current
    if (!group) return

    const floatAmount = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.7) * 0.075
    const yaw = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.28) * 0.075
    group.position.y = THREE.MathUtils.damp(group.position.y, floatAmount, 3, delta)
    group.rotation.y = THREE.MathUtils.damp(group.rotation.y, yaw, 3, delta)
  })

  const framedWidth = asset.framingSize.x * asset.uniformScale
  const framedHeight = asset.framingSize.y * asset.uniformScale
  const modelOffset = asset.modelOffset.toArray() as [number, number, number]

  return (
    <>
      <ResponsiveCamera framedWidth={framedWidth} framedHeight={framedHeight} />

      <group ref={floatingGroupRef}>
        <group scale={asset.uniformScale}>
          <group position={modelOffset}>
            <primitive object={scene} />
          </group>
        </group>
      </group>

      <mesh position={[0, -1.55, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[3.8, 64]} />
        <shadowMaterial color="#020308" opacity={0.42} transparent />
      </mesh>

      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.07}
        minDistance={4}
        maxDistance={30}
        minPolarAngle={Math.PI * 0.31}
        maxPolarAngle={Math.PI * 0.69}
        minAzimuthAngle={-Math.PI * 0.23}
        maxAzimuthAngle={Math.PI * 0.23}
        target={[0, 0, 0]}
      />
    </>
  )
}

useGLTF.preload(EAR_MODEL_URL)
