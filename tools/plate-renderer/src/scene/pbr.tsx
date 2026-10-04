/**
 * Photo-scanned PBR materials (ambientCG, CC0) and HDRI lighting (Poly Haven, CC0).
 * Files live in public/tex — fetch them once with `npm run textures`.
 */
import { useThree } from '@react-three/fiber';
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

type MapKind = 'color' | 'normal' | 'rough' | 'ao' | 'metal';

const MATERIALS = {
  Cardboard004: ['color', 'normal', 'rough'],
  Concrete034: ['color', 'normal', 'rough'],
  Concrete036: ['color', 'normal', 'rough'],
  Wood058: ['color', 'normal', 'rough'],
  Rubber001: ['color', 'normal', 'rough'],
  Rubber004: ['color', 'normal', 'rough'],
  Fabric030: ['color', 'normal', 'rough', 'ao'],
  PaintedMetal004: ['color', 'normal', 'rough', 'metal'],
} satisfies Record<string, MapKind[]>;

export type MaterialId = keyof typeof MATERIALS;
type MapSet = Partial<Record<MapKind, THREE.Texture>>;
interface Library {
  maps: Record<MaterialId, MapSet>;
  hdri: THREE.Texture;
}

const Ctx = createContext<Library | null>(null);

/** Loads every material + the HDRI before the frame renders (delayRender). */
export const PBRProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lib, setLib] = useState<Library | null>(null);
  const [handle] = useState(() => delayRender('loading PBR textures'));
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    (async () => {
      const maps = {} as Library['maps'];
      await Promise.all(
        (Object.entries(MATERIALS) as [MaterialId, MapKind[]][]).map(async ([id, kinds]) => {
          const set: MapSet = {};
          await Promise.all(
            kinds.map(async (k) => {
              const t = await loader.loadAsync(staticFile(`tex/${id}_${k}.jpg`));
              t.wrapS = t.wrapT = THREE.RepeatWrapping;
              t.anisotropy = 16;
              if (k === 'color') t.colorSpace = THREE.SRGBColorSpace;
              set[k] = t;
            }),
          );
          maps[id] = set;
        }),
      );
      const hdri = await new HDRLoader().loadAsync(staticFile('tex/empty_warehouse_01.hdr'));
      hdri.mapping = THREE.EquirectangularReflectionMapping;
      setLib({ maps, hdri });
    })().catch((e) => {
      console.error(e);
      throw e;
    });
  }, [handle]);
  return lib ? (
    <Ctx.Provider value={lib}>
      {children}
      <RenderWhenReady handle={handle} />
    </Ctx.Provider>
  ) : null;
};

/** Remotion renders R3F with frameloop "never": draw once more after the textured scene mounted. */
const RenderWhenReady: React.FC<{ handle: number }> = ({ handle }) => {
  const { advance } = useThree();
  useEffect(() => {
    // a few frames: post-processing (AO) needs its buffers sized and filled
    let n = 0;
    let raf = 0;
    const tick = () => {
      advance(performance.now());
      if (++n < 4) raf = requestAnimationFrame(tick);
      else continueRender(handle);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [advance, handle]);
  return null;
};

const useLib = () => {
  const l = useContext(Ctx);
  if (!l) throw new Error('usePBR must be used inside <PBRProvider>');
  return l;
};

/** Raw image of one map (for compositing canvas textures). */
export const usePBRImage = (id: MaterialId, kind: MapKind) => useLib().maps[id][kind]!.image as HTMLImageElement;

export interface PBROptions {
  repeat?: [number, number];
  /** Rotate the texture (radians) — e.g. wood grain along a vertical post. */
  rotation?: number;
  skip?: MapKind[];
}

/** Material props for <meshStandardMaterial {...usePBR('Concrete034', { repeat: [8, 8] })} />. */
export const usePBR = (id: MaterialId, { repeat = [1, 1], rotation = 0, skip = [] }: PBROptions = {}) => {
  const lib = useLib();
  const [rx, ry] = repeat;
  const skipKey = skip.join();
  return useMemo(() => {
    const set = lib.maps[id];
    const c = (k: MapKind) => {
      const t = set[k];
      if (!t || skipKey.includes(k)) return undefined;
      const x = t.clone();
      x.repeat.set(rx, ry);
      x.center.set(0.5, 0.5);
      x.rotation = rotation;
      x.needsUpdate = true;
      return x;
    };
    return { map: c('color'), normalMap: c('normal'), roughnessMap: c('rough'), aoMap: c('ao'), metalnessMap: c('metal') };
  }, [lib, id, rx, ry, rotation, skipKey]);
};

/** Image-based lighting from the HDRI (reflections + soft fill). */
export const EnvLighting: React.FC<{ intensity?: number; rotation?: number }> = ({ intensity = 1, rotation = 0 }) => {
  const { scene, invalidate } = useThree();
  const { hdri } = useLib();
  useLayoutEffect(() => {
    scene.environment = hdri;
    scene.environmentIntensity = intensity;
    scene.environmentRotation.set(0, rotation, 0);
    invalidate();
    return () => {
      scene.environment = null;
    };
  }, [scene, hdri, intensity, rotation, invalidate]);
  return null;
};
