# Environment plate renderer

Offline tool (Remotion + three.js) that renders the **empty** range backgrounds for
[DRYFIRE STAGE STUDIO](../../README.md). The studio app itself contains no 3D engine.
It only loads the resulting images.

```bash
npm install
npm run plates              # all four plates → ../../src/assets/environments/*.webp
npm run plates indoor_02    # just one
npm run studio              # preview / tweak in Remotion Studio
```

* `src/plateCamera.ts` is the one camera every plate uses: level, eye height 1.5 m, horizon at 40 % of the
  image height (lens shift). Stage Studio's 2.5D perspective formula depends on these numbers.
  If you change them, update `src/assets/environments.ts` (repo root) too.
* `src/scene/Environment.tsx` holds the indoor and outdoor variants (lights, materials, vegetation).
* `src/scene/textures.ts` holds the procedural textures (concrete, block wall, rubber backstop, gravel, berm, sky).

Plates are rendered at 3840 × 2160 and saved as WebP via sharp.
