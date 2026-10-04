import React, { createContext, useContext, useEffect, useMemo } from 'react';
import type * as THREE from 'three';
import {
  acousticPanelTexture,
  acousticTileTexture,
  grassBermTexture,
  grassTexture,
  greenFloorTexture,
  overcastSkyTexture,
  bermTexture,
  blockWallTexture,
  concreteTexture,
  gravelTexture,
  rubberTexture,
  skyTexture,
} from './textures';

type Textures = Record<
  'concrete' | 'gravel' | 'panel' | 'block' | 'rubber' | 'berm' | 'sky' | 'tile' | 'greenFloor' | 'grass' | 'grassBerm' | 'overcast',
  THREE.Texture
>;

const Ctx = createContext<Textures | null>(null);

/** Builds every procedural texture once per mounted scene. */
export const RangeAssets: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const textures = useMemo<Textures>(
    () => ({
      concrete: concreteTexture(),
      gravel: gravelTexture(),
      panel: acousticPanelTexture(),
      block: blockWallTexture(),
      rubber: rubberTexture(),
      berm: bermTexture(),
      sky: skyTexture(),
      tile: acousticTileTexture(),
      greenFloor: greenFloorTexture(),
      grass: grassTexture(),
      grassBerm: grassBermTexture(),
      overcast: overcastSkyTexture(),
    }),
    [],
  );
  useEffect(() => () => Object.values(textures).forEach((t) => t.dispose()), [textures]);
  return <Ctx.Provider value={textures}>{children}</Ctx.Provider>;
};

export const useTextures = () => {
  const t = useContext(Ctx);
  if (!t) throw new Error('useTextures must be used inside <RangeAssets>');
  return t;
};
