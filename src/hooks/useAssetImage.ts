import { useEffect, useState } from 'react';
import { ASSET_LIST } from '../assets/registry';
import { ENVIRONMENT_LIST } from '../assets/environments';

/** Module-level cache: each image file is decoded exactly once per session. */
const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

export const loadImage = (src: string): Promise<HTMLImageElement> => {
  const done = cache.get(src);
  if (done) return Promise.resolve(done);
  let p = pending.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        cache.set(src, img);
        pending.delete(src);
        resolve(img);
      };
      img.onerror = reject;
      img.src = src;
    });
    pending.set(src, p);
  }
  return p;
};

/** Warm the cache with every asset and environment at start-up. */
export const preloadAll = () => Promise.all([...ASSET_LIST.map((a) => a.src), ...ENVIRONMENT_LIST.map((e) => e.src)].map(loadImage));

export const useAssetImage = (src: string) => {
  const [img, setImg] = useState<HTMLImageElement | undefined>(() => cache.get(src));
  useEffect(() => {
    let alive = true;
    if (cache.get(src)) setImg(cache.get(src));
    else loadImage(src).then((i) => alive && setImg(i));
    return () => {
      alive = false;
    };
  }, [src]);
  return img;
};
