/**
 * Batch render: stage and match videos as MP4 files, without recording — like the explainer
 * shorts of the Shot-Timer project. A headless Chrome opens the studio at #/render and renders
 * every video frame by frame, exactly like the player's "Render MP4" button (same reps, same
 * sound); the file is written to disk while it renders.
 *
 *   npm run render                                  list stages and matches, show the options
 *   npm run render -- match_001                     one match, as 16:9 and as 9:16 short
 *   npm run render -- match_001,stage_101 --format 16x9 --res 4K
 *   npm run render -- matches                       every (not archived) match
 *   npm run render -- stages                        every stage
 *   npm run render -- D:/exports/my_match.json      a match / stage exported from the studio
 *
 * Options: --format both|16x9|9x16 (both) · --res 1080p|1440p|4K (1080p) · --fps 30|60 (60)
 *          --out <folder> (D:/Dryfire-Videos) · --no-voice · --timer
 *
 * Stages and matches you made in the browser live in that browser: export them in the studio
 * (Export JSON) and pass the file.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const RES = { '1080p': 1080, '1440p': 1440, '4K': 2160 };
const res = opt('--res', '1080p');
const fps = Number(opt('--fps', 60));
const format = opt('--format', 'both');
const outDir = resolve(opt('--out', 'D:/Dryfire-Videos'));
const voice = !args.includes('--no-voice');
const showTimer = args.includes('--timer');
if (!RES[res]) throw new Error(`--res must be ${Object.keys(RES).join(' | ')}`);
if (![30, 60].includes(fps)) throw new Error('--fps must be 30 or 60');
if (!['both', '16x9', '9x16'].includes(format)) throw new Error('--format must be both | 16x9 | 9x16');
const valueOf = new Set(['--res', '--fps', '--format', '--out']);
const targets = args.filter((a, i) => !a.startsWith('--') && !valueOf.has(args[i - 1])).flatMap((a) => (a.endsWith('.json') ? [a] : a.split(',').filter(Boolean)));

const h = RES[res];
const FORMATS = [
  ...(format !== '9x16' ? [{ tag: '16x9', width: Math.round((h * 16) / 9), height: h }] : []),
  ...(format !== '16x9' ? [{ tag: '9x16', width: h, height: Math.round((h * 16) / 9) }] : []),
];

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('No Chrome found. Set CHROME_PATH.');

// ------------------------------------------------------------------ dev server + file sink
/** Open output files by key; the page posts chunks with their byte position. */
const files = new Map();
const sink = {
  name: 'render-sink',
  configureServer(server) {
    server.middlewares.use('/__render/write', (req, res) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const fd = files.get(q.get('file'));
      if (fd === undefined) return void ((res.statusCode = 404), res.end());
      const parts = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => {
        const buf = Buffer.concat(parts);
        writeSync(fd, buf, 0, buf.length, Number(q.get('pos')));
        res.end('ok');
      });
    });
  },
};
const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), plugins: [sink], server: { port: 5199, strictPort: false, open: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // the real GPU for WebGL and the video encoder (headless would fall back to software otherwise)
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  protocolTimeout: 0,
});
const done = async (code = 0) => {
  await browser.close().catch(() => {});
  await server.close();
  process.exit(code);
};

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('\npage error:', e.message));
  let progress = () => {};
  await page.exposeFunction('__renderProgress', (d, t) => progress(d, t));
  await page.goto(`${url}#/render`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__dryfire, { timeout: 120_000 });

  // stage files / match bundles from the studio
  const jobs = [];
  for (const t of targets.filter((t) => t.endsWith('.json'))) {
    const r = await page.evaluate((text, name) => window.__dryfire.importJson(text, name), readFileSync(t, 'utf8'), basename(t));
    jobs.push({ kind: r.kind, id: r.id, name: r.name });
  }
  const { stages, matches } = await page.evaluate(() => window.__dryfire.list());

  if (!targets.length) {
    console.log('\nMatches:');
    for (const m of matches) console.log(`  ${m.id.padEnd(24)} ${m.name}${m.archived ? '  (archived)' : ''} · ${m.stages} stages`);
    console.log('\nStages:');
    for (const s of stages) console.log(`  ${s.id.padEnd(24)} ${s.name}`);
    console.log(`
npm run render -- <ids, comma separated | matches | stages | file.json> [options]
  --format both|16x9|9x16   (both)        --res 1080p|1440p|4K   (1080p)
  --fps 30|60               (60)          --out <folder>         (D:/Dryfire-Videos)
  --no-voice                no spoken "Stand by"
  --timer                   running time at the bottom
`);
    await done();
  }

  for (const t of targets.filter((t) => !t.endsWith('.json'))) {
    if (t === 'matches') jobs.push(...matches.filter((m) => !m.archived).map((m) => ({ kind: 'match', id: m.id, name: m.name })));
    else if (t === 'stages') jobs.push(...stages.map((s) => ({ kind: 'stage', id: s.id, name: s.name })));
    else {
      const m = matches.find((x) => x.id === t);
      const s = stages.find((x) => x.id === t);
      if (m) jobs.push({ kind: 'match', id: m.id, name: m.name });
      else if (s) jobs.push({ kind: 'stage', id: s.id, name: s.name });
      else throw new Error(`"${t}" is neither a match nor a stage id (npm run render lists them)`);
    }
  }

  mkdirSync(outDir, { recursive: true });
  const slug = (s) => s.normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'video';
  const total = jobs.length * FORMATS.length;
  let n = 0;
  const started = Date.now();
  for (const job of jobs) {
    for (const f of FORMATS) {
      n++;
      const file = join(outDir, `${slug(job.name)}_${f.tag}_${res}${fps}.mp4`);
      const key = `${n}`;
      files.set(key, openSync(file, 'w'));
      const label = `[${n}/${total}] ${job.name} · ${f.tag === '16x9' ? '16:9' : '9:16'} ${res}${fps}`;
      const t0 = Date.now();
      progress = (d, all) => {
        const pct = all ? d / all : 0;
        const left = pct > 0.02 ? ((Date.now() - t0) / pct - (Date.now() - t0)) / 1000 : NaN;
        process.stdout.write(`\r${label}  ${(pct * 100).toFixed(0).padStart(3)} %${Number.isFinite(left) ? ` · ${Math.floor(left / 60)}:${String(Math.round(left % 60)).padStart(2, '0')} left` : ''}      `);
      };
      try {
        const r = await page.evaluate((j) => window.__dryfire.render(j), { kind: job.kind, id: job.id, width: f.width, height: f.height, fps, voice, showTimer, file: key });
        closeSync(files.get(key));
        files.delete(key);
        const took = (Date.now() - t0) / 1000;
        process.stdout.write(`\r${label}  done in ${took.toFixed(0)} s (${r.seconds.toFixed(0)} s video, ${r.codec}) → ${file}\n`);
      } catch (e) {
        closeSync(files.get(key));
        files.delete(key);
        unlinkSync(file);
        process.stdout.write(`\r${label}  FAILED: ${e.message}\n`);
      }
    }
  }
  console.log(`\n${total} video(s) in ${((Date.now() - started) / 60000).toFixed(1)} min → ${outDir}`);
  await done();
} catch (e) {
  console.error(e.message ?? e);
  await done(1);
}
