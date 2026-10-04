/**
 * Indoor Range 01, photorealistic: photo-scanned concrete, rubber backstop,
 * fabric acoustic panels, HDRI fill light and scattered brass on the floor.
 * Same room layout and camera as before, so existing stages still fit.
 */
import React, { useMemo } from 'react';
import { random } from 'remotion';
import * as THREE from 'three';
import { useTextures } from './assets';
import { Bloom, EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { EnvLighting, usePBR } from './pbr';

const W = 16;
const D = 34;
const H = 6;
const BACK_Z = D - 6;
const LIGHT = '#f4f1ea';

const repeat = (t: THREE.Texture, x: number, y: number) => {
  const c = t.clone();
  c.needsUpdate = true;
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(x, y);
  return c;
};

const KeyLight: React.FC = () => {
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, 0, 10);
    return o;
  }, []);
  return (
    <>
      <primitive object={target} />
      <directionalLight
        position={[3, 14, -3]}
        target={target}
        intensity={1.6}
        color={LIGHT}
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.0004}
        shadow-radius={5}
      />
    </>
  );
};

/** Spent 9 mm brass lying around the front of the bay. */
const Brass: React.FC = () => {
  const mesh = useMemo(() => {
    const n = 40;
    const geo = new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 12);
    const mat = new THREE.MeshStandardMaterial({ color: '#c99d48', metalness: 1, roughness: 0.32 });
    const m = new THREE.InstancedMesh(geo, mat, n);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      // denser near the shooting position, thinning out downrange
      const z = -0.8 + Math.pow(random(`br-z${i}`), 1.8) * 4.5;
      const x = (random(`br-x${i}`) - 0.5) * (3 + z * 0.9);
      o.position.set(x, 0.0048, z);
      o.rotation.set(Math.PI / 2, 0, random(`br-r${i}`) * Math.PI * 2);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.castShadow = true;
    return m;
  }, []);
  return <primitive object={mesh} />;
};

export const IndoorRealistic: React.FC = () => {
  const tex = useTextures();
  const floor = usePBR('Concrete034', { repeat: [W / 1.6, D / 1.6] });
  const stains = useMemo(() => repeat(tex.concrete, 1, 1), [tex]);
  const panelMap = useMemo(() => repeat(tex.panel, 16, 3), [tex]);
  const sidePanelMap = useMemo(() => repeat(tex.panel, 17, 3), [tex]);
  const fabric = usePBR('Fabric030', { repeat: [W * 2 * 3, H * 3], skip: ['color'] });
  const fabricSide = usePBR('Fabric030', { repeat: [D * 3, H * 3], skip: ['color'] });
  const rubber = usePBR('Rubber001', { repeat: [W / 1.2, 3.2 / 1.2] });
  const column = usePBR('Concrete036', { repeat: [0.4, H / 1.5] });
  const steel = usePBR('PaintedMetal004', { repeat: [4, 1], skip: ['color', 'metal'] });
  const lights = [-4.5, 0, 4.5].flatMap((x) => [3, 8.5, 14, 19.5, 25].map((z) => [x, z] as const));

  return (
    <>
      <color attach="background" args={['#0b0b0c']} />
      <EffectComposer multisampling={8}>
        <N8AO aoRadius={2} distanceFalloff={1.5} intensity={4} quality="ultra" halfRes={false} />
        <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.2} intensity={0.7} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
      <EnvLighting intensity={0.12} />
      <ambientLight intensity={0.22} />
      <hemisphereLight args={['#dfe6ee', '#2a2826', 0.25]} />
      <KeyLight />
      {lights.map(([x, z], i) => (
        <pointLight key={i} position={[x, H - 0.4, z]} intensity={13} distance={16} decay={1.4} color={LIGHT} />
      ))}

      {/* sealed concrete floor: photo concrete + large, soft stains (aoMap at room scale) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, D / 2 - 6]} receiveShadow>
        <planeGeometry args={[W * 2, D]} />
        <meshStandardMaterial
          {...floor}
          aoMap={stains}
          aoMapIntensity={0.6}
          color="#7a7874"
          roughness={0.58}
          metalness={0.02}
          normalScale={new THREE.Vector2(0.3, 0.3)}
        />
      </mesh>
      <Brass />

      {/* fabric-covered acoustic panels */}
      <mesh position={[0, H / 2, BACK_Z]} receiveShadow>
        <planeGeometry args={[W * 2, H]} />
        <meshStandardMaterial map={panelMap} color="#77787a" normalMap={fabric.normalMap} roughnessMap={fabric.roughnessMap} roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (W / 2), H / 2, D / 2 - 6]} rotation={[0, (s * Math.PI) / 2, 0]} receiveShadow>
          <planeGeometry args={[D, H]} />
          <meshStandardMaterial map={sidePanelMap} color="#77787a" normalMap={fabricSide.normalMap} roughnessMap={fabricSide.roughnessMap} roughness={1} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* steel kick plates along the side walls */}
      {[-1, 1].map((s) => (
        <mesh key={`k${s}`} position={[s * (W / 2 - 0.03), 0.3, D / 2 - 6]} rotation={[0, (s * Math.PI) / 2, 0]} receiveShadow>
          <planeGeometry args={[D, 0.6]} />
          <meshStandardMaterial {...steel} color="#3a3d40" metalness={0.6} roughness={0.55} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* structural columns */}
      {[-1, 1].flatMap((s) =>
        [5, 12, 19].map((z) => (
          <mesh key={`${s}${z}`} position={[s * (W / 2 - 0.3), H / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[0.6, H, 0.6]} />
            <meshStandardMaterial {...column} color="#4a4b4d" roughness={0.95} />
          </mesh>
        )),
      )}

      {/* backstop: granulated rubber berm + steel baffle */}
      <mesh position={[0, 1.15, BACK_Z - 1.3]} rotation={[0.9, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, 3.2, 0.6]} />
        <meshStandardMaterial {...rubber} color="#8a8a8a" roughness={1} />
      </mesh>
      <mesh position={[0, 3.6, BACK_Z - 0.4]} rotation={[-0.35, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, 1.1, 0.08]} />
        <meshStandardMaterial {...steel} color="#2a2d30" metalness={0.6} roughness={0.5} />
      </mesh>

      {/* ceiling, trusses, high-bay lights */}
      <mesh position={[0, H, D / 2 - 6]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W * 2, D]} />
        <meshStandardMaterial color="#111213" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {[3, 8.5, 14, 19.5, 25].map((z) => (
        <mesh key={z} position={[0, H - 0.25, z + 2.7]}>
          <boxGeometry args={[W, 0.35, 0.18]} />
          <meshStandardMaterial {...steel} color="#1d1f21" roughness={0.6} metalness={0.5} />
        </mesh>
      ))}
      {lights.map(([x, z], i) => (
        <mesh key={i} position={[x, H - 0.45, z]}>
          <boxGeometry args={[1.4, 0.08, 0.4]} />
          <meshStandardMaterial color="#ffffff" emissive={LIGHT} emissiveIntensity={3} />
        </mesh>
      ))}
    </>
  );
};
