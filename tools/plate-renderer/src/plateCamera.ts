/**
 * The ONE camera every environment plate is rendered with.
 *
 * Stage Studio's 2.5D perspective relies on these numbers
 * (src/assets/environments.ts in the repo root must match):
 *   - camera looks straight ahead (no pitch), so vertical lines stay vertical
 *   - the horizon sits at HORIZON × image height (lens shift, not tilt)
 *   - an object of real height h standing on the floor at screen height y
 *     (0 = top, 1 = bottom) is drawn h × (y − HORIZON) / CAMERA_HEIGHT
 *     image-heights tall
 */
import * as THREE from 'three';

export const HORIZON = 0.4;
export const CAMERA_HEIGHT = 1.5; // meters
/** Focal length in units of image height. Bottom edge of the image ≈ 3.5 m away. */
export const FOCAL = 1.4;
/** Camera position along the range (meters). */
export const CAMERA_Z = -2.2;

export const applyPlateCamera = (camera: THREE.PerspectiveCamera, width: number, height: number) => {
  // virtual full frame whose centre is the horizon; we show its lower part
  const fullH = 2 * (1 - HORIZON) * height;
  camera.fov = (2 * Math.atan(fullH / 2 / (FOCAL * height)) * 180) / Math.PI;
  camera.aspect = width / fullH;
  camera.near = 0.1;
  camera.far = 400;
  camera.position.set(0, CAMERA_HEIGHT, CAMERA_Z);
  camera.lookAt(0, CAMERA_HEIGHT, CAMERA_Z + 10);
  camera.setViewOffset(width, fullH, 0, fullH - height, width, height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
};
