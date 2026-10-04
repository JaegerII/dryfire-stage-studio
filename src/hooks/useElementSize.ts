import { useLayoutEffect, useRef, useState } from 'react';

/** Observes an element's content box size. */
export const useElementSize = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
};

/** Largest 16:9 box that fits into the given area. */
export const fit16x9 = (width: number, height: number) => {
  const w = Math.min(width, (height * 16) / 9);
  return { width: Math.floor(w), height: Math.floor((w * 9) / 16) };
};
