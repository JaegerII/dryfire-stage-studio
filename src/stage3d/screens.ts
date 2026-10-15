/**
 * Full-frame screens of a program, drawn on the HUD canvas (so they are part of the MP4):
 * FORTH TRACE logo, safety, the title card before every stage of a match, and the end.
 * Same look as the studio (Montserrat, accent red, sizes relative to the frame height).
 */
import { MARK_PATH, MARK_VIEWBOX } from '../assets/brand/mark';
import topoUrl from '../assets/brand/topo.svg';
import { ASSETS } from '../assets/registry';
import { drawHud, type HudOptions } from './hud';
import type { Program, ProgramFrame } from './program';
import type { Stage3D } from './types';
import { parTime3D } from './types';

const C = { bg: '#050605', text: '#edede6', muted: '#949888', faint: '#5a625b', sage: '#a3a398', accent: '#ff3131', go: '#2bd96b', line: 'rgba(237, 237, 230, 0.12)' };
const FONT = 'Montserrat, ui-sans-serif, system-ui, sans-serif';

export const SAFETY_RULES = [
  'Remove all live ammunition from the room.',
  'Check chamber and magazine — visually and physically.',
  'Aim only at a safe backstop.',
  'Never load the firearm during a dry-fire session.',
];

let topo: HTMLImageElement | null = null;
/** The logo screen's topo pattern: load once before drawing (player / render). */
export const loadScreenAssets = () =>
  new Promise<void>((resolve) => {
    if (topo?.complete) return resolve();
    topo = new Image();
    topo.onload = () => resolve();
    topo.onerror = () => resolve();
    topo.src = topoUrl;
  });

const font = (ctx: CanvasRenderingContext2D, weight: number, px: number) => (ctx.font = `${weight} ${px}px ${FONT}`);
const spaced = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, em: number) => {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  const px = parseFloat(ctx.font.split(' ')[1]) * em;
  if ('letterSpacing' in c) {
    c.letterSpacing = `${px}px`;
    ctx.fillText(text, x + (ctx.textAlign === 'center' ? px / 2 : 0), y);
    c.letterSpacing = '0px';
  } else ctx.fillText(text, x, y);
};
/** Fade in over the first 0.6 s of a screen. */
const fadeIn = (local: number) => Math.min(1, local / 0.6);

const background = (ctx: CanvasRenderingContext2D, W: number, H: number, alpha = 1) => {
  ctx.fillStyle = alpha >= 1 ? C.bg : `rgba(5, 6, 5, ${alpha})`;
  ctx.fillRect(0, 0, W, H);
};

const brandScreen = (ctx: CanvasRenderingContext2D, W: number, H: number, local: number) => {
  const u = H / 100;
  background(ctx, W, H);
  ctx.save();
  ctx.globalAlpha = fadeIn(local);
  if (topo?.complete && topo.naturalWidth) {
    // topo lines, brightened, tiled at 70 % of the frame height
    const size = 70 * u;
    ctx.filter = 'brightness(2.6)';
    for (let y = 0; y < H; y += size) for (let x = 0; x < W; x += size * (topo.naturalWidth / topo.naturalHeight)) ctx.drawImage(topo, x, y, size * (topo.naturalWidth / topo.naturalHeight), size);
    ctx.filter = 'none';
  }
  const v = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 55 * u);
  v.addColorStop(0, 'rgba(5,6,5,0.9)');
  v.addColorStop(1, 'rgba(5,6,5,0)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  // mark
  const [, , vw, vh] = MARK_VIEWBOX.split(' ').map(Number);
  const mh = 21 * u;
  const s = mh / vh;
  ctx.save();
  ctx.translate(W / 2 - (vw * s) / 2, 20 * u);
  ctx.scale(s, s);
  ctx.fillStyle = C.text;
  ctx.fill(new Path2D(MARK_PATH), 'evenodd');
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  font(ctx, 900, 9.6 * u);
  ctx.fillStyle = C.text;
  spaced(ctx, 'FORTH TRACE', W / 2, 20 * u + mh + 4.8 * u + 8 * u, 0.09);
  ctx.fillStyle = C.accent;
  ctx.fillRect(W / 2 - 3 * u, 64 * u, 6 * u, 0.3 * u);
  font(ctx, 600, 2.8 * u);
  ctx.fillStyle = C.sage;
  spaced(ctx, 'VIRTUAL DRYFIRE TRAINER', W / 2, 71 * u, 0.34);
  ctx.restore();
};

const safetyScreen = (ctx: CanvasRenderingContext2D, W: number, H: number, local: number) => {
  const u = H / 100;
  background(ctx, W, H);
  ctx.save();
  ctx.globalAlpha = fadeIn(local);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  font(ctx, 700, 2.3 * u);
  ctx.fillStyle = C.accent;
  spaced(ctx, '⚠ SAFETY FIRST', W / 2, 24 * u, 0.22);
  font(ctx, 900, 8.4 * u);
  ctx.fillStyle = C.text;
  ctx.fillText('Your firearm must be', W / 2, 37 * u);
  // "unloaded" in red, the rest white, centred as one line
  const a = 'unloaded';
  const b = ' at all times.';
  const wa = ctx.measureText(a).width;
  const wb = ctx.measureText(b).width;
  ctx.textAlign = 'left';
  ctx.fillStyle = C.accent;
  ctx.fillText(a, W / 2 - (wa + wb) / 2, 46.5 * u);
  ctx.fillStyle = C.text;
  ctx.fillText(b, W / 2 - (wa + wb) / 2 + wa, 46.5 * u);
  // rules: two columns under a hairline
  ctx.fillStyle = C.line;
  ctx.fillRect(W / 2 - 70 * u, 55 * u, 140 * u, Math.max(1, 0.1 * u));
  SAFETY_RULES.forEach((r, i) => {
    const x = W / 2 + (i % 2 === 0 ? -70 * u : 4 * u);
    const y = 63 * u + Math.floor(i / 2) * 6 * u;
    font(ctx, 800, 2.5 * u);
    ctx.fillStyle = C.faint;
    ctx.fillText(`0${i + 1}`, x, y);
    font(ctx, 500, 2.5 * u);
    ctx.fillStyle = C.text;
    ctx.fillText(r, x + 4.5 * u, y, 61 * u);
  });
  ctx.restore();
};

/** Wraps text into lines no wider than maxW. */
const wrap = (ctx: CanvasRenderingContext2D, text: string, maxW: number) => {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
};

const titleScreen = (ctx: CanvasRenderingContext2D, W: number, H: number, local: number, stage: Stage3D, index: number, count: number, matchName?: string) => {
  const u = H / 100;
  background(ctx, W, H);
  ctx.save();
  ctx.globalAlpha = fadeIn(local);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const desc = stage.description ? (font(ctx, 500, 2.8 * u), wrap(ctx, stage.description, W * 0.7).slice(0, 3)) : [];
  // block height, centred vertically
  const h = (matchName ? 5 * u : 0) + 6 * u + 11 * u + desc.length * 4 * u + (stage.start ? 5 * u : 0) + 20 * u;
  let y = (H - h) / 2;
  if (matchName) {
    font(ctx, 700, 2.3 * u);
    ctx.fillStyle = C.muted;
    spaced(ctx, matchName.toUpperCase(), W / 2, (y += 3 * u), 0.22);
    y += 2 * u;
  }
  font(ctx, 800, 4 * u);
  const idx = `STAGE ${index + 1}`;
  const of = ` / ${count}`;
  const wi = ctx.measureText(idx).width + idx.length * 0.3 * 4 * u;
  const wo = ctx.measureText(of).width + of.length * 0.3 * 4 * u;
  ctx.textAlign = 'left';
  ctx.fillStyle = C.accent;
  spaced(ctx, idx, W / 2 - (wi + wo) / 2, (y += 6 * u), 0.3);
  ctx.fillStyle = C.faint;
  spaced(ctx, of, W / 2 - (wi + wo) / 2 + wi, y, 0.3);
  ctx.textAlign = 'center';
  font(ctx, 900, 9 * u);
  ctx.fillStyle = C.text;
  ctx.fillText(stage.name, W / 2, (y += 11 * u), W * 0.9);
  font(ctx, 500, 2.8 * u);
  ctx.fillStyle = C.muted;
  for (const l of desc) ctx.fillText(l, W / 2, (y += 4 * u));
  if (stage.start) {
    font(ctx, 700, 2.6 * u);
    ctx.fillStyle = C.accent;
    ctx.fillText(`START · ${stage.start}`, W / 2, (y += 5 * u), W * 0.85);
  }
  // stats under a hairline
  y += 5 * u;
  ctx.fillStyle = C.line;
  ctx.fillRect(W / 2 - 34 * u, y, 68 * u, Math.max(1, 0.1 * u));
  const targets = stage.objects.filter((o) => ASSETS[o.type]?.scoring).length;
  const stats: [string, string][] = [
    ['PAR TIME', `${parTime3D(stage).toFixed(1)} s`],
    ['REPS', String(stage.repetitions)],
    ['TARGETS', String(targets)],
  ];
  stats.forEach(([label, value], i) => {
    const x = W / 2 + (i - 1) * 24 * u;
    font(ctx, 700, 1.9 * u);
    ctx.fillStyle = C.muted;
    spaced(ctx, label, x, y + 5.5 * u, 0.22);
    font(ctx, 800, 4.6 * u);
    ctx.fillStyle = C.text;
    ctx.fillText(value, x, y + 11.5 * u);
  });
  ctx.restore();
};

const completeScreen = (ctx: CanvasRenderingContext2D, W: number, H: number, local: number, title: string, detail: string) => {
  const u = H / 100;
  background(ctx, W, H, Math.min(0.86, local / 0.8));
  ctx.save();
  ctx.globalAlpha = fadeIn(local);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  font(ctx, 700, 2.3 * u);
  ctx.fillStyle = C.go;
  spaced(ctx, 'SESSION ENDED', W / 2, 40 * u, 0.22);
  font(ctx, 900, 8.4 * u);
  ctx.fillStyle = C.text;
  ctx.fillText(title, W / 2, 52 * u, W * 0.9);
  font(ctx, 500, 3 * u);
  ctx.fillStyle = C.muted;
  ctx.fillText(detail, W / 2, 59 * u, W * 0.9);
  ctx.restore();
};

/** HUD of a program frame: the stage HUD during a run, a full-frame screen otherwise. */
export const drawProgramHud = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  p: Program,
  pf: ProgramFrame,
  project: (x: number, y: number, d: number) => { x: number; y: number } | null,
  o: HudOptions,
) => {
  const seg = pf.segment;
  const stage = p.stages[pf.stageIndex];
  if (seg.kind === 'stage' && pf.frame) return drawHud(ctx, W, H, pf.frame, stage, project, o);
  if (seg.kind === 'brand') return brandScreen(ctx, W, H, pf.local);
  if (seg.kind === 'safety') return safetyScreen(ctx, W, H, pf.local);
  if (seg.kind === 'title') return titleScreen(ctx, W, H, pf.local, stage, seg.stageIndex, p.stages.length, p.matchName);
  const reps = p.stages.reduce((n, s) => n + s.repetitions, 0);
  if (p.matchName !== undefined) completeScreen(ctx, W, H, pf.local, 'Match Complete', `${p.matchName} · ${p.stages.length} stages · ${reps} reps`);
  else completeScreen(ctx, W, H, pf.local, 'Training Complete', `${stage.name} · ${stage.repetitions} reps`);
};

/** Whether the 3D view is visible under the HUD (title / logo / safety are opaque screens). */
export const showsScene = (pf: ProgramFrame) => pf.segment.kind === 'stage' || pf.segment.kind === 'complete';
