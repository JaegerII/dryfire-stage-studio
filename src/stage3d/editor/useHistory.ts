import { useCallback, useRef, useState } from 'react';

const LIMIT = 100;

/**
 * Undo / redo for any immutable document (same behaviour as useStageHistory):
 * `transient` updates (a drag in progress) change the document without a
 * history entry; commit() closes the gesture as one undo step.
 */
export const useHistory = <T,>(initial: T) => {
  const [doc, setDoc] = useState(initial);
  const current = useRef(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const gestureBase = useRef<T | null>(null);
  const [, bump] = useState(0);

  const set = (next: T) => {
    current.current = next;
    setDoc(next);
  };

  const update = useCallback((fn: (d: T) => T, opts: { transient?: boolean } = {}) => {
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

  const commit = useCallback(() => {
    if (!gestureBase.current) return;
    past.current = [...past.current, gestureBase.current].slice(-LIMIT);
    future.current = [];
    gestureBase.current = null;
    bump((n) => n + 1);
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

  const reset = useCallback((d: T) => {
    past.current = [];
    future.current = [];
    gestureBase.current = null;
    set(d);
  }, []);

  return { doc, update, commit, undo, redo, reset, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
};
