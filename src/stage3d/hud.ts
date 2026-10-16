/**
 * HUD of the 3D player, drawn on a 2D canvas — so it is part of the rendered
 * MP4, not just an HTML layer. Same range commands and FORTH TRACE look as
 * the classic player (PlayerOverlay / styles.css), sized relative to the
 * frame height so 1080p, 1440p and 4K look identical.
 */
import type { FrameState } from './timeline';
import type { Stage3D } from './types';
import { alongPath, legPath } from './timeline';

const C = {
  text: '#edede6',
  muted: '#949888',
  sage: '#a3a398',
  accent: '#ff3131',
  standby: '#f5b700',
  go: '#2bd96b',
  card: 'rgba(15, 16, 16, 0.86)',
  line: 'rgba(237, 237, 230, 0.12)',
};
const FONT = 'Montserrat, ui-sans-serif, system-ui, sans-serif';

/** Range commands: "Are you ready?" shows this long before STANDBY (as in the classic player). */
const ASK_SECONDS = 1.6;

/**
 * Size unit of the HUD and the screens: 1 % of the frame height — for 16:9 and wider. A
 * narrow frame (9:16 shorts) is limited by its width instead, so cards and texts still fit
 * across (layout stays anchored to the edges and the centre).
 */
export const hudUnit = (W: number, H: number) => Math.min(H / 100, W / 110);

type Project = (x: number, y: number, d: number) => { x: number; y: number } | null;

const font = (ctx: CanvasRenderingContext2D, weight: number, px: number) => (ctx.font = `${weight} ${px}px ${FONT}`);

/** Letter-spaced text (canvas letterSpacing where supported). */
const spaced = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacingPx: number) => {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) {
    c.letterSpacing = `${spacingPx}px`;
    ctx.fillText(text, x + (ctx.textAlign === 'center' ? spacingPx / 2 : 0), y);
    c.letterSpacing = '0px';
  } else ctx.fillText(text, x, y);
};

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

/** Centre card: small line above, big command, red rule below — and a countdown under it. */
const commandCard = (ctx: CanvasRenderingContext2D, W: number, H: number, small: string, big: string, color: string, rule = C.accent, alpha = 1, count?: string) => {
  const u = hudUnit(W, H);
  ctx.save();
  ctx.globalAlpha = alpha;
  font(ctx, 900, 7.6 * u);
  const bigW = ctx.measureText(big).width + big.length * 0.09 * 7.6 * u;
  const w = Math.max(52 * u, bigW + 12 * u);
  const h = count === undefined ? 17 * u : 27 * u;
  const x = (W - w) / 2;
  const y = (H - h) / 2;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 6 * u;
  ctx.fillStyle = C.card;
  roundRect(ctx, x, y, w, h, 1.4 * u);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = Math.max(1, u * 0.1);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  font(ctx, 600, 1.8 * u);
  ctx.fillStyle = C.sage;
  spaced(ctx, small.toUpperCase(), W / 2, y + 4.6 * u, 0.34 * 1.8 * u);
  font(ctx, 900, 7.6 * u);
  ctx.fillStyle = color;
  spaced(ctx, big.toUpperCase(), W / 2, y + 12 * u, 0.09 * 7.6 * u);
  ctx.fillStyle = rule;
  ctx.fillRect(W / 2 - 3 * u, y + 14 * u, 6 * u, 0.35 * u);
  if (count !== undefined) {
    font(ctx, 900, 8 * u);
    ctx.fillStyle = C.text;
    ctx.fillText(count, W / 2, y + 24 * u);
  }
  ctx.restore();
};

const pill = (ctx: CanvasRenderingContext2D, u: number, text: string, cx: number, cy: number, color: string, alpha: number) => {
  ctx.save();
  ctx.globalAlpha = alpha;
  font(ctx, 800, 1.9 * u);
  const w = ctx.measureText(text).width + text.length * 0.2 * 1.9 * u + 3 * u;
  const h = 3.6 * u;
  ctx.fillStyle = 'rgba(10, 11, 10, 0.82)';
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.18 * u;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  spaced(ctx, text, cx, cy + 0.1 * u, 0.2 * 1.9 * u);
  ctx.restore();
};

export interface HudOptions {
  showTimer: boolean;
}

export const drawHud = (ctx: CanvasRenderingContext2D, W: number, H: number, f: FrameState, s: Stage3D, project: Project, o: HudOptions) => {
  const u = hudUnit(W, H);
  const par = s.legs.reduce((t, l) => t + l.after + l.duration, 0) + s.finalTime;

  // ---------------------------------------------------------------- briefing
  if (f.segment === 'briefing' || f.segment === 'flyin') {
    // during the fly-in everything fades with the arrows
    const fadeOut = f.segment === 'flyin' ? (f.arrows?.[0] ?? 0) : 1;
    const a = f.segment === 'flyin' ? fadeOut : Math.min(1, f.t / 0.8);
    ctx.save();
    // title block, top left
    const grad = ctx.createLinearGradient(0, 0, 0, 27 * u);
    grad.addColorStop(0, 'rgba(8,9,9,0.75)');
    grad.addColorStop(1, 'rgba(8,9,9,0)');
    ctx.globalAlpha = a;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, 27 * u);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    font(ctx, 700, 2 * u);
    ctx.fillStyle = C.accent;
    spaced(ctx, 'STAGE BRIEFING', 4 * u, 6.5 * u, 0.3 * 2 * u);
    font(ctx, 900, 6 * u);
    ctx.fillStyle = C.text;
    ctx.fillText(s.name, 4 * u, 13 * u, W - 8 * u);
    font(ctx, 600, 2.1 * u);
    ctx.fillStyle = C.sage;
    ctx.fillText(`Par ${par.toFixed(1)} s · ${s.repetitions} reps · ${s.positions.length} positions`, 4 * u, 17.5 * u, W - 8 * u);
    if (s.start) {
      // start condition: a strip under the title block
      font(ctx, 700, 1.7 * u);
      ctx.fillStyle = C.accent;
      spaced(ctx, 'START', 4 * u, 22 * u, 0.3 * 1.7 * u);
      const lw = ctx.measureText('START').width + 5 * 0.3 * 1.7 * u;
      font(ctx, 600, 2.1 * u);
      ctx.fillStyle = C.text;
      ctx.fillText(s.start, 4 * u + lw + 1.4 * u, 22 * u, W - 12 * u - lw);
    }
    ctx.restore();
    // labels on the floor: position names, and what happens on each move
    s.positions.forEach((p, i) => {
      const show = i === 0 ? a : Math.min(1, Math.max(0, ((f.arrows?.[i - 1] ?? 0) - 0.85) / 0.15)) * fadeOut;
      const q = project(p.x, 0.05, p.d);
      if (q && show > 0) pill(ctx, u, p.label ?? `P${i + 1}`, q.x * W, q.y * H + 4 * u, i === 0 ? C.go : C.text, show);
    });
    s.legs.forEach((leg, i) => {
      const prog = f.arrows?.[i] ?? 0;
      if (prog < 0.45) return;
      const mid = alongPath(legPath(s, i), 0.5);
      const q = project(mid.x, 0.05, mid.d);
      const text = leg.reload ? `MOVE · RELOAD · ${leg.duration} s` : `MOVE · ${leg.duration} s`;
      if (q) pill(ctx, u, text, q.x * W, q.y * H - 4 * u, leg.reload ? C.standby : C.text, Math.min(1, (prog - 0.45) / 0.2) * fadeOut);
      // when to go: seconds at the previous position
      const from = project(s.positions[i].x, 0.05, s.positions[i].d);
      if (from) pill(ctx, u, `${leg.after} s`, from.x * W, from.y * H + 9 * u, C.sage, Math.min(1, (prog - 0.45) / 0.2) * fadeOut);
    });
  }

  // ---------------------------------------------------------------- stage
  if (f.segment === 'stage' && f.rep) {
    const r = f.rep;
    // top bar: stage name, par and rep
    const grad = ctx.createLinearGradient(0, 0, 0, 14 * u);
    grad.addColorStop(0, 'rgba(8,9,9,0.72)');
    grad.addColorStop(1, 'rgba(8,9,9,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, 14 * u);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    font(ctx, 800, 3.9 * u);
    ctx.fillStyle = C.text;
    // room for PAR / REP on the right
    ctx.fillText(s.name, 3.6 * u, 7.4 * u, W - 34 * u);
    ctx.textAlign = 'right';
    const stat = (label: string, value: string, y: number) => {
      font(ctx, 800, 3.1 * u);
      ctx.fillStyle = C.text;
      ctx.fillText(value, W - 3.6 * u, y);
      const vw = ctx.measureText(value).width;
      font(ctx, 700, 1.7 * u);
      ctx.fillStyle = C.muted;
      spaced(ctx, label, W - 3.6 * u - vw - 1.2 * u, y - 0.4 * u, 0.22 * 1.7 * u);
    };
    stat('PAR', `${par.toFixed(2)} s`, 6.6 * u);
    stat('REP', `${Math.max(1, r.rep)}/${s.repetitions}`, 10.5 * u);

    // signal border
    const afterEnd = r.phase === 'reset' && r.sinceStart < par + 1;
    const border = afterEnd ? C.accent : r.phase === 'active' ? C.go : r.phase === 'standby' ? C.standby : null;
    if (border) {
      ctx.save();
      ctx.strokeStyle = border;
      ctx.lineWidth = 0.6 * u * 2;
      ctx.shadowColor = border;
      ctx.shadowBlur = 5 * u;
      ctx.strokeRect(0, 0, W, H);
      ctx.restore();
    }

    // centre command (same cues as the classic player)
    const cue = afterEnd ? 'time' : (r.phase === 'ready' || r.phase === 'reset') && r.untilStandby <= ASK_SECONDS ? 'ask' : r.phase;
    const rep = `Rep ${Math.max(1, r.rep)} / ${s.repetitions}`;
    // MAKE READY counts down to the first STANDBY (on through "Are you ready?")
    const count = r.phase === 'ready' && Number.isFinite(r.untilStandby) ? String(Math.max(1, Math.ceil(r.untilStandby))) : undefined;
    if (cue === 'ready') commandCard(ctx, W, H, rep, 'Make Ready', C.sage, C.accent, 1, count);
    else if (cue === 'reset') commandCard(ctx, W, H, rep, 'Reset', C.sage);
    else if (cue === 'ask') commandCard(ctx, W, H, rep, 'Are you ready?', C.text, C.accent, 1, count);
    else if (cue === 'standby') commandCard(ctx, W, H, rep, 'Standby', C.standby, C.standby);
    else if (cue === 'time') commandCard(ctx, W, H, rep, 'Time', C.accent);

    // moving + reloading: a small chip at the bottom
    if (r.phase === 'active' && f.shooter && f.shooter.leg >= 0) {
      const p = f.shooter.legProgress;
      const alpha = Math.min(1, p * 6, (1 - p) * 6);
      pill(ctx, u, f.shooter.reloading ? 'MOVE · RELOAD' : 'MOVE', W / 2, H - 10 * u, f.shooter.reloading ? C.standby : C.text, alpha);
    }
    // running time: top right under PAR / REP (stops and turns red at TIME)
    if (o.showTimer && (r.phase === 'active' || afterEnd)) {
      const text = r.elapsed.toFixed(2);
      font(ctx, 800, 5.4 * u);
      const tw = ctx.measureText('00.00').width;
      const bw = Math.max(tw, ctx.measureText(text).width) + 3.6 * u;
      const bh = 7.4 * u;
      const bx = W - 3.6 * u - bw;
      const by = 13 * u;
      ctx.fillStyle = 'rgba(10, 11, 10, 0.82)';
      roundRect(ctx, bx, by, bw, bh, 1.2 * u);
      ctx.fill();
      ctx.strokeStyle = afterEnd ? C.accent : C.go;
      ctx.lineWidth = 0.18 * u;
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = afterEnd ? C.accent : C.text;
      ctx.fillText(text, W - 3.6 * u - 1.8 * u, by + bh / 2 + 0.3 * u);
      ctx.textBaseline = 'alphabetic';
    }
    // par progress bar
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, H - 0.55 * u, W, 0.55 * u);
    ctx.fillStyle = r.phase === 'active' ? C.go : r.parProgress >= 1 ? C.accent : '#5a625b';
    ctx.fillRect(0, H - 0.55 * u, W * r.parProgress, 0.55 * u);
  }

  // ---------------------------------------------------------------- end
  if (f.segment === 'outro') commandCard(ctx, W, H, `${s.name} · ${s.repetitions} reps`, 'Training Complete', C.text);

  // camera fade (start, walk back to the start between reps, end)
  if (f.camera.fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, f.camera.fade)})`;
    ctx.fillRect(0, 0, W, H);
  }
};
