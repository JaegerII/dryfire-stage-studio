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

## Photorealistic renders (Blender Cycles)

The current plates and all object sprites are rendered with Blender (path tracing), not three.js:

```bash
npm run textures                          # once: CC0 PBR materials (ambientCG) + HDRI skies (Poly Haven) → public/tex
npm run blender                           # every plate + every sprite (~1 h on an RTX 2060)
npm run blender sprites                   # all object sprites → ../../src/assets/realistic/*.webp
npm run blender plate:outdoor_02          # one job (plate:<environment>, sprite:<object type>)
```

* `blender/scene.py` builds every scene (materials, models, rooms, terrain, grass) and both cameras:
  the plate camera matches `src/plateCamera.ts`; sprites use a level eye-height camera framed exactly to the
  registry geometry (`viewW` / `viewH` / `groundY` are read from `src/assets/registry.ts`).
* `blender/textures.py` (Python + Pillow) generates the card faces, hard-cover paint, barrier mesh and popper paint.
* Blender is expected at `D:/Tools/blender-5.2.2-windows-x64/blender.exe` (portable zip from blender.org); set `BLENDER` to override.
* Outdoor sun positions are measured from the HDRIs; `src/assets/environments.ts` holds the matching `shadow` values the app uses for cast shadows.
