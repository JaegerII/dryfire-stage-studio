import React, { useMemo } from 'react';
import * as THREE from 'three';
import { random } from 'remotion';
import { useTextures } from './assets';

export type EnvironmentId = 'indoor_01' | 'indoor_02' | 'outdoor_01' | 'outdoor_02';

const repeat = (t: THREE.Texture, x: number, y: number) => {
  const c = t.clone();
  c.needsUpdate = true;
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(x, y);
  return c;
};

/** Soft key light (only the columns / trees / backstop cast shadows on empty plates). */
const KeyLight: React.FC<{ position: [number, number, number]; intensity: number; color?: string }> = ({
  position,
  intensity,
  color = '#ffffff',
}) => {
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, 0, 10);
    return o;
  }, []);
  return (
    <>
      <primitive object={target} />
      <directionalLight
        position={position}
        target={target}
        intensity={intensity}
        color={color}
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
        shadow-radius={4}
      />
    </>
  );
};

// ------------------------------------------------------------------ indoor

type IndoorStyle = {
  wall: 'panel' | 'block';
  wallTint: string;
  floorTint: string;
  ceiling: string;
  lightColor: string;
  ambient: number;
  pointIntensity: number;
};

const INDOOR: Record<'indoor_01' | 'indoor_02', IndoorStyle> = {
  // dark acoustic panels, warm-white high bay lights
  indoor_01: { wall: 'panel', wallTint: '#ffffff', floorTint: '#b4b2ad', ceiling: '#111213', lightColor: '#f4f1ea', ambient: 0.4, pointIntensity: 14 },
  // grey concrete block, cooler and brighter LED bay
  indoor_02: { wall: 'block', wallTint: '#e2e5e8', floorTint: '#c2c4c5', ceiling: '#1a1c1e', lightColor: '#eef4ff', ambient: 0.5, pointIntensity: 17 },
};

const Indoor: React.FC<{ style: IndoorStyle }> = ({ style }) => {
  const tex = useTextures();
  const W = 16;
  const D = 34;
  const H = 6;
  const wallMap = useMemo(() => repeat(style.wall === 'panel' ? tex.panel : tex.block, 16, 3), [tex, style.wall]);
  const sideMap = useMemo(() => repeat(style.wall === 'panel' ? tex.panel : tex.block, 17, 3), [tex, style.wall]);
  const lights = [-4.5, 0, 4.5].flatMap((x) => [3, 8.5, 14, 19.5, 25].map((z) => [x, z] as const));
  const backZ = D - 6;

  return (
    <>
      <color attach="background" args={['#0b0b0c']} />
      <ambientLight intensity={style.ambient} />
      <hemisphereLight args={['#dfe6ee', '#2a2826', 0.35]} />
      <KeyLight position={[3, 14, -3]} intensity={2.0} color={style.lightColor} />
      {lights.map(([x, z], i) => (
        <pointLight key={i} position={[x, H - 0.4, z]} intensity={style.pointIntensity} distance={16} decay={1.4} color={style.lightColor} />
      ))}

      {/* polished concrete floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, D / 2 - 6]} receiveShadow>
        <planeGeometry args={[W * 2, D]} />
        <meshStandardMaterial map={tex.concrete} color={style.floorTint} roughness={0.45} metalness={0.05} />
      </mesh>

      {/* walls */}
      <mesh position={[0, H / 2, backZ]} receiveShadow>
        <planeGeometry args={[W * 2, H]} />
        <meshStandardMaterial map={wallMap} color={style.wallTint} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (W / 2), H / 2, D / 2 - 6]} rotation={[0, (s * Math.PI) / 2, 0]} receiveShadow>
          <planeGeometry args={[D, H]} />
          <meshStandardMaterial map={sideMap} color={style.wallTint} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* structural columns */}
      {[-1, 1].flatMap((s) =>
        [5, 12, 19].map((z) => (
          <mesh key={`${s}${z}`} position={[s * (W / 2 - 0.3), H / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[0.6, H, 0.6]} />
            <meshStandardMaterial color="#2a2b2d" roughness={0.9} />
          </mesh>
        )),
      )}

      {/* backstop: sloped granulated-rubber berm with a steel baffle above */}
      <mesh position={[0, 1.15, backZ - 1.3]} rotation={[0.9, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, 3.2, 0.6]} />
        <meshStandardMaterial map={tex.rubber} roughness={1} />
      </mesh>
      <mesh position={[0, 3.6, backZ - 0.4]} rotation={[-0.35, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, 1.1, 0.08]} />
        <meshStandardMaterial color="#26292c" roughness={0.6} metalness={0.5} />
      </mesh>

      {/* ceiling: trusses + high-bay lights */}
      <mesh position={[0, H, D / 2 - 6]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W * 2, D]} />
        <meshStandardMaterial color={style.ceiling} roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {[3, 8.5, 14, 19.5, 25].map((z) => (
        <mesh key={z} position={[0, H - 0.25, z + 2.7]}>
          <boxGeometry args={[W, 0.35, 0.18]} />
          <meshStandardMaterial color="#1d1f21" roughness={0.7} metalness={0.4} />
        </mesh>
      ))}
      {lights.map(([x, z], i) => (
        <mesh key={i} position={[x, H - 0.45, z]}>
          <boxGeometry args={[1.4, 0.08, 0.4]} />
          <meshStandardMaterial color="#ffffff" emissive={style.lightColor} emissiveIntensity={3} />
        </mesh>
      ))}
    </>
  );
};

// ------------------------------------------------------------------ outdoor

type OutdoorStyle = {
  sun: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  sky: string;
  fog: string;
  bermTint: string;
  gravelTint: string;
  trees: number;
  shrubs: number;
};

const OUTDOOR: Record<'outdoor_01' | 'outdoor_02', OutdoorStyle> = {
  // midday, light gravel, brown berm
  outdoor_01: { sun: [-7, 16, -5], sunColor: '#fff4e2', sunIntensity: 2.4, sky: '#9cc4ea', fog: '#c9dcea', bermTint: '#ffffff', gravelTint: '#e2dccf', trees: 70, shrubs: 26 },
  // late afternoon, warmer light, greener berm, more vegetation
  outdoor_02: { sun: [9, 7, -4], sunColor: '#ffd9a8', sunIntensity: 2.6, sky: '#a9c3dc', fog: '#e6d6c2', bermTint: '#b9c08f', gravelTint: '#d6cdbb', trees: 95, shrubs: 48 },
};

const Outdoor: React.FC<{ style: OutdoorStyle; seed: string }> = ({ style, seed }) => {
  const { gravel, berm, sky } = useTextures();
  const trees = useMemo(
    () =>
      Array.from({ length: style.trees }, (_, i) => {
        const side = i % 3; // 0 back, 1 left, 2 right
        const t = random(`${seed}-tree-t${i}`);
        const pos: [number, number, number] =
          side === 0
            ? [-24 + t * 48, 3.0, 21 + random(`${seed}-tree-d${i}`) * 3]
            : [(side === 1 ? 1 : -1) * (12.5 + random(`${seed}-tree-d${i}`) * 2.5), 2.8, -2 + t * 23];
        return { pos, r: 0.8 + random(`${seed}-tree-r${i}`) * 0.9, shade: random(`${seed}-tree-s${i}`) };
      }),
    [style.trees, seed],
  );
  const shrubs = useMemo(
    () =>
      Array.from({ length: style.shrubs }, (_, i) => {
        const t = random(`${seed}-shrub-t${i}`);
        const back = i % 2 === 0;
        const pos: [number, number, number] = back
          ? [-18 + t * 36, 0.15, 16.6 + random(`${seed}-shrub-d${i}`) * 1.2]
          : [(i % 4 === 1 ? 1 : -1) * (9.4 + random(`${seed}-shrub-d${i}`) * 0.6), 0.15, 1 + t * 14];
        return { pos, r: 0.25 + random(`${seed}-shrub-r${i}`) * 0.35, shade: random(`${seed}-shrub-s${i}`) };
      }),
    [style.shrubs, seed],
  );

  return (
    <>
      <color attach="background" args={[style.sky]} />
      <fog attach="fog" args={[style.fog, 30, 90]} />
      <ambientLight intensity={0.3} />
      <hemisphereLight args={['#cfe3ff', '#6f604c', 0.7]} />
      <KeyLight position={style.sun} intensity={style.sunIntensity} color={style.sunColor} />

      <mesh position={[0, 12, 60]}>
        <planeGeometry args={[220, 70]} />
        <meshBasicMaterial map={sky} fog={false} side={THREE.DoubleSide} />
      </mesh>

      {/* gravel bay */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 14]} receiveShadow>
        <planeGeometry args={[44, 44]} />
        <meshStandardMaterial map={gravel} color={style.gravelTint} roughness={0.95} />
      </mesh>

      {/* earth berms: back (sloped) + sides */}
      <mesh position={[0, 1.25, 18.5]} rotation={[0.6, 0, 0]} receiveShadow>
        <planeGeometry args={[48, 3.2]} />
        <meshStandardMaterial map={berm} color={style.bermTint} roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 10.5, 1.3, 8]} rotation={[0, (-s * Math.PI) / 2, 0]} receiveShadow>
          <planeGeometry args={[30, 2.6]} />
          <meshStandardMaterial map={berm} color={style.bermTint} roughness={1} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* sparse vegetation at the berm foot */}
      {shrubs.map((b, i) => (
        <mesh key={`s${i}`} position={b.pos} scale={[b.r * 1.4, b.r * 0.8, b.r * 1.2]} castShadow receiveShadow>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={b.shade > 0.5 ? '#5D7536' : '#46602A'} roughness={1} flatShading />
        </mesh>
      ))}

      {/* tree line */}
      {trees.map((t, i) => (
        <mesh key={i} position={t.pos} scale={[t.r, t.r * 1.15, t.r]} castShadow>
          <icosahedronGeometry args={[1, 2]} />
          <meshStandardMaterial color={t.shade > 0.5 ? '#3E5F2C' : '#2F4A22'} roughness={1} flatShading />
        </mesh>
      ))}
    </>
  );
};

export const RangeEnvironment: React.FC<{ id: EnvironmentId }> = ({ id }) =>
  id === 'indoor_01' || id === 'indoor_02' ? <Indoor style={INDOOR[id]} /> : <Outdoor style={OUTDOOR[id]} seed={id} />;
