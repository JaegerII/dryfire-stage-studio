import React, { useMemo } from 'react';
import * as THREE from 'three';
import { random } from 'remotion';
import { useTextures } from './assets';
import { IndoorRealistic } from './IndoorRealistic';

export type EnvironmentId = 'indoor_01' | 'indoor_02' | 'indoor_03' | 'indoor_04' | 'outdoor_01' | 'outdoor_02' | 'outdoor_03' | 'outdoor_04';

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

// ------------------------------------------------------------------ indoor 03: bright tunnel range

/** Long, narrow lane: light acoustic tiles on walls + ceiling, LED strips, green floor, bright backstop. */
const IndoorTunnel: React.FC = () => {
  const tex = useTextures();
  const W = 8;
  const D = 40;
  const H = 3.6;
  const z0 = -4;
  const back = 34;
  const wallMap = useMemo(() => repeat(tex.tile, D / 1.2, H / 1.2), [tex]);
  const ceilMap = useMemo(() => repeat(tex.tile, W / 1.2, D / 1.2), [tex]);
  const floorMap = useMemo(() => repeat(tex.greenFloor, 2, 10), [tex]);
  const strips = Array.from({ length: 11 }, (_, i) => 1 + i * 3);
  const baffles = Array.from({ length: 9 }, (_, i) => -2.4 + i * 0.6);

  return (
    <>
      <color attach="background" args={['#e8eaea']} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#ffffff', '#5f7a6a', 0.6]} />
      <KeyLight position={[1, 12, -3]} intensity={1.2} color="#f3f6ff" />
      {strips.map((z) => (
        <pointLight key={z} position={[0, H - 0.3, z]} intensity={7} distance={9} decay={1.5} color="#f5f8ff" />
      ))}

      {/* green floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, z0 + D / 2]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={floorMap} roughness={0.55} />
      </mesh>
      {/* tiled walls + ceiling */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * (W / 2), H / 2, z0 + D / 2]} rotation={[0, (sx * Math.PI) / 2, 0]} receiveShadow>
          <planeGeometry args={[D, H]} />
          <meshStandardMaterial map={wallMap} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <mesh position={[0, H, z0 + D / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={ceilMap} roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* LED strips across the lane */}
      {strips.map((z) => (
        <mesh key={z} position={[0, H - 0.03, z]}>
          <boxGeometry args={[W * 0.45, 0.04, 0.16]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={3} />
        </mesh>
      ))}

      {/* backstop: lit wall with alternating teal / white baffles and a dark steel trap below */}
      <mesh position={[0, H / 2, back + 0.6]}>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color="#f2f4f3" emissive="#ffffff" emissiveIntensity={0.25} />
      </mesh>
      {baffles.map((x, i) => (
        <mesh key={x} position={[x, 1.6, back + 0.4]}>
          <boxGeometry args={[0.5, 2.2, 0.08]} />
          <meshStandardMaterial color={i % 2 ? '#e3e8e6' : '#2E8A80'} roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, 0.28, back]} castShadow receiveShadow>
        <boxGeometry args={[W, 0.56, 0.6]} />
        <meshStandardMaterial color="#2a2d2e" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, H - 0.5, back - 0.6]}>
        <boxGeometry args={[W, 0.8, 0.1]} />
        <meshStandardMaterial map={wallMap} roughness={1} />
      </mesh>
    </>
  );
};

// ------------------------------------------------------------------ outdoor 03: grass berms, overcast

/** A grass berm: a ground plane with a smooth bump profile across its depth and a gentle wave along it. */
const Ridge: React.FC<{
  position: [number, number, number];
  rotationY?: number;
  width: number;
  depth: number;
  height: number;
  seed: number;
  map: THREE.Texture;
}> = ({ position, rotationY = 0, width, depth, height, seed, map }) => {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(width, depth, 96, 32);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const nz = pos.getZ(i) / (depth / 2); // -1 … 1 across the berm
      const profile = Math.pow(Math.max(0, Math.cos((nz * Math.PI) / 2)), 1.6);
      const wave = 1 + 0.18 * Math.sin(x * 0.35 + seed) + 0.08 * Math.sin(x * 1.1 + seed * 2);
      // let both ends fade into the ground instead of ending in a cut
      const end = Math.min(1, (width / 2 - Math.abs(x)) / Math.min(6, width / 4));
      const taper = end * end * (3 - 2 * end);
      pos.setY(i, height * profile * wave * taper);
    }
    g.computeVertexNormals();
    return g;
  }, [width, depth, height, seed]);
  const tex = useMemo(() => repeat(map, width / 8, depth / 6), [map, width, depth]);
  return (
    <mesh geometry={geometry} position={position} rotation={[0, rotationY, 0]} receiveShadow castShadow>
      <meshStandardMaterial map={tex} roughness={1} />
    </mesh>
  );
};

const OutdoorMeadow: React.FC = () => {
  const { grass, grassBerm, overcast } = useTextures();
  const ridges: { pos: [number, number, number]; rot?: number; w: number; d: number; h: number }[] = [
    { pos: [0, 0, 27], w: 70, d: 16, h: 4.6 },
    { pos: [-17, 0, 10], rot: Math.PI / 2, w: 40, d: 12, h: 3.6 },
    { pos: [17, 0, 10], rot: Math.PI / 2, w: 40, d: 12, h: 3.8 },
    { pos: [-11, 0, 21], w: 14, d: 7, h: 2.2 },
    { pos: [12, 0, 22], w: 16, d: 7, h: 2.4 },
  ];
  const trees = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const x = -22 + random(`bt-x${i}`) * 44;
        const z = 27 + random(`bt-z${i}`) * 6;
        const h = 6 + random(`bt-h${i}`) * 5;
        const branches = Array.from({ length: 6 }, (_, b) => ({
          y: h * (0.45 + random(`bt-by${i}-${b}`) * 0.5),
          rot: (random(`bt-br${i}-${b}`) - 0.5) * 1.6,
          yaw: random(`bt-bw${i}-${b}`) * Math.PI * 2,
          len: 1.2 + random(`bt-bl${i}-${b}`) * 2,
        }));
        return { x, z, h, branches };
      }),
    [],
  );

  return (
    <>
      <color attach="background" args={['#c9ced2']} />
      <fog attach="fog" args={['#c9ced2', 28, 85]} />
      <ambientLight intensity={0.45} />
      <hemisphereLight args={['#e4e8ec', '#4e5a35', 1.2]} />
      <KeyLight position={[-4, 18, -2]} intensity={0.9} color="#eef1f4" />

      <mesh position={[0, 14, 62]}>
        <planeGeometry args={[240, 70]} />
        <meshBasicMaterial map={overcast} fog={false} side={THREE.DoubleSide} />
      </mesh>

      {/* mown grass bay */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 14]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial map={grass} roughness={1} />
      </mesh>

      {/* grass berms */}
      {ridges.map((r, i) => (
        <Ridge key={i} position={r.pos} rotationY={r.rot} width={r.w} depth={r.d} height={r.h} seed={i * 1.7} map={grassBerm} />
      ))}

      {/* bare trees on the back berm */}
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 3.6, t.z]}>
          <mesh position={[0, t.h / 2, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.2, t.h, 6]} />
            <meshStandardMaterial color="#5a524a" roughness={1} />
          </mesh>
          {t.branches.map((b, j) => (
            <group key={j} position={[0, b.y, 0]} rotation={[0, b.yaw, b.rot]}>
              <mesh position={[0, b.len / 2, 0]} castShadow>
                <cylinderGeometry args={[0.02, 0.06, b.len, 5]} />
                <meshStandardMaterial color="#5f574e" roughness={1} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </>
  );
};

// ------------------------------------------------------------------ indoor 04: white beam ceiling, dark walls

const IndoorBeams: React.FC = () => {
  const tex = useTextures();
  const W = 14;
  const D = 38;
  const H = 4.6;
  const z0 = -4;
  const back = 32;
  const wallMap = useMemo(() => repeat(tex.concrete, D / 4, 1.2), [tex]);
  const backMap = useMemo(() => repeat(tex.concrete, W / 4, 1.2), [tex]);
  const beams = [-4.8, -1.6, 1.6, 4.8];
  const spots = beams.flatMap((x) => [2, 7, 12, 17, 22, 27].map((z) => [x, z] as const));

  return (
    <>
      <color attach="background" args={['#d9d9d6']} />
      <ambientLight intensity={0.6} />
      <hemisphereLight args={['#ffffff', '#6a6662', 0.7]} />
      <KeyLight position={[2, 14, -3]} intensity={1.3} color="#fbf7ef" />
      {spots.filter((_, i) => i % 2 === 0).map(([x, z], i) => (
        <pointLight key={i} position={[x, H - 0.7, z]} intensity={6} distance={9} decay={1.5} color="#fff6e8" />
      ))}

      {/* light concrete floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, z0 + D / 2]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={tex.concrete} color="#d6d4cf" roughness={0.5} />
      </mesh>
      {/* dark speckled walls */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * (W / 2), H / 2, z0 + D / 2]} rotation={[0, (sx * Math.PI) / 2, 0]} receiveShadow>
          <planeGeometry args={[D, H]} />
          <meshStandardMaterial map={wallMap} color="#b4b7bb" roughness={1} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <mesh position={[0, H / 2, back]} receiveShadow>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial map={backMap} color="#a2a5aa" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* bright ceiling with longitudinal beams and spots */}
      <mesh position={[0, H, z0 + D / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#f4f3ef" emissive="#ffffff" emissiveIntensity={0.25} side={THREE.DoubleSide} />
      </mesh>
      {beams.map((x) => (
        <mesh key={x} position={[x, H - 0.35, z0 + D / 2]}>
          <boxGeometry args={[0.55, 0.7, D]} />
          <meshStandardMaterial color="#e9e8e4" roughness={0.6} />
        </mesh>
      ))}
      {spots.map(([x, z], i) => (
        <mesh key={`s${i}`} position={[x, H - 0.72, z]}>
          <boxGeometry args={[0.3, 0.05, 0.3]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={3} />
        </mesh>
      ))}
    </>
  );
};

// ------------------------------------------------------------------ outdoor 04: sunset, covered shooting bays

const OutdoorSunset: React.FC = () => {
  const { grass, berm, sunset } = useTextures();
  const posts = Array.from({ length: 15 }, (_, i) => -28 + i * 4);
  return (
    <>
      <color attach="background" args={['#e7a067']} />
      <fog attach="fog" args={['#d99a6a', 35, 95]} />
      <ambientLight intensity={0.35} />
      <hemisphereLight args={['#ffc48f', '#3d4a28', 0.9]} />
      <KeyLight position={[6, 5, 30]} intensity={1.6} color="#ffb070" />
      <directionalLight position={[-3, 10, -6]} intensity={0.7} color="#ffe2c2" />

      <mesh position={[0, 16, 64]}>
        <planeGeometry args={[240, 72]} />
        <meshBasicMaterial map={sunset} fog={false} side={THREE.DoubleSide} />
      </mesh>

      {/* grass */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 14]} receiveShadow>
        <planeGeometry args={[70, 60]} />
        <meshStandardMaterial map={grass} color="#e0e6b8" roughness={1} />
      </mesh>

      {/* covered firing line in the distance: posts, sloped roof, dirt backstop behind */}
      <group position={[0, 0, 30]}>
        <mesh position={[0, 3.3, 0]} rotation={[0.12, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[56, 0.18, 5]} />
          <meshStandardMaterial color="#3E4A5E" roughness={0.6} metalness={0.3} />
        </mesh>
        <mesh position={[0, 3.05, -2.9]}>
          <boxGeometry args={[56, 0.25, 0.12]} />
          <meshStandardMaterial color="#3A4456" roughness={0.6} />
        </mesh>
        {posts.map((x) => (
          <mesh key={x} position={[x, 1.6, -2.7]} castShadow>
            <boxGeometry args={[0.18, 3.2, 0.18]} />
            <meshStandardMaterial color="#C8A94E" roughness={0.6} />
          </mesh>
        ))}
        {posts.map((x) => (
          <mesh key={`b${x}`} position={[x + 2, 0.45, 1]} castShadow receiveShadow>
            <boxGeometry args={[1.6, 0.9, 0.6]} />
            <meshStandardMaterial color="#5d564c" roughness={0.9} />
          </mesh>
        ))}
        <mesh position={[0, 1.3, 3.6]} rotation={[0.35, 0, 0]} receiveShadow>
          <planeGeometry args={[50, 3]} />
          <meshStandardMaterial map={berm} roughness={1} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
};

export const RangeEnvironment: React.FC<{ id: EnvironmentId }> = ({ id }) => {
  if (id === 'indoor_01') return <IndoorRealistic />;
  if (id === 'indoor_04') return <IndoorBeams />;
  if (id === 'outdoor_04') return <OutdoorSunset />;
  if (id === 'indoor_03') return <IndoorTunnel />;
  if (id === 'outdoor_03') return <OutdoorMeadow />;
  return id === 'indoor_02' ? <Indoor style={INDOOR[id]} /> : <Outdoor style={OUTDOOR[id]} seed={id} />;
};
