/**
 * Procedural canvas textures (no image files). All randomness is seeded,
 * so every frame and every render produces identical pixels.
 */
import * as THREE from 'three';
import { random } from 'remotion';

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
};

const finish = (c: HTMLCanvasElement, repeat?: [number, number]) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
};

/** Speckle noise on a base colour. */
const speckle = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: string,
  count: number,
  colors: string[],
  size: [number, number],
) => {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(random(`${seed}c${i}`) * colors.length)];
    ctx.globalAlpha = 0.25 + random(`${seed}a${i}`) * 0.6;
    const s = size[0] + random(`${seed}s${i}`) * (size[1] - size[0]);
    ctx.fillRect(random(`${seed}x${i}`) * w, random(`${seed}y${i}`) * h, s, s);
  }
  ctx.globalAlpha = 1;
};

/** Soft large-scale blotches (stains, damp patches). */
const blotches = (ctx: CanvasRenderingContext2D, w: number, h: number, seed: string, count: number, color: string, alpha: number) => {
  for (let i = 0; i < count; i++) {
    const x = random(`${seed}x${i}`) * w;
    const y = random(`${seed}y${i}`) * h;
    const r = 40 + random(`${seed}r${i}`) * 180;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha * (0.4 + random(`${seed}a${i}`) * 0.6);
    // draw wrapped copies so the texture tiles without seams
    for (const dx of [-w, 0, w])
      for (const dy of [-h, 0, h]) {
        ctx.setTransform(1, 0, 0, 1, dx, dy);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.globalAlpha = 1;
};

// ---------------------------------------------------------------- floors

export const concreteTexture = () => {
  const [c, ctx] = canvas(1024, 1024);
  ctx.fillStyle = '#8B8A86';
  ctx.fillRect(0, 0, 1024, 1024);
  blotches(ctx, 1024, 1024, 'conc-dark', 26, 'rgba(60,58,55,1)', 0.14);
  blotches(ctx, 1024, 1024, 'conc-light', 18, 'rgba(190,188,182,1)', 0.12);
  speckle(ctx, 1024, 1024, 'conc', 9000, ['#6E6D69', '#A3A29D', '#7C7B77'], [1, 2.5]);
  // saw-cut joints every 4 m (texture covers 4 m)
  ctx.strokeStyle = 'rgba(40,40,38,0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 1024, 1024);
  return finish(c, [8, 8]);
};

export const gravelTexture = () => {
  const [c, ctx] = canvas(1024, 1024);
  ctx.fillStyle = '#A39C8E';
  ctx.fillRect(0, 0, 1024, 1024);
  blotches(ctx, 1024, 1024, 'grav-dark', 30, 'rgba(105,98,86,1)', 0.35);
  speckle(ctx, 1024, 1024, 'grav', 22000, ['#7E776B', '#C2BCB0', '#8F887B', '#D6D1C6', '#6A645A'], [1.5, 4.5]);
  return finish(c, [10, 10]);
};

// ---------------------------------------------------------------- walls

export const acousticPanelTexture = () => {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#1C1D1F';
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, 'panel', 9000, ['#26282B', '#141516', '#2E3033'], [1, 2.5]);
  // panel seams (texture covers 2 × 2 m, panels 1 m wide)
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, 4, 512);
  ctx.fillRect(256, 0, 4, 512);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(4, 0, 2, 512);
  ctx.fillRect(260, 0, 2, 512);
  return finish(c);
};

export const bermTexture = () => {
  const [c, ctx] = canvas(1024, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#A9845E');
  g.addColorStop(1, '#8A6646');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  blotches(ctx, 1024, 512, 'berm-dark', 40, 'rgba(70,50,34,1)', 0.45);
  blotches(ctx, 1024, 512, 'berm-light', 20, 'rgba(176,140,104,1)', 0.3);
  speckle(ctx, 1024, 512, 'berm', 14000, ['#5C4330', '#A07E5C', '#7A5A40', '#B89A76'], [1, 3]);
  // sparse grass tufts
  for (let i = 0; i < 260; i++) {
    const x = random(`tuft-x${i}`) * 1024;
    const y = random(`tuft-y${i}`) * 512;
    ctx.strokeStyle = random(`tuft-c${i}`) > 0.5 ? '#5E7A3A' : '#47622C';
    ctx.lineWidth = 1.5;
    for (let b = 0; b < 5; b++) {
      ctx.beginPath();
      ctx.moveTo(x + b * 2, y);
      ctx.lineTo(x + b * 2 + (random(`tuft-d${i}-${b}`) - 0.5) * 10, y - 6 - random(`tuft-h${i}-${b}`) * 10);
      ctx.stroke();
    }
  }
  return finish(c, [3, 1]);
};

export const skyTexture = () => {
  const [c, ctx] = canvas(1024, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#3D7EC9');
  g.addColorStop(0.65, '#86B6E6');
  g.addColorStop(1, '#C9E0F2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  // soft cumulus clouds
  for (let i = 0; i < 9; i++) {
    const cx = random(`cloud-x${i}`) * 1024;
    const cy = 120 + random(`cloud-y${i}`) * 220;
    for (let p = 0; p < 9; p++) {
      const x = cx + (random(`cloud-px${i}-${p}`) - 0.5) * 150;
      const y = cy + (random(`cloud-py${i}-${p}`) - 0.5) * 30;
      const r = 20 + random(`cloud-r${i}-${p}`) * 34;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  return finish(c);
};

export const blockWallTexture = () => {
  // concrete block wall, texture covers 2 × 2 m (blocks 40 × 20 cm)
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#4F5154';
  ctx.fillRect(0, 0, 512, 512);
  blotches(ctx, 512, 512, 'block-dark', 18, 'rgba(40,41,43,1)', 0.25);
  speckle(ctx, 512, 512, 'block', 7000, ['#5C5E61', '#46484B', '#6A6C6F'], [1, 2.5]);
  ctx.strokeStyle = 'rgba(25,26,28,0.7)';
  ctx.lineWidth = 3;
  for (let row = 0; row < 10; row++) {
    const y = row * 51.2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
    for (let col = 0; col < 6; col++) {
      const x = col * 102.4 + (row % 2) * 51.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 51.2);
      ctx.stroke();
    }
  }
  return finish(c);
};

export const rubberTexture = () => {
  // granulated rubber backstop
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, 'rubber', 16000, ['#2A2A2A', '#101010', '#333333'], [1.5, 4]);
  return finish(c, [12, 2]);
};
