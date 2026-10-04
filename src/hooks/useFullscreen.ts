import { type RefObject, useCallback, useEffect, useState } from 'react';

export const useFullscreen = (ref: RefObject<HTMLElement | null>) => {
  const [active, setActive] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen({ navigationUI: 'hide' });
  }, [ref]);
  return { active, toggle };
};
