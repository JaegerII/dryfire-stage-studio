import { useEffect, useRef, useState } from 'react';
import { HuntRenderAborted, renderHuntMp4 } from './exportHunt';
import type { HuntProgram } from './program';
import { HuntFrames, type RenderJob, type RenderQuality, cancelRender, jobKey, pingService, renderStatus, startRender } from './renderService';
import { renderScenario } from './repository';
import type { HuntFormat, HuntScenario } from './types';
import { downloadBlob } from '../utils/recorder';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const finished = (j: RenderJob | null) => !j || ['done', 'error', 'cancelled'].includes(j.phase);

/**
 * Blender renders of one or more scenarios through the local render service: loads what is already on
 * disk, renders the given scenarios one after the other (one GPU), and exports the MP4 of a program.
 */
export const useHuntRender = (scenarios: HuntScenario[], format: HuntFormat, quality: RenderQuality) => {
  const [service, setService] = useState<{ ok: boolean; blender: boolean } | null>(null);
  const [frames, setFrames] = useState<(HuntFrames | null)[]>(() => scenarios.map(() => null));
  const [job, setJob] = useState<RenderJob | null>(null);
  /** Which scenario of the list is rendering (queue position) while a batch runs. */
  const [queue, setQueue] = useState<{ index: number; total: number } | null>(null);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  /** What each scenario looked like when it was rendered here (to flag later edits). */
  const [renderedAs, setRenderedAs] = useState<Record<string, string>>({});
  const stop = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const keys = scenarios.map((s) => jobKey(s, format, quality)).join('|');

  useEffect(() => {
    void pingService().then(setService);
  }, []);

  const loadOne = async (s: HuntScenario) => {
    try {
      return await new HuntFrames(jobKey(s, format, quality)).load();
    } catch {
      return null;
    }
  };
  // renders already on disk (this format and quality)
  useEffect(() => {
    setFrames(scenarios.map(() => null));
    if (!service?.ok) return;
    let gone = false;
    void renderStatus().then((j) => !gone && setJob(j));
    void Promise.all(scenarios.map(loadOne)).then((f) => !gone && setFrames(f));
    return () => {
      gone = true;
    };
  }, [service, keys]);

  const running = !!queue || !finished(job);

  /** Render the scenarios with these indices (default: all), one after the other. */
  const render = async (indices = scenarios.map((_, i) => i)) => {
    stop.current = false;
    try {
      for (const [n, i] of indices.entries()) {
        if (stop.current) break;
        const s = scenarios[i];
        setQueue({ index: n, total: indices.length });
        setRenderedAs((r) => ({ ...r, [s.id]: JSON.stringify(renderScenario(s)) }));
        let j: RenderJob | null = await startRender(s, format, quality);
        setJob(j);
        while (!finished(j)) {
          await sleep(1000);
          j = await renderStatus();
          setJob(j);
        }
        if (j?.phase !== 'done') break;
        const f = await loadOne(s);
        setFrames((all) => all.map((x, k) => (k === i ? f : x)));
      }
    } catch (e) {
      alert(`Render nicht gestartet: ${(e as Error).message}`);
    } finally {
      setQueue(null);
    }
  };

  const cancel = () => {
    stop.current = true;
    void cancelRender();
  };

  const stale = (s: HuntScenario) => s.id in renderedAs && renderedAs[s.id] !== JSON.stringify(renderScenario(s));

  /** MP4 of the program — every scenario must be rendered. */
  const exportMp4 = async (p: HuntProgram, name: string) => {
    if (frames.some((f) => !f)) return;
    const ac = new AbortController();
    abort.current = ac;
    setExporting({ done: 0, total: 1 });
    try {
      const all = frames as HuntFrames[];
      const blob = await renderHuntMp4(p, format, all, { signal: ac.signal, onProgress: (done, total) => setExporting({ done, total }) });
      downloadBlob(blob, `${name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}_${format}_${all[0].height}p.mp4`);
    } catch (e) {
      if (!(e instanceof HuntRenderAborted)) alert(`Export fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setExporting(null);
      abort.current = null;
    }
  };

  return { service, frames, job, queue, running, render, cancel, stale, exporting, exportMp4, abortExport: () => abort.current?.abort() };
};

export const PHASES: Record<RenderJob['phase'], string> = {
  plate: 'Schneise (einmalig je Stand und Format)',
  animals: 'Wild, Bild für Bild',
  compose: 'Ausschnitte vorbereiten',
  done: 'Fertig',
  error: 'Fehler',
  cancelled: 'Abgebrochen',
};
