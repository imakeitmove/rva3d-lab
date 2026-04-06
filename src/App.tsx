import { Canvas } from "@react-three/fiber"
import { OrbitControls, Grid } from "@react-three/drei"

function App() {
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#111" }}>
      <Canvas camera={{ position: [0, 2, 6], fov: 50 }}>
        <ambientLight intensity={1.2} />
        <directionalLight position={[5, 8, 5]} intensity={2} />

        <Grid
          args={[20, 20]}
          cellSize={1}
          cellThickness={0.5}
          sectionSize={5}
          sectionThickness={1}
          fadeDistance={30}
          fadeStrength={1}
          infiniteGrid
        />

        <OrbitControls />
      </Canvas>
    </div>
  )
}

export default App