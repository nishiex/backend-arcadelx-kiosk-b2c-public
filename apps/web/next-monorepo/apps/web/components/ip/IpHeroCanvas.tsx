"use client"

// R3F renders three.js elements through the JSX runtime, so properties such as
// `emissive`, `position` and `roughness` are valid at runtime.
/* eslint-disable react/no-unknown-property */

import React from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { ContactShadows, Float, Sparkles } from "@react-three/drei"
import type { Group } from "three"

type KioskProps = {
  accent: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
}

/**
 * A compact arcade cabinet built from primitives: marquee, illuminated screen,
 * controls and coin door all read at dashboard size. It is deliberately a
 * product object rather than an abstract shape, so the studio has a tangible
 * connection to the kiosks earning its royalties.
 */
function ArcadeKiosk({ accent, position, rotation, scale }: KioskProps) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Cabinet and raised screen housing. */}
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.06, 1.88, 0.66]} />
        <meshStandardMaterial color="#101b33" metalness={0.72} roughness={0.28} />
      </mesh>
      <mesh position={[0, 0.56, 0.365]}>
        <boxGeometry args={[0.83, 0.72, 0.055]} />
        <meshStandardMaterial color="#050a14" metalness={0.25} roughness={0.18} />
      </mesh>
      <mesh position={[0, 0.56, 0.4]}>
        <planeGeometry args={[0.68, 0.55]} />
        <meshStandardMaterial color="#081e39" emissive={accent} emissiveIntensity={0.72} metalness={0.18} roughness={0.12} />
      </mesh>

      {/* Screen graphics, marquee and trim. */}
      {[-0.14, 0, 0.14].map((y, index) => (
        <mesh key={y} position={[index === 1 ? -0.08 : 0.03, 0.57 + y, 0.407]}>
          <boxGeometry args={[index === 1 ? 0.38 : 0.5, 0.026, 0.012]} />
          <meshBasicMaterial color={index === 1 ? "#f7fbff" : accent} transparent opacity={0.82} />
        </mesh>
      ))}
      <mesh position={[0, 1.02, 0.36]}>
        <boxGeometry args={[0.92, 0.19, 0.09]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.8} metalness={0.45} roughness={0.2} />
      </mesh>
      <mesh position={[0, -0.18, 0.43]} rotation={[-0.26, 0, 0]}>
        <boxGeometry args={[0.82, 0.28, 0.13]} />
        <meshStandardMaterial color="#172542" metalness={0.75} roughness={0.24} />
      </mesh>

      {/* Control panel: one joystick, two buttons and a coin door. */}
      <mesh position={[-0.19, -0.03, 0.53]}>
        <sphereGeometry args={[0.075, 20, 20]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.55} metalness={0.6} roughness={0.2} />
      </mesh>
      {[0.08, 0.25].map((x, index) => (
        <mesh key={x} position={[x, -0.08, 0.5]}>
          <cylinderGeometry args={[0.052, 0.052, 0.04, 20]} />
          <meshStandardMaterial color={index ? "#f7b955" : "#f5f9ff"} emissive={index ? "#f7b955" : "#dcecff"} emissiveIntensity={0.35} />
        </mesh>
      ))}
      <mesh position={[0, -0.62, 0.35]}>
        <boxGeometry args={[0.22, 0.3, 0.03]} />
        <meshStandardMaterial color="#07101f" metalness={0.7} roughness={0.25} />
      </mesh>
      <mesh position={[0, -0.56, 0.374]}>
        <circleGeometry args={[0.042, 20]} />
        <meshBasicMaterial color={accent} />
      </mesh>
    </group>
  )
}

function ArcadeFleet({ interactive }: { interactive: boolean }) {
  const group = React.useRef<Group>(null)

  useFrame((state, delta) => {
    const node = group.current
    if (!node) return
    node.rotation.y += delta * 0.13
    const targetX = interactive ? state.pointer.y * 0.12 : 0
    const targetZ = interactive ? state.pointer.x * 0.1 : 0
    node.rotation.x += (targetX - node.rotation.x) * 0.045
    node.rotation.z += (targetZ - node.rotation.z) * 0.045
  })

  return (
    <group ref={group} position={[0, -0.18, 0]}>
      <Float speed={1.25} rotationIntensity={0.15} floatIntensity={0.28}>
        <ArcadeKiosk accent="#4f7df3" position={[-1.23, 0, 0.12]} rotation={[0.06, 0.5, -0.04]} scale={0.92} />
      </Float>
      <Float speed={1.1} rotationIntensity={0.12} floatIntensity={0.2}>
        <ArcadeKiosk accent="#6c92ff" position={[0.1, 0.08, -0.25]} rotation={[0.01, -0.12, 0]} scale={1.08} />
      </Float>
      <Float speed={1.35} rotationIntensity={0.18} floatIntensity={0.25}>
        <ArcadeKiosk accent="#8ba8ff" position={[1.28, -0.04, 0.14]} rotation={[0.04, -0.56, 0.04]} scale={0.9} />
      </Float>

      {/* Network rings communicate a connected fleet without obscuring the cabinets. */}
      {[1.92, 2.34].map((radius, index) => (
        <mesh key={radius} rotation={[Math.PI / 2 + index * 0.15, 0.2, 0]}>
          <torusGeometry args={[radius, 0.012, 8, 96]} />
          <meshBasicMaterial color={index ? "#4f7df3" : "#6c92ff"} transparent opacity={0.22} />
        </mesh>
      ))}
    </group>
  )
}

export default function IpHeroCanvas({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [0, 1.05, 5.9], fov: 38 }}
      frameloop={reducedMotion ? "demand" : "always"}
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#d9efff", "#07101f", 1.05]} />
      <directionalLight castShadow position={[4, 5, 4]} intensity={2.3} color="#e9f6ff" />
      <pointLight position={[-3.5, 0.8, 2.5]} intensity={15} distance={7} color="#4f7df3" />
      <pointLight position={[3.5, -0.3, 1.5]} intensity={9} distance={6} color="#6c92ff" />
      <ArcadeFleet interactive={!reducedMotion} />
      {!reducedMotion && <Sparkles count={38} scale={[5.5, 3.7, 3]} size={1.8} speed={0.25} color="#d9e5ff" opacity={0.5} />}
      <ContactShadows position={[0, -1.42, 0]} opacity={0.42} scale={7.5} blur={2.8} far={3.5} color="#020715" />
    </Canvas>
  )
}
