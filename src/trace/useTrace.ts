import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { TraceController } from './TraceController';

export const TraceContext = createContext<TraceController | null>(null);

/** The controller; the calling component re-renders whenever it reports a change. */
export const useTrace = () => {
  const c = useContext(TraceContext);
  if (!c) throw new Error('useTrace outside <TraceApp>');
  useSyncExternalStore(c.subscribe, c.getVersion);
  return c;
};

/** Re-render every `ms` (for live numbers that change continuously: fps, clocks). */
export const useTicker = (ms: number, on = true) => {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms, on]);
};
