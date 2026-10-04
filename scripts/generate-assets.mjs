// Generates the shared visual asset set (SVG) and the beeps (WAV).
// Run once after changing a design: `npm run assets`. The outputs are
// committed, the app only ever loads the files — nothing is drawn at runtime.
//
// Units inside every SVG are centimetres. The viewBox is centred on x = 0,
// the ground line sits at y = C (content height), plus a 4 cm margin below
// for the contact shadow. registry.ts mirrors these numbers.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets');
const PX = 6; // intrinsic raster pixels per cm — crisp up to 4K
const MARGIN = 4;

const C = {
  cardboardTop: '#D6B27A',
  cardboard: '#C29A60',
  cardboardLine: 'rgba(105,72,34,0.55)',
  noShoot: '#ECECE8',
  steelLight: '#FFFFFF',
  steel: '#EEEFEC',
  steelShade: '#CFD1CC',
  mesh: '#FF5A1A',
  meshDark: '#D9440E',
  woodLight: '#DCAB68',
  wood: '#C4934F',
  woodDark: '#9E7238',
  feet: '#151515',
  feetTop: '#2C2C2C',
  startBox: '#E3262B',
};

// ------------------------------------------------------------------ helpers

const svg = (w, contentH, body, defs = '') => {
  const h = contentH + MARGIN;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-w / 2} 0 ${w} ${h}" width="${Math.round(w * PX)}" height="${Math.round(h * PX)}">
<defs>
<radialGradient id="shadow"><stop offset="0" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<linearGradient id="wood" x1="0" x2="1"><stop offset="0" stop-color="${C.woodLight}"/><stop offset="0.55" stop-color="${C.wood}"/><stop offset="1" stop-color="${C.woodDark}"/></linearGradient>
${defs}
</defs>
${body}
</svg>
`;
};

/** Contact shadow on the ground. */
const shadow = (groundY, rx) => `<ellipse cx="0" cy="${groundY}" rx="${rx}" ry="${Math.max(2, rx * 0.09)}" fill="url(#shadow)"/>`;

/** Closed polygon with rounded corners as SVG path data. */
const rounded = (pts, r) => {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const d1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const d2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const a = [p1[0] + ((p0[0] - p1[0]) * rr) / d1, p1[1] + ((p0[1] - p1[1]) * rr) / d1];
    const b = [p1[0] + ((p2[0] - p1[0]) * rr) / d2, p1[1] + ((p2[1] - p1[1]) * rr) / d2];
    d += `${i === 0 ? 'M' : 'L'}${f(a[0])} ${f(a[1])}Q${f(p1[0])} ${f(p1[1])} ${f(b[0])} ${f(b[1])}`;
  }
  return d + 'Z';
};
const f = (n) => Math.round(n * 100) / 100;

/** Points given as (x, height above ground) → SVG coords for content height H. */
const up = (H, pts) => pts.map(([x, y]) => [x, H - y]);
const shift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);

/** Black steel foot: plate + upright block. */
const foot = (x, groundY, w = 30, blockW = 14, blockH = 16) => `
<rect x="${x - w / 2}" y="${groundY - 4}" width="${w}" height="4" fill="${C.feet}"/>
<rect x="${x - w / 2 + 1.5}" y="${groundY - 5}" width="${w - 3}" height="1.4" fill="${C.feetTop}"/>
<rect x="${x - blockW / 2}" y="${groundY - 4 - blockH}" width="${blockW}" height="${blockH}" fill="${C.feet}"/>
<rect x="${x - blockW / 2}" y="${groundY - 4 - blockH}" width="${blockW}" height="1.6" fill="${C.feetTop}"/>`;

/** Target stand: two wooden laths on small black feet. */
const stand = (H, top, spread) =>
  [-1, 1]
    .map(
      (s) => `
<rect x="${s * spread - 2.2}" y="${H - top}" width="4.4" height="${top}" fill="url(#wood)"/>
<rect x="${s * spread - 5}" y="${H - 5}" width="10" height="5" fill="${C.feet}"/>
<rect x="${s * spread - 4}" y="${H - 5.6}" width="8" height="1.2" fill="${C.feetTop}"/>`,
    )
    .join('');

// ------------------------------------------------------------------ targets

// Octagon target, cm, y up from the card's bottom edge: 46 × 58 cm, corners slightly rounded.
const OCT = [[-11.5, 0], [11.5, 0], [23, 13], [23, 45], [11.5, 58], [-11.5, 58], [-23, 45], [-23, 13]];
const OCT_C = [[-8, 6], [8, 6], [16.5, 15], [16.5, 43], [8, 52], [-8, 52], [-16.5, 43], [-16.5, 15]];
const OCT_A = [[-4.5, 15], [4.5, 15], [7.5, 22], [7.5, 44], [5, 49], [-5, 49], [-7.5, 44], [-7.5, 22]];
const CARD_BOTTOM = 85;

const STEEL_GREY = `<linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B9BEC4"/><stop offset="1" stop-color="#7F858C"/></linearGradient>`;
const ROD = `<linearGradient id="rod" x1="0" x2="1"><stop offset="0" stop-color="#E6C796"/><stop offset="0.6" stop-color="#D3AE74"/><stop offset="1" stop-color="#B18A52"/></linearGradient>`;

/** Grey metal base: two feet pointing at the viewer, a crossbar and two sockets. */
const metalBase = (H, half, sockets = [-12, 12]) => `
<path d="M${-half - 4} ${H}L${-half + 4} ${H}L${-half + 3} ${H - 4}L${-half - 3} ${H - 4}Z" fill="#6E747B"/>
<path d="M${half - 4} ${H}L${half + 4} ${H}L${half + 3} ${H - 4}L${half - 3} ${H - 4}Z" fill="#6E747B"/>
<rect x="${-half}" y="${H - 6.5}" width="${half * 2}" height="3.2" fill="url(#metal)"/>
<rect x="${-half}" y="${H - 6.5}" width="${half * 2}" height="0.7" fill="#D3D7DB"/>
${sockets.map((x) => `<rect x="${x - 3.2}" y="${H - 15}" width="6.4" height="10" fill="url(#metal)"/><rect x="${x - 3.2}" y="${H - 15}" width="6.4" height="0.8" fill="#D9DDE1"/><circle cx="${x + 1.8}" cy="${H - 10}" r="0.8" fill="#5D6268"/>`).join('')}`;

/** Two light wooden rods from the base sockets up behind the card. */
const rods = (H, top, spread) =>
  [-1, 1].map((s) => `<rect x="${s * spread - 1.8}" y="${H - top}" width="3.6" height="${top - 12}" fill="url(#rod)"/>`).join('');

/** Octagon card with embossed zone lines; `white` = no-shoot. */
let clipCount = 0;
const octCard = (H, bottom, scale, white, paint = []) => {
  const tf = (pts) => up(H, shift(pts.map(([x, y]) => [x * scale, y * scale]), bottom));
  const r = 1.6 * scale;
  const line = white ? 'rgba(120,120,112,0.45)' : 'rgba(110,70,25,0.5)';
  const hi = white ? 'rgba(255,255,255,0.9)' : 'rgba(255,225,170,0.45)';
  const zones = [OCT_C, OCT_A].map((z) => rounded(tf(z), 1.2 * scale));
  const emboss = (dy, color) =>
    `<g fill="none" stroke="${color}" stroke-width="${0.45 * scale}" transform="translate(0 ${dy})">${zones.map((d) => `<path d="${d}"/>`).join('')}</g>`;
  return `
<path d="${rounded(tf(OCT), r)}" fill="${white ? '#B9B9B3' : '#8C6233'}" transform="translate(${0.7 * scale} ${0.9 * scale})"/>
<path d="${rounded(tf(OCT), r)}" fill="url(#${white ? 'ns' : 'card'})" stroke="${white ? 'rgba(0,0,0,0.12)' : 'rgba(90,58,22,0.4)'}" stroke-width="${0.3 * scale}"/>
${emboss(0.35 * scale, hi)}${emboss(0, line)}${paint.length ? paintLayer(tf, r, paint) : ''}`;
};

/** Black hard-cover paint on a card: polygons in card coordinates (cm, y up from the card's bottom), clipped to the octagon. */
const paintLayer = (tf, r, polys) => {
  const id = `hc${clipCount++}`;
  return `<clipPath id="${id}"><path d="${rounded(tf(OCT), r)}"/></clipPath>
<g clip-path="url(#${id})">${polys.map((p) => `<path d="M${tf(p).map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z" fill="url(#paint)"/>`).join('')}</g>`;
};

const cardDefs =
  `<linearGradient id="card" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#D7A86A"/><stop offset="1" stop-color="#BF8B4D"/></linearGradient>` +
  `<linearGradient id="ns" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#FAFAF7"/><stop offset="1" stop-color="#E2E2DD"/></linearGradient>` +
  `<linearGradient id="paint" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#2A2622"/><stop offset="1" stop-color="#16130F"/></linearGradient>` +
  STEEL_GREY +
  ROD;

const targetOnStand = (scale, white, paint = []) => {
  const H = CARD_BOTTOM + 58 * scale;
  return svg(
    54,
    H,
    `${shadow(H, 26)}${rods(H, CARD_BOTTOM + 20 * scale, 12 * Math.max(scale, 0.7))}${metalBase(H, 20, [-12, 12].map((x) => x * Math.max(scale, 0.7)))}${octCard(H, CARD_BOTTOM, scale, white, paint)}`,
    cardDefs,
  );
};

// Hard-cover (painted black) variants — the black part may not be scored. Mirror them in the editor for the other side.
const HC = {
  vertical: [[[-30, -5], [-8, -5], [-8, 65], [-30, 65]], [[8, -5], [30, -5], [30, 65], [8, 65]]], // only a centre strip open
  half: [[[-30, -5], [0, -5], [0, 65], [-30, 65]]], // left half painted
  bottom: [[[-30, -5], [30, -5], [30, 29], [-30, 29]]], // lower half painted
  diagonal: [[[-30, -5], [12, -5], [-4, 65], [-30, 65]]], // slanted line, left side painted
};

const paperFull = () => targetOnStand(1, false);

/**
 * Overlapping targets on one stand, each card shifted down by `step` cm:
 * back card on top, front card lowest (e.g. target / no-shoot / target).
 */
const stackOnStand = (layers, step = 13) => {
  const front = 66; // bottom edge of the front card
  const H = front + step * (layers.length - 1) + 58;
  const cards = layers.map((white, i) => octCard(H, front + step * (layers.length - 1 - i), 1, white)).join('');
  return svg(54, H, `${shadow(H, 26)}${rods(H, front + 30, 12)}${metalBase(H, 20)}${cards}`, cardDefs);
};
const paperStack = () => stackOnStand([false, true, false]);
const paperStackDouble = () => stackOnStand([false, false], 16);

/** Swinger: card on a single wooden pole, pivot bracket at the foot (rocks left/right around it). */
const paperSwinger = () => {
  const H = CARD_BOTTOM + 58;
  const pivot = `
<rect x="-14" y="${H - 4}" width="28" height="4" fill="url(#metal)"/>
<rect x="-14" y="${H - 4}" width="28" height="0.8" fill="#D3D7DB"/>
<path d="M-6 ${H - 4}L-4 ${H - 12}L4 ${H - 12}L6 ${H - 4}Z" fill="url(#metal)"/>
<circle cx="0" cy="${H - 8.5}" r="1.6" fill="#5D6268"/>`;
  const pole = `<rect x="-2" y="${H - CARD_BOTTOM - 30}" width="4" height="${CARD_BOTTOM + 22}" fill="url(#rod)"/>`;
  return svg(54, H, `${shadow(H, 16)}${pole}${pivot}${octCard(H, CARD_BOTTOM, 1, false)}`, cardDefs);
};
const paperMini = () => targetOnStand(0.62, false);
const paperHcVertical = () => targetOnStand(1, false, HC.vertical);
const paperHcHalf = () => targetOnStand(1, false, HC.half);
const paperHcBottom = () => targetOnStand(1, false, HC.bottom);
const paperHcDiagonal = () => targetOnStand(1, false, HC.diagonal);
/** Hard-cover cards without stand (place on a box or with an elevation). */
const paperHcCard = (paint) => svg(54, 58, `${shadow(58, 18)}${octCard(58, 0, 1, false, paint)}`, cardDefs);

/** Plate rack: six 20 cm white plates on a black rack (1.6 m wide, beam at ~1 m). */
const plateRack = () => {
  const H = 128;
  const beamY = H - 100;
  const legs = [-62, 62]
    .map(
      (x) => `<rect x="${x - 4}" y="${beamY}" width="8" height="${100 - 4}" fill="url(#rackLeg)"/>
<path d="M${x - 16} ${H}L${x + 16} ${H}L${x + 12} ${H - 4}L${x - 12} ${H - 4}Z" fill="#141414"/>`,
    )
    .join('');
  const beam = `<path d="M-82 ${beamY}L82 ${beamY}L86 ${beamY - 6}L-86 ${beamY - 6}Z" fill="#2A2A2A"/>
<rect x="-82" y="${beamY}" width="164" height="7" fill="#1B1B1B"/>`;
  const plates = Array.from({ length: 6 }, (_, i) => {
    const x = -65 + i * 26;
    return `<rect x="${x - 1.6}" y="${beamY - 14}" width="3.2" height="9" fill="#1B1B1B"/>
<circle cx="${x}" cy="${beamY - 18}" r="10" fill="url(#steel)" stroke="rgba(0,0,0,0.15)" stroke-width="0.35"/>`;
  }).join('');
  return svg(
    180,
    H,
    `${shadow(H, 80)}${legs}${beam}${plates}`,
    steelDefs + `<linearGradient id="rackLeg" x1="0" x2="1"><stop offset="0" stop-color="#2E2E2E"/><stop offset="1" stop-color="#121212"/></linearGradient>`,
  );
};
const noShoot = () => targetOnStand(1, true);

/**
 * Cards without a stand, bottom edge = anchor. Placed with an elevation
 * (on a box, or in front of a target at stand height 0.85 m).
 */
const paperCard = () => svg(54, 58, `${shadow(58, 18)}${octCard(58, 0, 1, false)}`, cardDefs);
const noShootOverlay = () => svg(54, 58, octCard(58, 0, 1, true), cardDefs);

const steelDefs =
  `<linearGradient id="steel" x1="0" x2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.65" stop-color="#F0F1EE"/><stop offset="1" stop-color="#CFD2CD"/></linearGradient>` +
  STEEL_GREY;

/** Steel on a hinge bracket over the grey metal base. */
const steelOnBase = (H, face, post = 0) => `${shadow(H, 26)}
${post ? `<rect x="-2.6" y="${H - 14 - post}" width="5.2" height="${post}" fill="url(#metal)"/>` : ''}
${metalBase(H, 20, [])}
<rect x="-8" y="${H - 16}" width="16" height="10" rx="1" fill="url(#metal)"/>
<rect x="-8" y="${H - 16}" width="16" height="1" fill="#D9DDE1"/>
<circle cx="-4.5" cy="${H - 11}" r="1" fill="#5D6268"/><circle cx="4.5" cy="${H - 11}" r="1" fill="#5D6268"/>
${face}`;

const steelPopper = () => {
  // round head on a tapered body (85 cm above the bracket)
  const H = 14 + 85;
  const head = { cy: H - 14 - 70, r: 15 };
  const a0 = Math.PI * 0.64;
  const a1 = Math.PI * 0.36;
  const p0 = [Math.cos(a0) * head.r, head.cy + Math.sin(a0) * head.r];
  const p1 = [Math.cos(a1) * head.r, head.cy + Math.sin(a1) * head.r];
  const body = `M${f(p0[0])} ${f(p0[1])}A${head.r} ${head.r} 0 1 1 ${f(p1[0])} ${f(p1[1])}L7 ${H - 14}L-7 ${H - 14}Z`;
  return svg(54, H, steelOnBase(H, `<path d="${body}" fill="url(#steel)" stroke="rgba(0,0,0,0.15)" stroke-width="0.35"/>`), steelDefs);
};

const steelPlate = () => {
  // 30 cm round plate on a post
  const H = 14 + 40 + 30;
  return svg(
    54,
    H,
    steelOnBase(H, `<circle cx="0" cy="${H - 14 - 40 - 15}" r="15" fill="url(#steel)" stroke="rgba(0,0,0,0.15)" stroke-width="0.35"/>`, 42),
    steelDefs,
  );
};

// ------------------------------------------------------------------ barriers

const POST = 9;
const WALL_H = 185;
const MESH_B = 10;
const MESH_T = 180;

const meshDefs = `
<pattern id="mesh" width="6" height="5" patternUnits="userSpaceOnUse">
<rect x="0" y="0" width="1.4" height="5" fill="${C.mesh}"/>
<rect x="0" y="0" width="6" height="1.2" fill="${C.mesh}"/>
<rect x="0" y="0" width="1.4" height="1.2" fill="${C.meshDark}"/>
</pattern>`;

const post = (x, H, h = WALL_H) => `<rect x="${x - POST / 2}" y="${H - h}" width="${POST}" height="${h}" fill="url(#wood)"/>`;

const straightWall = (w) => {
  const H = WALL_H;
  const half = w / 2;
  return svg(
    w + 40,
    H,
    `${shadow(H, half + 14)}
<rect x="${-half}" y="${H - MESH_T}" width="${w}" height="${MESH_T - MESH_B}" fill="url(#mesh)"/>
${post(-half, H)}${post(half, H)}${foot(-half, H)}${foot(half, H)}`,
    meshDefs,
  );
};

const windowWall = () => {
  const H = WALL_H;
  const w = 240;
  const half = w / 2;
  const win = { x: -37.5, w: 75, y: H - 160, h: 60 };
  return svg(
    w + 40,
    H,
    `${shadow(H, half + 14)}
<mask id="hole"><rect x="${-half}" y="0" width="${w}" height="${H}" fill="#fff"/><rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" fill="#000"/></mask>
<rect x="${-half}" y="${H - MESH_T}" width="${w}" height="${MESH_T - MESH_B}" fill="url(#mesh)" mask="url(#hole)"/>
<g fill="url(#wood)">
<rect x="${win.x - 5}" y="${win.y - 5}" width="${win.w + 10}" height="5"/>
<rect x="${win.x - 5}" y="${win.y + win.h}" width="${win.w + 10}" height="5"/>
<rect x="${win.x - 5}" y="${win.y}" width="5" height="${win.h}"/>
<rect x="${win.x + win.w}" y="${win.y}" width="5" height="${win.h}"/>
</g>
${post(-half, H)}${post(half, H)}${foot(-half, H)}${foot(half, H)}`,
    meshDefs,
  );
};

/** Diagonal wall: 1.8 m wide, top edge rising from 1.2 m (left) to 1.85 m (right). Mirror it in the editor for the other slope. */
const diagonalWall = () => {
  const H = WALL_H;
  const w = 180;
  const half = w / 2;
  const lowTop = 120; // mesh top at the left post, cm above ground
  const mesh = `M${-half} ${H - MESH_B}L${-half} ${H - lowTop + 5}L${half} ${H - MESH_T}L${half} ${H - MESH_B}Z`;
  return svg(
    w + 40,
    H,
    `${shadow(H, half + 14)}
<clipPath id="slope"><path d="${mesh}"/></clipPath>
<rect x="${-half}" y="${H - MESH_T}" width="${w}" height="${MESH_T - MESH_B}" fill="url(#mesh)" clip-path="url(#slope)"/>
<path d="M${-half} ${H - lowTop + 5}L${half} ${H - MESH_T}" stroke="url(#wood)" stroke-width="5" stroke-linecap="round"/>
${post(-half, H, lowTop + 5)}${post(half, H)}${foot(-half, H)}${foot(half, H)}`,
    meshDefs,
  );
};

/** Wall with a tall, narrow rectangular port (left of centre), 2.0 m wide. */
const portWall = () => {
  const H = WALL_H;
  const w = 200;
  const half = w / 2;
  const port = { x: -42, w: 30, y: H - 165, h: 135 };
  return svg(
    w + 40,
    H,
    `${shadow(H, half + 14)}
<mask id="port"><rect x="${-half}" y="0" width="${w}" height="${H}" fill="#fff"/><rect x="${port.x}" y="${port.y}" width="${port.w}" height="${port.h}" fill="#000"/></mask>
<rect x="${-half}" y="${H - MESH_T}" width="${w}" height="${MESH_T - MESH_B}" fill="url(#mesh)" mask="url(#port)"/>
<g fill="url(#wood)">
<rect x="${port.x - 5}" y="${port.y - 5}" width="${port.w + 10}" height="5"/>
<rect x="${port.x - 5}" y="${port.y + port.h}" width="${port.w + 10}" height="5"/>
<rect x="${port.x - 5}" y="${port.y}" width="5" height="${port.h}"/>
<rect x="${port.x + port.w}" y="${port.y}" width="5" height="${port.h}"/>
</g>
${post(-half, H)}${post(half, H)}${foot(-half, H)}${foot(half, H)}`,
    meshDefs,
  );
};

/** Corner wall: a front panel plus a panel receding to the right (pre-drawn in perspective). */
const cornerWall = () => {
  const H = WALL_H;
  const left = -125;
  const corner = 55;
  const far = 125;
  // receding panel: far post is shorter and its base sits higher (closer to the horizon)
  const farBase = 10;
  const farH = 160;
  const recede = `M${corner} ${H - MESH_T}L${far} ${H - farBase - (MESH_T - 5) * (farH / WALL_H)}L${far} ${H - farBase - MESH_B * (farH / WALL_H)}L${corner} ${H - MESH_B}Z`;
  return svg(
    290,
    H,
    `${shadow(H, 150)}
<rect x="${left}" y="${H - MESH_T}" width="${corner - left}" height="${MESH_T - MESH_B}" fill="url(#mesh)"/>
<path d="${recede}" fill="url(#meshFar)"/>
<rect x="${far - POST * 0.4}" y="${H - farBase - farH}" width="${POST * 0.8}" height="${farH}" fill="url(#wood)"/>
<g transform="translate(${far} ${-farBase}) scale(0.85 1)">${foot(0, H, 26, 12, 14)}</g>
${post(left, H)}${post(corner, H)}${foot(left, H)}${foot(corner, H)}`,
    meshDefs +
      `<pattern id="meshFar" width="4.2" height="4.4" patternUnits="userSpaceOnUse" patternTransform="skewY(-8)">
<rect x="0" y="0" width="1.2" height="4.4" fill="${C.meshDark}"/>
<rect x="0" y="0" width="4.2" height="1.1" fill="${C.meshDark}"/>
</pattern>`,
  );
};

// ------------------------------------------------------------------ other

/** Black box, `w` × 60 × 60 cm, seen from slightly above (front face + foreshortened top). */
const crate = (w = 60) => {
  const H = 72; // 60 cm front face + 12 cm visible top
  const h = w / 2;
  const front = `<rect x="${-h}" y="12" width="${w}" height="60" fill="url(#ply)"/>`;
  const topPath = `M${-h} 12L${-h + 5} 0L${h - 5} 0L${h} 12`;
  const top = `<path d="${topPath}Z" fill="url(#plyTop)"/>`;
  const edges = `<g fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="0.6"><rect x="${-h}" y="12" width="${w}" height="60"/><path d="${topPath}"/></g>`;
  const mids = w > 90 ? `<rect x="-2.5" y="12" width="5" height="60"/>` : '';
  const battens = `<g fill="#1C1C1C"><rect x="${-h}" y="12" width="5" height="60"/><rect x="${h - 5}" y="12" width="5" height="60"/><rect x="${-h + 5}" y="12" width="${w - 10}" height="4"/><rect x="${-h + 5}" y="68" width="${w - 10}" height="4"/>${mids}</g>`;
  return svg(
    w + 16,
    H,
    `${shadow(H, h + 6)}${front}${battens}${top}${edges}`,
    `<linearGradient id="ply" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#2A2B2C"/><stop offset="1" stop-color="#121212"/></linearGradient>` +
      `<linearGradient id="plyTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E2F31"/><stop offset="1" stop-color="#46484B"/></linearGradient>`,
  );
};

// ------------------------------------------------------------------ props: barrels, plywood

const BARREL_DEFS = `<linearGradient id="drum" x1="0" x2="1"><stop offset="0" stop-color="#14508F"/><stop offset="0.35" stop-color="#2F7FD0"/><stop offset="0.55" stop-color="#4A97E2"/><stop offset="1" stop-color="#123F72"/></linearGradient>
<linearGradient id="ply" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="#E2CDA6"/><stop offset="1" stop-color="#CDB487"/></linearGradient>`;

/** One blue plastic drum (58 cm Ø, 90 cm high) drawn at x, standing on the ground line H. */
const drum = (x, H) => {
  const w = 58;
  const h = 90;
  const top = H - h;
  return `<path d="M${x - w / 2} ${top + 4}L${x - w / 2} ${H - 3}Q${x} ${H + 3} ${x + w / 2} ${H - 3}L${x + w / 2} ${top + 4}Z" fill="url(#drum)"/>
<g fill="none" stroke="rgba(10,40,80,0.55)" stroke-width="2.2"><path d="M${x - w / 2} ${top + 30}Q${x} ${top + 35} ${x + w / 2} ${top + 30}"/><path d="M${x - w / 2} ${top + 60}Q${x} ${top + 65} ${x + w / 2} ${top + 60}"/></g>
<ellipse cx="${x}" cy="${top + 4}" rx="${w / 2}" ry="5" fill="#2A6FB8" stroke="#103E6E" stroke-width="1"/>
<ellipse cx="${x}" cy="${top + 4}" rx="${w / 2 - 4}" ry="3.4" fill="#1D5A9C"/>`;
};

/** Plywood sheet with a faint grain. */
const plywood = (x, y, w, h) => {
  const grain = Array.from({ length: Math.round(h / 6) }, (_, i) => `<path d="M${x} ${y + 3 + i * 6}q${w / 3} ${i % 2 ? 1.5 : -1.5} ${w} 0" />`).join('');
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#ply)" stroke="rgba(110,85,50,0.5)" stroke-width="0.8"/>
<g fill="none" stroke="rgba(150,120,80,0.25)" stroke-width="0.6">${grain}</g>`;
};

const barrel = () => svg(80, 95, `${shadow(95, 36)}${drum(0, 95)}`, BARREL_DEFS);

/** Barricade: plywood sheet standing behind three drums (like a VTAC-style barrel wall). */
const barrelBarricade = () => {
  const H = 150;
  return svg(
    220,
    H,
    `${shadow(H, 105)}${plywood(-92, H - 150, 184, 112)}
<rect x="-92" y="${H - 40}" width="184" height="6" fill="#B89C6C"/>
${drum(-62, H)}${drum(0, H)}${drum(62, H)}`,
    BARREL_DEFS,
  );
};

/** Large wooden wall: plywood face on a 2×4 frame, seen slightly from the left (thickness visible), 3 m × 2 m. */
const woodWall = () => {
  const H = 200;
  const w = 300;
  const half = w / 2;
  return svg(
    w + 30,
    H,
    `${shadow(H, half + 10)}
<path d="M${-half - 10} ${H - 2}L${-half - 10} 8L${-half} 0L${-half} ${H}Z" fill="#9C7A47"/>
${plywood(-half, 0, w, H)}
<g fill="#C9A46C" stroke="rgba(110,85,50,0.45)" stroke-width="0.6">
<rect x="${-half}" y="0" width="${w}" height="5"/><rect x="${-half}" y="${H - 5}" width="${w}" height="5"/>
<rect x="${-half}" y="0" width="5" height="${H}"/><rect x="${half - 5}" y="0" width="5" height="${H}"/>
</g>`,
    BARREL_DEFS,
  );
};

const startBox = () => {
  // a 1 × 1 m box on the floor, pre-foreshortened (seen from behind the box)
  const H = 30;
  const frame = `M-50 ${H}L50 ${H}L40 0L-40 0Z`;
  const inner = `M-43 ${H - 4}L43 ${H - 4}L35.5 3.2L-35.5 3.2Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-54 -2 108 ${H + MARGIN + 2}" width="${108 * PX}" height="${(H + MARGIN + 2) * PX}">
<path d="${frame} ${inner}" fill="${C.startBox}" fill-rule="evenodd"/>
<path d="${inner}" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="0.6"/>
</svg>
`;
};

// ------------------------------------------------------------------ audio

const RATE = 48000;
function tones(list, total, gain = 0.6) {
  const n = Math.round(total * RATE);
  const data = new Float32Array(n);
  for (const { freq, start, dur } of list) {
    const s0 = Math.round(start * RATE);
    const len = Math.round(dur * RATE);
    const attack = Math.round(0.002 * RATE);
    const release = Math.round(0.012 * RATE);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const t = i / RATE;
      const env = Math.min(1, i / attack, (len - i) / release);
      const v = Math.sin(2 * Math.PI * freq * t) * 0.85 + Math.sin(2 * Math.PI * freq * 3 * t) * 0.15;
      data[s0 + i] += v * env * gain;
    }
  }
  return data;
}
function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return buf;
}

// ------------------------------------------------------------------ write

const out = (rel, content) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  console.log('wrote', rel);
};

out('targets/paper_full.svg', paperFull());
out('targets/paper_mini.svg', paperMini());
out('targets/no_shoot.svg', noShoot());
out('targets/steel_popper.svg', steelPopper());
out('targets/no_shoot_overlay.svg', noShootOverlay());
out('targets/paper_card.svg', paperCard());
out('targets/paper_hc_vertical.svg', paperHcVertical());
out('targets/paper_hc_half.svg', paperHcHalf());
out('targets/paper_hc_bottom.svg', paperHcBottom());
out('targets/paper_hc_diagonal.svg', paperHcDiagonal());
out('targets/paper_hc_vertical_card.svg', paperHcCard(HC.vertical));
out('targets/paper_hc_half_card.svg', paperHcCard(HC.half));
out('targets/paper_hc_bottom_card.svg', paperHcCard(HC.bottom));
out('targets/paper_hc_diagonal_card.svg', paperHcCard(HC.diagonal));
out('targets/steel_plate_rack.svg', plateRack());
out('targets/paper_stack.svg', paperStack());
out('targets/paper_stack_double.svg', paperStackDouble());
out('targets/paper_swinger.svg', paperSwinger());
out('targets/steel_plate.svg', steelPlate());
out('barriers/mesh_wall.svg', straightWall(180));
out('barriers/mesh_wall_short.svg', straightWall(90));
out('barriers/mesh_wall_window.svg', windowWall());
out('barriers/mesh_wall_diagonal.svg', diagonalWall());
out('barriers/mesh_wall_port.svg', portWall());
out('barriers/mesh_corner.svg', cornerWall());
out('other/start_box.svg', startBox());
out('other/crate.svg', crate(60));
out('other/crate_wide.svg', crate(120));
out('barriers/barrel.svg', barrel());
out('barriers/barrel_barricade.svg', barrelBarricade());
out('barriers/wood_wall.svg', woodWall());
// start: single 2.1 kHz, 400 ms — par: double 1.6 kHz, 2 × 160 ms
out('audio/start_beep.wav', wav(tones([{ freq: 2100, start: 0, dur: 0.4 }], 0.45)));
out('audio/par_beep.wav', wav(tones([{ freq: 1600, start: 0, dur: 0.16 }, { freq: 1600, start: 0.24, dur: 0.16 }], 0.45)));
