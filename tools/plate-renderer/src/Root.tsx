import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import React, { useLayoutEffect } from 'react';
import { AbsoluteFill, Composition, Img, staticFile, useVideoConfig } from 'remotion';
import type * as THREE from 'three';
import { AssetSprite, SPRITES, SPRITE_PX_PER_CM, type SpriteId } from './AssetSprite';
import { applyPlateCamera } from './plateCamera';
import { RangeAssets } from './scene/assets';
import { PBRProvider } from './scene/pbr';
import { type EnvironmentId, RangeEnvironment } from './scene/Environment';

/**
 * Environment plate renderer for DRYFIRE STAGE STUDIO.
 * Renders empty ranges (no targets, no walls) as background images:
 *   npm run plates   → ../../src/assets/environments/*.webp
 */
const ENVIRONMENTS: EnvironmentId[] = ['indoor_01', 'indoor_02', 'indoor_03', 'indoor_04', 'outdoor_01', 'outdoor_02', 'outdoor_03', 'outdoor_04'];

const CameraRig: React.FC = () => {
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    // stop R3F from resetting aspect/projection on resize
    (camera as THREE.PerspectiveCamera & { manual?: boolean }).manual = true;
    applyPlateCamera(camera as THREE.PerspectiveCamera, size.width, size.height);
    invalidate();
  }, [camera, size, invalidate]);
  return null;
};

const Plate: React.FC<{ env: EnvironmentId }> = ({ env }) => {
  const { width, height } = useVideoConfig();
  return (
    <ThreeCanvas width={width} height={height} shadows="soft" gl={{ antialias: true, preserveDrawingBuffer: true }} dpr={1}>
      <CameraRig />
      <PBRProvider>
        <RangeAssets>
          <RangeEnvironment id={env} />
        </RangeAssets>
      </PBRProvider>
    </ThreeCanvas>
  );
};

/** Banner artwork (the app's SVG, with its embedded font) as a bitmap texture for Blender. */
const BannerImage: React.FC<{ file: string }> = ({ file }) => (
  <AbsoluteFill>
    <Img src={staticFile(`tex/gen/${file}`)} style={{ width: '100%', height: '100%' }} />
  </AbsoluteFill>
);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="banner-image" component={BannerImage} defaultProps={{ file: 'banner.svg' }} durationInFrames={1} fps={30} width={3200} height={1080} />
    {ENVIRONMENTS.map((env) => (
      <Composition
        key={env}
        id={env.replace('_', '-')}
        component={Plate}
        defaultProps={{ env }}
        durationInFrames={1}
        fps={30}
        width={3840}
        height={2160}
      />
    ))}
    {(Object.keys(SPRITES) as SpriteId[]).map((id) => (
      <Composition
        key={id}
        id={`asset-${id.replace(/_/g, '-')}`}
        component={AssetSprite}
        defaultProps={{ id }}
        durationInFrames={1}
        fps={30}
        // rendered at 2× and downsampled by scripts/render-assets.mjs (supersampling)
        width={SPRITES[id].viewW * SPRITE_PX_PER_CM * 2}
        height={SPRITES[id].viewH * SPRITE_PX_PER_CM * 2}
      />
    ))}
  </>
);
