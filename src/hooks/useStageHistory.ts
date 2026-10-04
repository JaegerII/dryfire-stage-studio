import { useCallback, useRef, useState } from 'react';
import type { Stage } from '../types/stage';

const LIMIT = 100;

/**
 * Stage state with undo/redo. `transient` updates (drag in progress) change
 * the stage without creating history entries; the next committing update
 * records the state from before the gesture as one undo step.
 */
export const useStageHistory = (initial: Stage) => {
  const [stage, setStage] = useState(initial);
  const current = useRef(initial);
  const past = useRef<Stage[]>([]);
  const future = useRef<Stage[]>([]);
  const gestureBase = useRef<Stage | null>(null);
  const [, bump] = useState(0);

  const set = (next: Stage) => {
    current.current = next;
    setStage(next);
  };

  const update = useCallback((fn: (s: Stage) => Stage, opts: { transient?: boolean } = {}) => {
    const cur = current.current;
    const next = fn(cur);
    if (next === cur) return;
    if (opts.transient) {
      if (!gestureBase.current) gestureBase.current = cur;
    } else {
      past.current = [...past.current, gestureBase.current ?? cur].slice(-LIMIT);
      future.current = [];
      gestureBase.current = null;
    }
    set(next);
  }, []);

  /** Close an open transient gesture as one undo step (no-op if none is open). */
  const commit = useCallback(() => {
    if (!gestureBase.current) return;
    past.current = [...past.current, gestureBase.current].slice(-LIMIT);
    future.current = [];
    gestureBase.current = null;
    bump((n) => n + 1); // re-render so canUndo updates
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.at(-1);
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [current.current, ...future.current];
    set(prev);
  }, []);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, current.current];
    set(next);
  }, []);

  /** Replace the whole stage (load / new) and clear history. */
  const reset = useCallback((s: Stage) => {
    past.current = [];
    future.current = [];
    gestureBase.current = null;
    set(s);
  }, []);

  return { stage, update, commit, undo, redo, reset, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
};
