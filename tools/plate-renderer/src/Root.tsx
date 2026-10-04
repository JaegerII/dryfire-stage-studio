import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import React, { useLayoutEffect } from 'react';
import { Composition, useVideoConfig } from 'remotion';
import type * as THREE from 'three';
import { applyPlateCamera } from './plateCamera';
import { RangeAssets } from './scene/assets';
import { type EnvironmentId, RangeEnvironment } from './scene/Environment';

/**
 * Environment plate renderer for DRYFIRE STAGE STUDIO.
 * Renders empty ranges (no targets, no walls) as background images:
 *   npm run plates   → ../../src/assets/environments/*.webp
 */
const ENVIRONMENTS: EnvironmentId[] = ['indoor_01', 'indoor_02', 'indoor_03', 'outdoor_01', 'outdoor_02', 'outdoor_03'];

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
      <RangeAssets>
        <RangeEnvironment id={env} />
      </RangeAssets>
    </ThreeCanvas>
  );
};

export const RemotionRoot: React.FC = () => (
  <>
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
  </>
);
