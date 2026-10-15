// 3D assets for the Stage Studio 3D player (see blender/export3d.py).
//   npm run blender3d                 → hall + every object → ../../public/3d
//   npm run blender3d obj:paper_full  → only these jobs
// BAKE_SAMPLES (default 256) sets the Cycles samples of the hall bake (~20 min on an RTX 2060).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BLENDER = process.env.BLENDER ?? 'D:/Tools/blender-5.2.2-windows-x64/blender.exe';
const OUT = resolve('../../public/3d');

// every object the 2D studio knows (registry), except floor markings and banners
const reg = readFileSync('../../src/assets/registry.ts', 'utf8');
const types = [...reg.matchAll(/^\s+(\w+): \{ type: '\w+'/gm)].map((m) => m[1]).filter((t) => t !== 'start_box' && !t.startsWith('banner_'));

const jobs = process.argv.slice(2).length ? process.argv.slice(2) : ['env:indoor_01', ...types.map((t) => `obj:${t}`)];
execFileSync('python', ['blender/textures.py'], { stdio: 'inherit' });
execFileSync(BLENDER, ['-b', '--factory-startup', '--python', 'blender/export3d.py', '--', OUT, ...jobs], {
  stdio: 'inherit',
  env: { ...process.env, BAKE_SAMPLES: process.env.BAKE_SAMPLES ?? '256' },
});
console.log(`3D assets → ${OUT}`);
