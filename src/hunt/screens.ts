/**
 * Canvas screens of a driven-hunt video (part of the MP4, same look as the stage videos: Montserrat,
 * accent red, sized by hudUnit): briefing, the answer card after each crossing, summary.
 */
import { hudUnit } from '../stage3d/hud';
import { MAPS, standView } from './maps';
import { COUNTDOWN, type HuntFrame, type HuntProgram, INTRO_SECONDS, scenarioPlace } from './program';
import { HFOV, describe, judge, leadCm } from './rules';
import { GAITS, GAME_CLASSES, type HuntFormat } from './types';

const C = { bg: '#050605', text: '#edede6', muted: '#949888', faint: '#5a625b', accent: '#ff3131', go: '#2bd96b', card: 'rgba(12, 13, 12, 0.86)', line: 'rgba(237, 237, 230, 0.14)' };
const FONT = 'Montserrat, ui-sans-serif, system-ui, sans-serif';

const font = (ctx: CanvasRenderingContext2D, weight: number, px: number) => (ctx.font = `${weight} ${px}px ${FONT}`);
const spaced = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number) => {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) {
    c.letterSpacing = `${px}px`;
    ctx.fillText(text, x, y);
    c.letterSpacing = '0px';
  } else ctx.fillText(text, x, y);
};
const fade = (local: number, total?: number) => Math.min(1, local / 0.5, total === undefined ? 1 : (total - local) / 0.5);

/** How far to stand from the picture for true angular size: × picture width. */
export const viewDistanceFactor = (format: HuntFormat) => 1 / (2 * Math.tan((HFOV[format] * Math.PI) / 360));

const tick = (ctx: CanvasRenderingContext2D, ok: boolean, x: number, y: number, u: number) => {
  ctx.fillStyle = ok ? C.go : C.accent;
  font(ctx, 800, 2.6 * u);
  ctx.fillText(ok ? '✓' : '✕', x, y);
};

export const drawBriefing = (ctx: CanvasRenderingContext2D, W: number, H: number, p: HuntProgram, format: HuntFormat, local: number) => {
  const u = hudUnit(W, H);
  const tall = H > W * 1.2;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = fade(local);
  const x0 = tall ? 7 * u : W / 2 - 62 * u;
  let y = tall ? H / 2 - 62 * u : H / 2 - 36 * u;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.accent;
  font(ctx, 800, 2 * u);
  spaced(ctx, 'FORTH TRACE · DRÜCKJAGD', x0, y, 0.5 * u);
  y += 7.5 * u;
  ctx.fillStyle = C.text;
  font(ctx, 900, 6 * u);
  ctx.fillText(p.name.toUpperCase(), x0, y, (tall ? 86 : 124) * u);
  y += 4.2 * u;
  ctx.fillStyle = C.muted;
  font(ctx, 600, 2.2 * u);
  const runs = p.scenarios.reduce((n, s) => n + s.crossings.length, 0);
  ctx.fillText(p.isHunt ? `${p.scenarios.length} Szenarien · ${runs} Anläufe` : `${scenarioPlace(p.scenarios[0])} · ${runs} Anläufe`, x0, y, (tall ? 86 : 124) * u);
  y += 3 * u;
  ctx.fillStyle = C.accent;
  ctx.fillRect(x0, y, 10 * u, 0.5 * u);
  y += 7 * u;

  const r = p.release;
  const left: [string, boolean][] = [
    ['Keiler', r.keiler],
    ['Bache (nicht führend)', r.bache],
    ['Überläufer', r.ueberlaeufer],
    ['Frischlinge', r.frischling],
    ['Flüchtiges Wild', r.gallop],
  ];
  const col = (title: string, x: number, yy: number) => {
    ctx.fillStyle = C.muted;
    font(ctx, 800, 1.8 * u);
    spaced(ctx, title, x, yy, 0.4 * u);
    return yy + 4.6 * u;
  };
  let yl = col('FREIGABE', x0, y);
  for (const [label, ok] of left) {
    tick(ctx, ok, x0, yl, u);
    ctx.fillStyle = ok ? C.text : C.muted;
    font(ctx, 600, 2.4 * u);
    ctx.fillText(label, x0 + 4 * u, yl);
    yl += 4 * u;
  }
  ctx.fillStyle = C.text;
  font(ctx, 600, 2.4 * u);
  ctx.fillText(`Schussentfernung max. ${r.maxDistance} m`, x0 + 4 * u, yl);
  yl += 4 * u;
  ctx.fillStyle = C.accent;
  font(ctx, 700, 2.1 * u);
  ctx.fillText('Nie: führende Bache · Leitbache', x0 + 4 * u, yl);

  const x1 = tall ? x0 : x0 + 66 * u;
  let yr = col('SICHERHEIT & ABLAUF', x1, tall ? yl + 9 * u : y);
  const k = viewDistanceFactor(format).toFixed(1).replace('.', ',');
  for (const line of [
    'Waffe entladen: Patronenlager & Magazin prüfen',
    'Nur ins Schussfeld, auf Kugelfang achten',
    'Erst ansprechen, dann mitschwingen, dann Schuss',
    `Abstand zum Bild: ${k} × Bildbreite (Größe 1:1)`,
    'Nach jedem Anlauf: Auflösung mit Freigabe & Vorhalt',
  ]) {
    ctx.fillStyle = C.text;
    font(ctx, 600, 2.3 * u);
    ctx.fillText(line, x1, yr, (tall ? 86 : 58) * u);
    yr += 4 * u;
  }

  // countdown into the drive
  const left_s = INTRO_SECONDS - local;
  if (left_s <= COUNTDOWN) {
    const yy = Math.max(yl, yr) + (tall ? 12 : 9) * u;
    ctx.fillStyle = C.accent;
    font(ctx, 800, 2.2 * u);
    spaced(ctx, 'DAS TREIBEN BEGINNT', x0, yy, 0.5 * u);
    ctx.fillStyle = C.text;
    font(ctx, 900, 7 * u);
    ctx.fillText(String(Math.ceil(left_s)), x0, yy + 8 * u);
  }
  ctx.restore();
};

const card = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, u: number) => {
  ctx.fillStyle = C.card;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 1.2 * u);
  ctx.fill();
  ctx.fillStyle = C.accent;
  ctx.fillRect(x, y, 0.6 * u, h);
};

/** Answer card after a crossing: what it was, released or not (and why), lead. */
export const drawReveal = (ctx: CanvasRenderingContext2D, W: number, H: number, p: HuntProgram, scenario: number, index: number, local: number) => {
  const s = p.scenarios[scenario];
  const c = s.crossings[index];
  const verdicts = judge(c, p.release);
  const u = hudUnit(W, H);
  const rows = verdicts.length;
  const w = Math.min(W - 6 * u, 74 * u);
  const h = (15 + rows * 3.6 + 6) * u;
  const x = (W - w) / 2;
  const y = H - h - 9 * u;
  const total = s.revealSeconds;
  ctx.save();
  ctx.globalAlpha = fade(local, total);
  card(ctx, x, y, w, h, u);
  const px = x + 3.4 * u;
  let yy = y + 5 * u;
  ctx.textAlign = 'left';
  ctx.fillStyle = C.accent;
  font(ctx, 800, 1.7 * u);
  spaced(ctx, `ANLAUF ${index + 1} · ${GAITS[c.gait].label.toUpperCase()} · ${Math.round(c.distance)} M`, px, yy, 0.35 * u);
  yy += 4.6 * u;
  ctx.fillStyle = C.text;
  font(ctx, 800, 3 * u);
  ctx.fillText(describe(c.animals), px, yy, w - 7 * u);
  yy += 5 * u;
  for (const v of verdicts) {
    tick(ctx, v.free, px, yy, u);
    ctx.fillStyle = v.free ? C.text : C.muted;
    font(ctx, 600, 2.2 * u);
    ctx.fillText(`${GAME_CLASSES[v.kind].label}${v.lead ? ' (vorn)' : ''}`, px + 3.6 * u, yy);
    ctx.textAlign = 'right';
    ctx.fillStyle = v.free ? C.go : C.accent;
    font(ctx, 700, 1.9 * u);
    ctx.fillText(v.free ? 'FREI' : v.reason, x + w - 3 * u, yy, w * 0.55);
    ctx.textAlign = 'left';
    yy += 3.6 * u;
  }
  yy += 1.4 * u;
  const free = verdicts.filter((v) => v.free).length;
  ctx.fillStyle = C.muted;
  font(ctx, 600, 1.9 * u);
  ctx.fillText(
    free ? `Vorhalt ≈ ${leadCm(c)} cm vor das Blatt${free > 1 && rows > 1 ? ' · in der Rotte von hinten nach vorn' : ''}` : 'Kein Schuss – richtig war: Waffe unten lassen',
    px,
    yy,
    w - 7 * u,
  );
  ctx.restore();
};

export const drawDriveHud = (ctx: CanvasRenderingContext2D, W: number, H: number, p: HuntProgram, f: Extract<HuntFrame, { phase: 'drive' }>) => {
  const u = hudUnit(W, H);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(237, 237, 230, 0.55)';
  font(ctx, 800, 1.5 * u);
  const s = p.scenarios[f.scenario];
  const label = p.isHunt ? `${p.name} · Szenario ${f.scenario + 1}/${p.scenarios.length}` : p.name;
  spaced(ctx, `DRÜCKJAGD · ${label.toUpperCase()} · ${MAPS[s.map].short.toUpperCase()}`, 3 * u, 4.5 * u, 0.3 * u);
  ctx.restore();
  if (f.reveal) drawReveal(ctx, W, H, p, f.scenario, f.reveal.index, f.reveal.local);
};

/** Title card before each scenario of a hunt: number, map, stand. */
export const drawTitle = (ctx: CanvasRenderingContext2D, W: number, H: number, p: HuntProgram, scenario: number, local: number) => {
  const s = p.scenarios[scenario];
  const u = hudUnit(W, H);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = fade(local, 4);
  const x = W / 2;
  let y = H / 2 - 10 * u;
  ctx.textAlign = 'center';
  ctx.fillStyle = C.accent;
  font(ctx, 800, 2.2 * u);
  spaced(ctx, `SZENARIO ${scenario + 1} / ${p.scenarios.length}`, x, y, 0.5 * u);
  y += 8 * u;
  ctx.fillStyle = C.text;
  font(ctx, 900, 5.6 * u);
  ctx.fillText(s.name.toUpperCase(), x, y, W - 8 * u);
  y += 5.5 * u;
  ctx.fillStyle = C.muted;
  font(ctx, 600, 2.3 * u);
  ctx.fillText(`${MAPS[s.map].label} · ${standView(s.map, s.stand).name}`, x, y, W - 8 * u);
  y += 4 * u;
  ctx.fillText(`${s.crossings.length} Anläufe`, x, y);
  ctx.restore();
};

export const drawSummary = (ctx: CanvasRenderingContext2D, W: number, H: number, p: HuntProgram, local: number) => {
  const u = hudUnit(W, H);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = fade(local);
  // one line per crossing (a single scenario) or per scenario (a hunt)
  const rows: { n: string; text: string; free: number; total: number }[] = p.isHunt
    ? p.scenarios.map((s, i) => {
        const v = s.crossings.flatMap((c) => judge(c, p.release));
        return { n: `${i + 1}`, text: `${s.name} · ${s.crossings.length} Anläufe`, free: v.filter((a) => a.free).length, total: s.crossings.length };
      })
    : p.scenarios[0].crossings.map((c, i) => {
        const v = judge(c, p.release);
        return { n: `${i + 1}`, text: `${describe(c.animals)} · ${GAITS[c.gait].label} · ${Math.round(c.distance)} m`, free: v.filter((a) => a.free).length, total: 1 };
      });
  const w = Math.min(W - 8 * u, 110 * u);
  const x = (W - w) / 2;
  let y = H / 2 - ((rows.length * 4.4 + 16) * u) / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = C.accent;
  font(ctx, 800, 2 * u);
  spaced(ctx, 'HAHN IN RUH · AUFLÖSUNG', x, y, 0.5 * u);
  y += 7 * u;
  ctx.fillStyle = C.text;
  font(ctx, 900, 4.6 * u);
  ctx.fillText(p.name.toUpperCase(), x, y, w);
  y += 6 * u;
  for (const r of rows) {
    ctx.fillStyle = C.muted;
    font(ctx, 700, 2 * u);
    ctx.fillText(r.n, x, y);
    ctx.fillStyle = C.text;
    font(ctx, 600, 2.2 * u);
    ctx.fillText(r.text, x + 4 * u, y, w * 0.62);
    ctx.textAlign = 'right';
    ctx.fillStyle = r.free ? C.go : C.accent;
    font(ctx, 800, 2 * u);
    ctx.fillText(r.free ? `${r.free} × FREI` : 'KEIN SCHUSS', x + w, y);
    ctx.textAlign = 'left';
    y += 4.4 * u;
  }
  ctx.restore();
};
