/**
 * Full-frame screens of a program, drawn on the HUD canvas (so they are part of the MP4):
 * FORTH TRACE logo, safety, the title card before every stage of a match, and the end.
 * Same look as the studio (Montserrat, accent red, sizes relative to the frame height).
 * Laid out on a 100-unit high block (hudUnit), centred vertically: on a 9:16 short the
 * same screens sit in the middle of the tall frame.
 */
import { MARK_PATH, MARK_VIEWBOX } from '../assets/brand/mark';
import topoUrl from '../assets/brand/topo.svg';
import { ASSETS } from '../assets/registry';
import { drawHud, type HudOptions, hudUnit } from './hud';
import type { ExplainerKind, Program, ProgramFrame } from './program';
import type { Stage3D } from './types';
import { parTime3D, repsOf } from './types';

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
/** Size unit and the top of the 100-unit high block, centred in the frame. */
const block = (W: number, H: number) => {
  const u = hudUnit(W, H);
  return { u, oy: (H - 100 * u) / 2 };
};

/** Fade in over the first 0.6 s of a screen. */
const fadeIn = (local: number) => Math.min(1, local / 0.6);

const background = (ctx: CanvasRenderingContext2D, W: number, H: number, alpha = 1) => {
  ctx.fillStyle = alpha >= 1 ? C.bg : `rgba(5, 6, 5, ${alpha})`;
  ctx.fillRect(0, 0, W, H);
};

const brandScreen = (ctx: CanvasRenderingContext2D, W: number, H: number, local: number) => {
  const { u, oy } = block(W, H);
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
  ctx.translate(0, oy);
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
  const { u, oy } = block(W, H);
  // a tall frame: smaller headline, the rules in one column
  const narrow = W < 150 * u;
  background(ctx, W, H);
  ctx.save();
  ctx.globalAlpha = fadeIn(local);
  ctx.translate(0, oy);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  font(ctx, 700, 2.3 * u);
  ctx.fillStyle = C.accent;
  spaced(ctx, '⚠ SAFETY FIRST', W / 2, 24 * u, 0.22);
  font(ctx, 900, (narrow ? 6.4 : 8.4) * u);
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
  const half = narrow ? 46 * u : 70 * u;
  ctx.fillRect(W / 2 - half, 55 * u, 2 * half, Math.max(1, 0.1 * u));
  SAFETY_RULES.forEach((r, i) => {
    const x = narrow ? W / 2 - half : W / 2 + (i % 2 === 0 ? -70 * u : 4 * u);
    const y = narrow ? 63 * u + i * 6 * u : 63 * u + Math.floor(i / 2) * 6 * u;
    font(ctx, 800, 2.5 * u);
    ctx.fillStyle = C.faint;
    ctx.fillText(`0${i + 1}`, x, y);
    font(ctx, 500, 2.5 * u);
    ctx.fillStyle = C.text;
    ctx.fillText(r, x + 4.5 * u, y, narrow ? 2 * half - 4.5 * u : 61 * u);
  });
  ctx.restore();
};

// ------------------------------------------------------------------ "how it works"

const ease = (x: number) => 1 - (1 - Math.max(0, Math.min(1, x))) ** 3;
/** 0..1 over half a second from t0. */
const appear = (local: number, t0: number) => ease((local - t0) / 0.5);

const EXPLAINER: Record<ExplainerKind, { label: string; title: string; steps: (n: number) => [string, string][] }> = {
  benchmark: {
    label: 'BENCHMARK',
    title: 'How the benchmark works',
    steps: (n) => [
      ['Every drill is a ladder', `${n} levels – the par time gets shorter every level.`],
      ['Make the par twice', 'Two clean reps inside the par and you move up a level.'],
      ["Miss it? That's your level", 'Keep going for practice – your score is the last level you made.'],
      ['Post your level', 'Tell us in the comments – and beat it next week.'],
    ],
  },
  dryfire: {
    label: 'HOW IT WORKS',
    title: 'Your room is the range',
    steps: () => [
      ['The screen is your stage', 'Put the TV in front of a safe backstop – it shows the targets, the commands and the time.'],
      ['But only part of it', 'Tape paper targets to the walls left and right and engage them too.'],
      ['Move like on the range', 'Step to the positions, reload on the move, use doorways as ports.'],
      ['Unloaded. Always.', 'No live ammunition in the room – check before every session.'],
    ],
  },
};

/** Benchmark graphic: the ladder's bars step down; a marker climbs, misses one level and shows the score. */
const ladderGraphic = (ctx: CanvasRenderingContext2D, u: number, gx: number, gy: number, gw: number, gh: number, local: number, pars: number[]) => {
  const n = pars.length;
  const gap = 1.2 * u;
  const bw = (gw - gap * (n - 1)) / n;
  const base = gy + gh;
  const top = gy + 9 * u;
  const max = pars[0];
  const min = Math.min(...pars);
  // the climb: one level per 1.1 s from 7.5 s, it fails at `miss` and stops at the level before
  const miss = Math.max(1, Math.min(n, n - 1));
  const climb = Math.min(miss, Math.floor((local - 7.5) / 1.1) + 1);
  const failed = local >= 7.5 + (miss - 1) * 1.1 + 0.7;
  ctx.textAlign = 'center';
  pars.forEach((p, i) => {
    const a = appear(local, 1 + i * 0.18);
    if (a <= 0) return;
    // shorter par = shorter bar, but never flat
    const h = (base - top) * (0.35 + 0.65 * (max === min ? 1 : (p - min) / (max - min))) * a;
    const x = gx + i * (bw + gap);
    const made = climb > i + 1 || (climb === i + 1 && i + 1 < miss);
    const now = climb === i + 1;
    ctx.globalAlpha = a;
    ctx.fillStyle = now && failed ? 'rgba(255, 49, 49, 0.18)' : made ? 'rgba(43, 217, 107, 0.22)' : now ? 'rgba(255, 49, 49, 0.3)' : 'rgba(237, 237, 230, 0.08)';
    ctx.fillRect(x, base - h, bw, h);
    ctx.fillStyle = made ? C.go : now ? C.accent : C.faint;
    ctx.fillRect(x, base - h, bw, 0.4 * u);
    font(ctx, 800, Math.min(2.6 * u, bw * 0.3));
    ctx.fillStyle = C.text;
    ctx.fillText(p.toFixed(2), x + bw / 2, base - h - 1.2 * u);
    font(ctx, 700, 1.7 * u);
    ctx.fillStyle = now ? C.accent : C.muted;
    ctx.fillText(`L${i + 1}`, x + bw / 2, base + 3 * u);
    if (now && failed) {
      // missed: a red cross over the bar
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 0.6 * u;
      const cx = x + bw / 2;
      const cy = base - h / 2;
      const r = Math.min(bw, h) * 0.28;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r);
      ctx.lineTo(cx - r, cy + r);
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;
  font(ctx, 700, 1.7 * u);
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'left';
  spaced(ctx, 'PAR TIME PER LEVEL', gx, gy + 2 * u, 0.22);
  // the score
  const sa = appear(local, 7.5 + (miss - 1) * 1.1 + 1.3);
  if (sa > 0 && miss > 1) {
    ctx.globalAlpha = sa;
    font(ctx, 900, 3 * u);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.go;
    ctx.fillText(`YOUR LEVEL: ${miss - 1}`, gx + gw, gy + 2.4 * u);
    ctx.globalAlpha = 1;
  }
};

/** Set-up graphic, seen from above: the screen on the front wall, paper targets on the side walls, the shooter moving. */
const roomGraphic = (ctx: CanvasRenderingContext2D, u: number, gx: number, gy: number, gw: number, gh: number, local: number) => {
  const ra = appear(local, 0.6);
  ctx.globalAlpha = ra;
  ctx.strokeStyle = 'rgba(237, 237, 230, 0.35)';
  ctx.lineWidth = 0.35 * u;
  ctx.strokeRect(gx, gy, gw, gh);
  font(ctx, 700, 1.6 * u);
  ctx.fillStyle = C.faint;
  ctx.textAlign = 'left';
  spaced(ctx, 'YOUR ROOM', gx + 1.2 * u, gy + gh - 1.4 * u, 0.22);
  // the shooter: two boxes, moving between them after 6 s
  const boxY = gy + gh * 0.78;
  const bx0 = gx + gw * 0.36;
  const bx1 = gx + gw * 0.64;
  const k = local < 6.5 ? 0 : (1 - Math.cos(((local - 6.5) / 3) * Math.PI)) / 2;
  const sx = bx0 + (bx1 - bx0) * k;
  const shooterA = appear(local, 5.6);
  // lines of sight: to the screen, then to the paper targets
  const screen = { x: gx + gw / 2, y: gy + 2.4 * u };
  const papers = [
    { x: gx + 1.6 * u, y: gy + gh * 0.32 },
    { x: gx + gw - 1.6 * u, y: gy + gh * 0.32 },
  ];
  const sight = (to: { x: number; y: number }, a: number) => {
    if (a <= 0) return;
    ctx.globalAlpha = a * 0.7;
    ctx.setLineDash([1.2 * u, 1 * u]);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 0.25 * u;
    ctx.beginPath();
    ctx.moveTo(sx, boxY);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  sight(screen, shooterA * appear(local, 6));
  papers.forEach((p, i) => sight(p, shooterA * appear(local, 7 + i * 0.5)));
  // the screen on the front wall
  const sa = appear(local, 1.2);
  ctx.globalAlpha = sa;
  const sw = gw * 0.36;
  ctx.shadowColor = 'rgba(160, 200, 255, 0.6)';
  ctx.shadowBlur = 3 * u * sa;
  ctx.fillStyle = '#cfe0ff';
  ctx.fillRect(screen.x - sw / 2, gy + 0.8 * u, sw, 1.8 * u);
  ctx.shadowBlur = 0;
  font(ctx, 800, 1.7 * u);
  ctx.textAlign = 'center';
  ctx.fillStyle = C.text;
  spaced(ctx, 'SCREEN', screen.x, gy + 6 * u, 0.22);
  // paper targets on the side walls (pop in)
  papers.forEach((p, i) => {
    const a = appear(local, 3.4 + i * 0.35);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    const s = 1 + 0.4 * (1 - a);
    const tw = 1.4 * u * s;
    const th = 5 * u * s;
    ctx.fillStyle = '#c9a26b';
    ctx.fillRect(p.x - tw / 2, p.y - th / 2, tw, th);
    font(ctx, 800, 1.6 * u);
    ctx.fillStyle = '#e6c89a';
    ctx.textAlign = i === 0 ? 'left' : 'right';
    spaced(ctx, 'PAPER', p.x + (i === 0 ? 2.2 : -2.2) * u, p.y + 0.6 * u, 0.22);
  });
  // shooting boxes and the shooter
  ctx.globalAlpha = shooterA;
  ctx.strokeStyle = 'rgba(237, 237, 230, 0.6)';
  ctx.lineWidth = 0.25 * u;
  for (const x of [bx0, bx1]) ctx.strokeRect(x - 2.4 * u, boxY - 2.4 * u, 4.8 * u, 4.8 * u);
  ctx.fillStyle = C.go;
  ctx.beginPath();
  ctx.arc(sx, boxY, 1.3 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
};

/** "How it works" after the safety screen: a graphic and four steps appearing one after the other. */
const explainerScreen = (ctx: CanvasRenderingContext2D, W: number, H: number, local: number, kind: ExplainerKind, stages: Stage3D[]) => {
  const { u, oy } = block(W, H);
  const narrow = W < 150 * u;
  const pars = stages.find((s) => s.ladder?.pars.length)?.ladder?.pars ?? [2, 1.8, 1.6, 1.4, 1.2, 1];
  const ex = EXPLAINER[kind];
  background(ctx, W, H);
  ctx.save();
  ctx.translate(0, oy);
  ctx.textBaseline = 'alphabetic';
  // header
  const ha = appear(local, 0);
  ctx.globalAlpha = ha;
  ctx.textAlign = 'center';
  font(ctx, 700, 2.3 * u);
  ctx.fillStyle = C.accent;
  spaced(ctx, ex.label, W / 2, 14 * u, 0.3);
  font(ctx, 900, (narrow ? 5.6 : 7) * u);
  ctx.fillStyle = C.text;
  ctx.fillText(ex.title, W / 2, 23 * u - (1 - ha) * 2 * u, W * 0.92);
  ctx.globalAlpha = 1;
  // graphic left (on a tall frame: on top), steps right (below)
  const gw = narrow ? Math.min(W - 8 * u, 70 * u) : 70 * u;
  const gh = narrow ? 30 * u : 48 * u;
  const gx = narrow ? (W - gw) / 2 : W / 2 - 76 * u;
  const gy = narrow ? 29 * u : 33 * u;
  if (kind === 'benchmark') ladderGraphic(ctx, u, gx, gy, gw, gh, local, pars);
  else roomGraphic(ctx, u, gx, gy, gw, gh, local);
  const steps = ex.steps(pars.length);
  const sx = narrow ? (W - gw) / 2 : W / 2 + 4 * u;
  const sw = narrow ? gw : 72 * u;
  steps.forEach(([title, text], i) => {
    const a = appear(local, 1.4 + i * 2.2);
    if (a <= 0) return;
    const y = (narrow ? 66 * u + i * 8.5 * u : 36 * u + i * 13 * u) + (1 - a) * 1.5 * u;
    ctx.globalAlpha = a;
    ctx.textAlign = 'left';
    font(ctx, 900, 2.6 * u);
    ctx.fillStyle = C.accent;
    ctx.fillText(`0${i + 1}`, sx, y);
    font(ctx, 800, 3 * u);
    ctx.fillStyle = C.text;
    ctx.fillText(title, sx + 5 * u, y, sw - 5 * u);
    font(ctx, 500, (narrow ? 2 : 2.2) * u);
    ctx.fillStyle = C.muted;
    wrap(ctx, text, sw - 5 * u)
      .slice(0, narrow ? 1 : 2)
      .forEach((l, k) => ctx.fillText(l, sx + 5 * u, y + (3.6 + k * 3) * u));
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
  const { u } = block(W, H);
  background(ctx, W, H);
  ctx.save();
  ctx.globalAlpha = fadeIn(local);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const desc = stage.description ? (font(ctx, 500, 2.8 * u), wrap(ctx, stage.description, W * 0.7).slice(0, 3)) : [];
  // block height, centred vertically
  const ladder = stage.ladder?.pars.length ? stage.ladder : null;
  const h = (matchName ? 5 * u : 0) + 6 * u + 11 * u + desc.length * 4 * u + (stage.start ? 5 * u : 0) + 20 * u + (ladder ? 13 * u : 0);
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
  const stats: [string, string][] = ladder
    ? [
        ['PAR LADDER', `${ladder.pars[0].toFixed(2)} → ${ladder.pars[ladder.pars.length - 1].toFixed(2)} s`],
        ['LEVELS × REPS', `${ladder.pars.length} × ${ladder.repsPerLevel}`],
        ['TARGETS', String(targets)],
      ]
    : [
        ['PAR TIME', `${parTime3D(stage).toFixed(1)} s`],
        ['REPS', String(repsOf(stage))],
        ['TARGETS', String(targets)],
      ];
  stats.forEach(([label, value], i) => {
    const x = W / 2 + (i - 1) * (ladder ? 28 : 24) * u;
    font(ctx, 700, 1.9 * u);
    ctx.fillStyle = C.muted;
    spaced(ctx, label, x, y + 5.5 * u, 0.22);
    font(ctx, 800, 4.6 * u);
    ctx.fillStyle = C.text;
    ctx.fillText(value, x, y + 11.5 * u);
  });
  // par ladder: one step per level, the last one in red
  if (ladder) {
    const n = ladder.pars.length;
    const gap = 1.4 * u;
    const bw = Math.min(11 * u, (W * 0.86 - gap * (n - 1)) / n);
    const bh = 8.5 * u;
    const x0 = W / 2 - (n * bw + (n - 1) * gap) / 2;
    const by = y + 16 * u;
    ladder.pars.forEach((p, i) => {
      const x = x0 + i * (bw + gap);
      const last = i === n - 1;
      ctx.fillStyle = last ? 'rgba(255, 49, 49, 0.16)' : 'rgba(237, 237, 230, 0.06)';
      ctx.fillRect(x, by, bw, bh);
      ctx.fillStyle = last ? C.accent : C.faint;
      ctx.fillRect(x, by + bh - 0.35 * u, bw, 0.35 * u);
      font(ctx, 700, 1.6 * u);
      ctx.fillStyle = last ? C.accent : C.muted;
      ctx.fillText(`L${i + 1}`, x + bw / 2, by + 3 * u);
      font(ctx, 800, 2.6 * u);
      ctx.fillStyle = C.text;
      ctx.fillText(p.toFixed(2), x + bw / 2, by + 6.6 * u, bw - 0.6 * u);
    });
  }
  ctx.restore();
};

const completeScreen = (ctx: CanvasRenderingContext2D, W: number, H: number, local: number, title: string, detail: string, askLevel = false) => {
  const { u, oy } = block(W, H);
  background(ctx, W, H, Math.min(0.86, local / 0.8));
  ctx.save();
  ctx.globalAlpha = fadeIn(local);
  ctx.translate(0, oy);
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
  if (askLevel) {
    font(ctx, 800, 3.4 * u);
    ctx.fillStyle = C.accent;
    ctx.fillText('Which level did you make? Tell us in the comments.', W / 2, 68 * u, W * 0.9);
  }
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
  if (seg.kind === 'explainer') return explainerScreen(ctx, W, H, pf.local, seg.variant, p.stages);
  if (seg.kind === 'title') return titleScreen(ctx, W, H, pf.local, stage, seg.stageIndex, p.stages.length, p.matchName);
  const reps = p.stages.reduce((n, s) => n + repsOf(s), 0);
  // par ladders: ask for the level reached (the comment prompt of a YouTube video)
  const ladders = p.stages.some((s) => s.ladder?.pars.length);
  if (p.matchName !== undefined) completeScreen(ctx, W, H, pf.local, 'Match Complete', `${p.matchName} · ${p.stages.length} stages · ${reps} reps`, ladders);
  else completeScreen(ctx, W, H, pf.local, 'Training Complete', `${stage.name} · ${repsOf(stage)} reps`, ladders);
};

/** Whether the 3D view is visible under the HUD (title / logo / safety are opaque screens). */
export const showsScene = (pf: ProgramFrame) => pf.segment.kind === 'stage' || pf.segment.kind === 'complete';
