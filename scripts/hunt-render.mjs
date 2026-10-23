/**
 * Driven-hunt render service — lets the studio's driven-hunt editor render a scenario in Blender
 * (Cycles) on this PC. Mounted on the Vite dev / preview server, so it only exists while the studio
 * runs locally (`npm run dev`); the GitHub Pages build shows the editor without a render button.
 *
 *   GET  /__hunt/ping              → { ok, blender }  (is Blender where we expect it?)
 *   POST /__hunt/render            { key, scenario, format: '16x9' | '9x16', quality: 'preview' | 'final' }
 *   GET  /__hunt/status            → the current / last job: phase, progress, error
 *   POST /__hunt/cancel
 *   GET  /__hunt/files/<key>/plate.png | crops.json | crops/NNNN.png
 *
 * Pipeline (tools/plate-renderer/blender): the empty lane is rendered once per map, stand, format and quality
 * (hunt.py plate, cached), then only the animals, cropped frame by frame (hunt.py game), then the
 * crops get their feathered edge as alpha (hunt_compose.py rgba). The studio lays them onto the plate.
 * One job at a time (one GPU). An unchanged scenario is not rendered again.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PATH = '/__hunt';
const TOOLS = resolve('tools/plate-renderer');
const OUT = join(TOOLS, 'out', 'hunt', 'studio');
const BLENDER = process.env.BLENDER ?? 'D:/Tools/blender-5.2.2-windows-x64/blender.exe';
const FORMATS = { '16x9': [1920, 1080], '9x16': [1080, 1920] };
// Final: 160 samples + denoiser — plate and animal crops must use the same settings (identical pixels
// outside the animals); more samples hardly show at hunting distances but cost a lot.
const QUALITY = { preview: { scale: 0.5, samples: 64 }, final: { scale: 1, samples: 160 } };
const KINDS = new Set(['keiler', 'bache', 'ueberlaeufer', 'frischling', 'frischling_gestreift']);
const MAPS = JSON.parse(readFileSync(resolve('src/hunt/maps.json'), 'utf8'));
const KEY_RE = /^[\w-]{1,80}$/;
const MAX_BODY = 256 * 1024;

/** Only what Blender needs, checked: a scenario comes from the browser. */
const cleanScenario = (s) => {
  const num = (v, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`value out of range: ${v}`);
    return n;
  };
  if (!s || !Array.isArray(s.crossings) || s.crossings.length > 40) throw new Error('no crossings');
  if (!MAPS[s.map] || ![0, 1, 2].includes(s.stand)) throw new Error('unknown map / stand');
  return {
    map: s.map,
    stand: s.stand,
    duration: num(s.duration, 1, 1800),
    crossings: s.crossings.map((c) => {
      if (!Array.isArray(c.animals) || !c.animals.length || c.animals.length > 16 || !c.animals.every((k) => KINDS.has(k))) throw new Error('bad animals');
      if (!['trot', 'gallop'].includes(c.gait) || !['ltr', 'rtl'].includes(c.direction)) throw new Error('bad gait / direction');
      return { at: num(c.at, 0, 1800), animals: c.animals, gait: c.gait, speed: num(c.speed, 0.5, 15), distance: num(c.distance, 12, 90), direction: c.direction, seed: Math.round(num(c.seed, 0, 1e9)) };
    }),
  };
};

let job = null; // { key, phase, done, total, error, started, finished, proc }

const run = (args, onLine) =>
  new Promise((ok, fail) => {
    const proc = spawn(BLENDER, ['-b', '--factory-startup', '--python', ...args], { cwd: TOOLS });
    job.proc = proc;
    let buf = '';
    const tail = [];
    const feed = (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        tail.push(line);
        if (tail.length > 20) tail.shift();
        onLine?.(line);
      }
    };
    proc.stdout.on('data', feed);
    proc.stderr.on('data', feed);
    proc.on('close', (code) => {
      job.proc = null;
      if (job.cancelled) fail(new Error('cancelled'));
      else if (code === 0 && !tail.some((l) => l.startsWith('Traceback'))) ok();
      else fail(new Error(`Blender exited with ${code}: ${tail.slice(-6).join(' | ')}`));
    });
    proc.on('error', fail);
  });

const startJob = async ({ key, scenario, format, quality }) => {
  const [fw, fh] = FORMATS[format];
  const q = QUALITY[quality];
  const w = Math.round(fw * q.scale);
  const h = Math.round(fh * q.scale);
  const common = [`w=${w}`, `h=${h}`, `samples=${q.samples}`];
  // the empty lane: once per map, stand, format and quality
  const plateDir = join(OUT, 'plates', `${scenario.map}_${scenario.stand + 1}_${format}_${quality}_${q.samples}`);
  common.push(`map=${scenario.map}`, `stand=${scenario.stand}`);
  const dir = join(OUT, 'jobs', `${key}_${format}_${quality}`);
  // a changed hunt.py (gait, animals) must not reuse an older render of the same scenario
  const code = statSync(join(TOOLS, 'blender', 'hunt.py')).mtimeMs;
  const hash = createHash('sha1').update(JSON.stringify([scenario, q, code])).digest('hex').slice(0, 12);
  job = { key: `${key}_${format}_${quality}`, phase: 'plate', done: 0, total: 0, error: null, started: Date.now(), finished: null, width: w, height: h, proc: null, cancelled: false };
  try {
    if (existsSync(join(dir, 'crops.json')) && existsSync(join(dir, 'hash')) && readFileSync(join(dir, 'hash'), 'utf8') === hash) {
      job.phase = 'done';
      job.finished = Date.now();
      return;
    }
    if (!existsSync(join(plateDir, 'plate.png'))) {
      mkdirSync(plateDir, { recursive: true });
      job.total = q.samples;
      await run(['blender/hunt.py', '--', 'plate', plateDir, ...common], (l) => {
        const m = l.match(/Sample (\d+)\/(\d+)/);
        if (m) [job.done, job.total] = [+m[1], +m[2]];
      });
    }
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario));
    copyFileSync(join(plateDir, 'plate.png'), join(dir, 'plate.png'));
    job.phase = 'animals';
    job.done = 0;
    job.total = Math.ceil(scenario.duration * 30) + 1;
    await run(['blender/hunt.py', '--', 'game', dir, ...common, `scenario=${join(dir, 'scenario.json')}`], (l) => {
      const m = l.match(/^(TOTAL|FRAME|EMPTY) (\d+)/);
      if (!m) return;
      if (m[1] === 'TOTAL') job.total = +m[2];
      else job.done = +m[2] + 1;
    });
    job.phase = 'compose';
    job.done = 0;
    await run(['blender/hunt_compose.py', '--', dir, 'rgba'], (l) => {
      const m = l.match(/^COMPOSE (\d+) (\d+)/);
      if (m) [job.done, job.total] = [+m[1], +m[2]];
    });
    writeFileSync(join(dir, 'hash'), hash);
    job.phase = 'done';
  } catch (e) {
    job.phase = job.cancelled ? 'cancelled' : 'error';
    job.error = String(e.message ?? e);
  } finally {
    job.finished = Date.now();
  }
};

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((ok, fail) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new Error('too large'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
  });

const status = () => (job ? { key: job.key, phase: job.phase, done: job.done, total: job.total, error: job.error, width: job.width, height: job.height, seconds: Math.round(((job.finished ?? Date.now()) - job.started) / 1000) } : null);

const middleware = async (req, res, next) => {
  if (!req.url?.startsWith(PATH)) return next();
  const url = new URL(req.url, 'http://x');
  const route = url.pathname.slice(PATH.length);
  try {
    if (route === '/ping') return send(res, 200, { ok: true, blender: existsSync(BLENDER) });
    if (route === '/status') return send(res, 200, { job: status() });
    if (route === '/cancel' && req.method === 'POST') {
      if (job?.proc) {
        job.cancelled = true;
        job.proc.kill();
      }
      return send(res, 200, { ok: true });
    }
    if (route === '/render' && req.method === 'POST') {
      if (job && !job.finished) return send(res, 409, { error: 'Es läuft schon ein Render.' });
      const body = JSON.parse(await readBody(req));
      if (!KEY_RE.test(body.key ?? '') || !FORMATS[body.format] || !QUALITY[body.quality]) return send(res, 400, { error: 'bad request' });
      const scenario = cleanScenario(body.scenario);
      void startJob({ key: body.key, scenario, format: body.format, quality: body.quality });
      return send(res, 202, { job: status() });
    }
    const m = route.match(/^\/files\/([\w-]{1,120})\/(plate\.png|crops\.json|crops\/\d{4,5}\.png)$/);
    if (m && req.method === 'GET') {
      const file = join(OUT, 'jobs', m[1], m[2]);
      if (!existsSync(file)) return send(res, 404, { error: 'not found' });
      res.setHeader('Content-Type', m[2].endsWith('.json') ? 'application/json' : 'image/png');
      res.setHeader('Cache-Control', 'no-cache');
      return createReadStream(file).pipe(res);
    }
    return send(res, 404, { error: 'unknown route' });
  } catch (e) {
    return send(res, 400, { error: String(e.message ?? e) });
  }
};

export const huntRenderPlugin = () => ({
  name: 'hunt-render',
  configureServer(server) {
    server.middlewares.use(middleware);
  },
  configurePreviewServer(server) {
    server.middlewares.use(middleware);
  },
});
