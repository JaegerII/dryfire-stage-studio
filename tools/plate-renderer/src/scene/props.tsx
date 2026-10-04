/**
 * Photorealistic 3D models of the Stage Studio assets. Dimensions mirror
 * scripts/generate-assets.mjs (cm there, meters here), so the rendered
 * sprites line up with the registry geometry (viewW / viewH / groundY).
 */
import React, { useMemo } from 'react';
import { random } from 'remotion';
import * as THREE from 'three';
import { usePBR, usePBRImage } from './pbr';

const cm = (v: number) => v / 100;

// ------------------------------------------------------------------ helpers

/** Closed polygon (cm) with rounded corners as a THREE.Shape in meters. */
const roundedShape = (pts: [number, number][], r: number, dy = 0) => {
  const s = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const d1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const d2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const a = [p1[0] + ((p0[0] - p1[0]) * rr) / d1, p1[1] + ((p0[1] - p1[1]) * rr) / d1];
    const b = [p1[0] + ((p2[0] - p1[0]) * rr) / d2, p1[1] + ((p2[1] - p1[1]) * rr) / d2];
    if (i === 0) s.moveTo(cm(a[0]), cm(a[1] + dy));
    else s.lineTo(cm(a[0]), cm(a[1] + dy));
    s.quadraticCurveTo(cm(p1[0]), cm(p1[1] + dy), cm(b[0]), cm(b[1] + dy));
  }
  s.closePath();
  return s;
};

/** UVs 0..1 over the shape's bounding box (front and back caps). */
const boxUV = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
  }
  uv.needsUpdate = true;
  return g;
};

const canvasTexture = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
};

/** Soft contact shadow, drawn as a camera-facing ellipse at the ground line (like the SVG assets). */
export const ContactShadow: React.FC<{ rx: number; opacity?: number }> = ({ rx, opacity = 0.45 }) => {
  const tex = useMemo(
    () =>
      canvasTexture(256, 64, (ctx) => {
        const g = ctx.createRadialGradient(128, 32, 0, 128, 32, 128);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.setTransform(1, 0, 0, 0.25, 0, 24);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 256, 256);
      }),
    [],
  );
  // soft ambient-occlusion pool on the floor under the object
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} renderOrder={-1}>
      <planeGeometry args={[cm(rx) * 2.4, cm(rx) * 1.4]} />
      <meshBasicMaterial map={tex} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
};

// ------------------------------------------------------------------ shared materials

const useGalvanized = () => {
  const pbr = usePBR('PaintedMetal004', { repeat: [0.6, 0.6], skip: ['color', 'metal'] });
  return { ...pbr, color: '#8a9096', metalness: 0.75, roughness: 0.6, normalScale: new THREE.Vector2(0.25, 0.25) };
};

const usePowderCoat = () => {
  const pbr = usePBR('PaintedMetal004', { repeat: [0.8, 0.8], skip: ['color', 'metal'] });
  return { ...pbr, color: '#2a2a2a', metalness: 0.35, roughness: 0.5, normalScale: new THREE.Vector2(0.35, 0.35) };
};

/** Light pine with the grain running along the long (vertical) axis. */
const usePine = (len: number) => {
  const pbr = usePBR('Wood058', { repeat: [len, 0.06], rotation: Math.PI / 2 });
  return { ...pbr, color: '#ffffff', roughness: 0.8 };
};

// ------------------------------------------------------------------ paper target

const OCT: [number, number][] = [[-11.5, 0], [11.5, 0], [23, 13], [23, 45], [11.5, 58], [-11.5, 58], [-23, 45], [-23, 13]];
const OCT_C: [number, number][] = [[-8, 6], [8, 6], [16.5, 15], [16.5, 43], [8, 52], [-8, 52], [-16.5, 43], [-16.5, 15]];
const OCT_A: [number, number][] = [[-4.5, 15], [4.5, 15], [7.5, 22], [7.5, 44], [5, 49], [-5, 49], [-7.5, 44], [-7.5, 22]];
const CARD_BOTTOM = 85;
const CARD_W = 46;
const CARD_H = 58;

/** Kraft card face: photo cardboard, desaturated to kraft tan, with printed scoring zones. */
const useCardFace = () => {
  const img = usePBRImage('Cardboard004', 'color');
  return useMemo(() => {
    const W = 1024;
    const H = Math.round((W * CARD_H) / CARD_W);
    const k = W / CARD_W; // px per cm
    const P = (x: number, y: number) => [(x + CARD_W / 2) * k, H - y * k] as const;
    return canvasTexture(W, H, (ctx) => {
      // photo board, roughly 60 cm of it across the card
      ctx.drawImage(img, 0, 0, img.width * 0.77, img.height * 0.77, 0, 0, W, H);
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = 'rgba(128,128,128,0.5)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#f7dcb4';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      // faint uneven tone
      for (let i = 0; i < 40; i++) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        const dark = random(`card-t${i}`) > 0.5;
        g.addColorStop(0, dark ? 'rgba(90,60,25,0.06)' : 'rgba(255,240,215,0.06)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.translate(random(`card-x${i}`) * W, random(`card-y${i}`) * H);
        ctx.scale(60 + random(`card-r${i}`) * 220, 60 + random(`card-q${i}`) * 220);
        ctx.fillStyle = g;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      }
      // printed zone lines (thin, slightly broken like perforation)
      const zone = (pts: [number, number][], r: number) => {
        const sh = roundedShape(pts, r);
        const sp = sh.getSpacedPoints(400);
        ctx.beginPath();
        sp.forEach((p, i) => {
          const [x, y] = P(p.x * 100, p.y * 100);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.setLineDash([0.9 * k, 0.25 * k]);
        ctx.lineWidth = 0.22 * k;
        ctx.strokeStyle = 'rgba(70,45,18,0.55)';
        ctx.stroke();
      };
      zone(OCT_C, 1.2);
      zone(OCT_A, 1.2);
      ctx.setLineDash([]);
      // small zone letters near the top
      ctx.fillStyle = 'rgba(70,45,18,0.42)';
      ctx.font = `700 ${1.5 * k}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      const letter = (t: string, x: number, y: number) => {
        const [px, py] = P(x, y);
        ctx.fillText(t, px, py);
      };
      letter('A', 0, 46.2);
      letter('C', 0, 49.8);
      letter('D', 0, 54.6);
      // edge wear: darker rim
      const sh = roundedShape(OCT, 1.6).getSpacedPoints(300);
      ctx.beginPath();
      sh.forEach((p, i) => {
        const [x, y] = P(p.x * 100, p.y * 100);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.lineWidth = 0.9 * k;
      ctx.strokeStyle = 'rgba(80,50,20,0.18)';
      ctx.stroke();
    });
  }, [img]);
};

const Staple: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <mesh position={[cm(x), cm(y), 0.0012]}>
    <boxGeometry args={[cm(1.3), cm(0.14), cm(0.08)]} />
    <meshStandardMaterial color="#c9ccd0" metalness={1} roughness={0.35} />
  </mesh>
);

/** Grey metal base: two feet toward the viewer, crossbar, optional sockets. */
export const MetalBase: React.FC<{ half: number; sockets?: number[] }> = ({ half, sockets = [] }) => {
  const galv = useGalvanized();
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[cm(s * half), cm(2), cm(4)]} castShadow receiveShadow>
          <boxGeometry args={[cm(7), cm(4), cm(30)]} />
          <meshStandardMaterial {...galv} />
        </mesh>
      ))}
      <mesh position={[0, cm(4.9), 0]} castShadow receiveShadow>
        <boxGeometry args={[cm(half * 2 + 7), cm(3.2), cm(4)]} />
        <meshStandardMaterial {...galv} />
      </mesh>
      {sockets.map((x) => (
        <group key={x} position={[cm(x), cm(10), 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[cm(6.4), cm(10), cm(6.4)]} />
            <meshStandardMaterial {...galv} />
          </mesh>
          <mesh position={[cm(1.8), 0, cm(3.25)]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[cm(0.9), cm(0.9), cm(0.5), 16]} />
            <meshStandardMaterial color="#55595e" metalness={0.8} roughness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

export const PaperTarget: React.FC = () => {
  const face = useCardFace();
  const board = usePBR('Cardboard004', { skip: ['color'] });
  const card = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(roundedShape(OCT, 1.6, CARD_BOTTOM), { depth: cm(0.45), bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -cm(0.45));
    return boxUV(g);
  }, []);
  const rodLen = CARD_BOTTOM + 20 - 12;
  const pine = usePine(1);
  return (
    <group>
      <ContactShadow rx={26} />
      <MetalBase half={20} sockets={[-12, 12]} />
      {[-12, 12].map((x) => (
        <mesh key={x} position={[cm(x), cm(12 + rodLen / 2), -cm(2.2)]} castShadow receiveShadow>
          <boxGeometry args={[cm(3.6), cm(rodLen), cm(1.8)]} />
          <meshStandardMaterial {...pine} />
        </mesh>
      ))}
      <mesh geometry={card} castShadow receiveShadow>
        <meshStandardMaterial attach="material-0" map={face} normalMap={board.normalMap} roughnessMap={board.roughnessMap} roughness={1} normalScale={new THREE.Vector2(0.6, 0.6)} />
        <meshStandardMaterial attach="material-1" color="#8a6740" roughness={0.95} />
      </mesh>
      {[-12, 12].flatMap((x) => [CARD_BOTTOM + 4, CARD_BOTTOM + 16].map((y) => <Staple key={`${x}${y}`} x={x} y={y} />))}
    </group>
  );
};

// ------------------------------------------------------------------ steel popper

const usePaintedSteel = () => {
  const pbr = usePBR('PaintedMetal004', { repeat: [0.5, 0.5], skip: ['color'] });
  // white paint with faint grey lead splatter
  const map = useMemo(
    () =>
      canvasTexture(512, 512, (ctx) => {
        ctx.fillStyle = '#f1f1ec';
        ctx.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 26; i++) {
          const x = random(`spl-x${i}`) * 512;
          const y = random(`spl-y${i}`) * 512;
          const r = 2 + random(`spl-r${i}`) * 9;
          ctx.fillStyle = `rgba(120,124,128,${0.18 + random(`spl-a${i}`) * 0.3})`;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          for (let j = 0; j < 6; j++) {
            const a = random(`spl-d${i}-${j}`) * Math.PI * 2;
            const d = r * (1.2 + random(`spl-l${i}-${j}`) * 1.6);
            ctx.beginPath();
            ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.18, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }),
    [],
  );
  return { ...pbr, map, metalness: 0.15, roughness: 0.75, normalScale: new THREE.Vector2(0.3, 0.3) };
};

const SteelBracket: React.FC = () => {
  const galv = useGalvanized();
  return (
    <group position={[0, cm(11), cm(0.5)]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[cm(16), cm(10), cm(6)]} />
        <meshStandardMaterial {...galv} />
      </mesh>
      {[-4.5, 4.5].map((x) => (
        <mesh key={x} position={[cm(x), 0, cm(3.1)]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[cm(1.1), cm(1.1), cm(0.6), 6]} />
          <meshStandardMaterial color="#5b6066" metalness={0.85} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
};

export const SteelPopper: React.FC = () => {
  const paint = usePaintedSteel();
  const plate = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(cm(-7), cm(14));
    s.lineTo(Math.cos(-0.64 * Math.PI) * cm(15), cm(84) + Math.sin(-0.64 * Math.PI) * cm(15));
    s.absarc(0, cm(84), cm(15), -0.64 * Math.PI, -0.36 * Math.PI, true);
    s.lineTo(cm(7), cm(14));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: cm(0.8), bevelEnabled: true, bevelSize: cm(0.15), bevelThickness: cm(0.15), bevelSegments: 2, curveSegments: 48 });
    g.translate(0, 0, -cm(0.4));
    return boxUV(g);
  }, []);
  return (
    <group>
      <ContactShadow rx={26} />
      <MetalBase half={20} />
      <SteelBracket />
      <mesh geometry={plate} castShadow receiveShadow>
        <meshStandardMaterial {...paint} />
      </mesh>
    </group>
  );
};

// ------------------------------------------------------------------ mesh wall

const WALL_H = 185;
const MESH_B = 10;
const MESH_T = 180;

/** Orange plastic barrier mesh: rounded openings, slightly irregular strands. */
const useMeshTexture = (wCm: number, hCm: number) =>
  useMemo(() => {
    const k = 12; // px per cm
    const W = Math.round(wCm * k);
    const H = Math.round(hCm * k);
    const cellW = 6;
    const cellH = 5;
    return canvasTexture(W, H, (ctx) => {
      ctx.fillStyle = '#ff3d08';
      ctx.fillRect(0, 0, W, H);
      // strands are not perfectly uniform: faint streaks along the extrusion direction
      for (let i = 0; i < 420; i++) {
        ctx.fillStyle = random(`mt${i}`) > 0.5 ? 'rgba(255,150,80,0.12)' : 'rgba(150,35,0,0.12)';
        ctx.fillRect(random(`mx${i}`) * W, 0, 1 + random(`mw${i}`) * 5, H);
      }
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = 'rgba(60,30,10,0.10)';
        ctx.fillRect(0, random(`my${i}`) * H, W, 1 + random(`mh${i}`) * 3);
      }
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      const cols = Math.ceil(wCm / cellW) + 1;
      const rows = Math.ceil(hCm / cellH) + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const u = (c * cellW) / wCm;
          // the mesh sags a little between the zip ties and waves slightly
          const sag = Math.sin(u * Math.PI) * 0.9 + Math.sin(u * 9 + r * 0.15) * 0.18;
          const jx = (random(`mjx${r}-${c}`) - 0.5) * 0.3;
          const jy = (random(`mjy${r}-${c}`) - 0.5) * 0.25;
          const ow = 4.7 + (random(`mow${r}-${c}`) - 0.5) * 0.4;
          const oh = 3.4 + (random(`moh${r}-${c}`) - 0.5) * 0.3;
          const cx = (c * cellW + cellW / 2 + jx) * k;
          const cy = (r * cellH + cellH / 2 + jy + sag) * k;
          ctx.beginPath();
          ctx.ellipse(cx, cy, (ow / 2) * k, (oh / 2) * k, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // darker knots where strands cross
      ctx.globalCompositeOperation = 'source-atop';
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const u = (c * cellW) / wCm;
          const sag = Math.sin(u * Math.PI) * 0.9;
          ctx.fillStyle = 'rgba(120,30,0,0.28)';
          ctx.beginPath();
          ctx.ellipse(c * cellW * k, (r * cellH + sag) * k, 0.9 * k, 0.8 * k, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }, [wCm, hCm]);

const Foot: React.FC<{ x: number }> = ({ x }) => {
  const coat = usePowderCoat();
  return (
    <group position={[cm(x), 0, 0]}>
      <mesh position={[0, cm(2), 0]} castShadow receiveShadow>
        <boxGeometry args={[cm(30), cm(4), cm(30)]} />
        <meshStandardMaterial {...coat} />
      </mesh>
      <mesh position={[0, cm(12), 0]} castShadow receiveShadow>
        <boxGeometry args={[cm(14), cm(16), cm(14)]} />
        <meshStandardMaterial {...coat} />
      </mesh>
    </group>
  );
};

const Post: React.FC<{ x: number }> = ({ x }) => {
  const pine = usePine(1.6);
  return (
    <mesh position={[cm(x), cm(WALL_H / 2), 0]} castShadow receiveShadow>
      <boxGeometry args={[cm(9), cm(WALL_H), cm(9)]} />
      <meshStandardMaterial {...pine} />
    </mesh>
  );
};

export const MeshWall: React.FC<{ width?: number }> = ({ width = 180 }) => {
  const half = width / 2;
  const meshH = MESH_T - MESH_B;
  const mesh = useMeshTexture(width, meshH);
  return (
    <group>
      <ContactShadow rx={half + 14} />
      <mesh position={[0, cm(MESH_B + meshH / 2), cm(5)]} castShadow receiveShadow>
        <planeGeometry args={[cm(width), cm(meshH)]} />
        <meshStandardMaterial map={mesh} alphaTest={0.5} side={THREE.DoubleSide} roughness={0.5} metalness={0} emissive="#ff2a00" emissiveIntensity={0.12} />
      </mesh>
      {/* zip ties holding the mesh to the posts */}
      {[-1, 1].flatMap((s) =>
        Array.from({ length: 6 }, (_, i) => (
          <mesh key={`${s}${i}`} position={[cm(s * (half - 4.5)), cm(MESH_B + 8 + i * 30.5), cm(5.2)]}>
            <boxGeometry args={[cm(10), cm(0.5), cm(0.4)]} />
            <meshStandardMaterial color="#101010" roughness={0.5} />
          </mesh>
        )),
      )}
      <Post x={-half} />
      <Post x={half} />
      <Foot x={-half} />
      <Foot x={half} />
    </group>
  );
};
