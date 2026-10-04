# DRYFIRE STAGE STUDIO

Browser app (React + TypeScript + Vite + Konva) for building practical-shooting dry-fire stages
and playing them full screen, for training on a TV or for recording YouTube videos with OBS.
**A new stage never needs code**: it is a JSON file, created in the visual editor.

```bash
npm install
npm run dev        # http://localhost:5180
npm run plates     # (in tools/plate-renderer) re-render the environment backgrounds
npm run build      # static build in dist/ (any static host)
npm run assets     # regenerate target / barrier SVGs and beeps after a design change
```

## Pages and routes

| Route | Page |
|---|---|
| `#/` | **Start page**: matches as cards (active / archive), all stages, import, new match / stage |
| `#/match/<id>` | **Match**: its stages in play order, archive, export |
| `#/match/<id>/play` | **Match player**: logo → safety → every stage (one take for OBS) |
| `#/match/<id>/edit/<stageId>` | **Editor** for a stage of that match (breadcrumb back) |
| `#/edit/<stageId>` / `#/play/<stageId>` | edit / play a single stage |

The browser's back button works between pages. Leaving the editor with unsaved changes asks first.

## Editor

* **Add objects:** click an asset in the library, or drag it onto the stage.
* **Arrange:** drag to move. The corner handles scale, the top handle rotates. The properties panel takes exact values:
  X/Y, scale, rotation, turn (yaw), opacity, layer, perspective auto/manual + depth, lock, motion.
* **Perspective is automatic.** Moving an object up (downrange) makes it smaller, matching the environment photo.
  The dashed red line is the horizon. Use *Manual depth* for special cases and *Scale* to fine-tune.
* **Multi-select:** Ctrl- or Shift-click (stage or object list) adds or removes objects, and Ctrl+A selects everything.
  Drag any selected object to move the whole group, and use the handles to scale or rotate it. Delete, duplicate,
  lock, layer and arrow keys act on all selected objects. A group move is one undo step.
* **Keys:**
  * Ctrl+S save, Ctrl+Z / Ctrl+Y undo/redo
  * Ctrl+D duplicate, Del delete, L lock
  * `]` / `[` (or PgUp/PgDn) layer forward/back
  * arrows nudge, Shift+arrows nudge more, Esc deselect
* **Toolbar:** New, Load, Save, Duplicate, Reset (to last save), Import/Export JSON, Grid, Snap, Play.
* **Storage:** stages are saved in the browser (localStorage). Built-in stages live in `src/data/stages/*.json`.
  To ship a stage with the app, export it and drop the file there.

## Matches and archive

* **A match** is an ordered list of stages, typically 2–4, played as one session or video.
* **Start page:** click a match card to open it, or use **+ New match**.
* **Match page:** create stages (*+ New stage* opens the editor), add existing ones, reorder (↑ ↓), edit, play or remove them.
* **Archive:** archived matches stay unchanged and move to the *Archive* tab. *Restore* brings them back.
* **Export / Import:** a match bundle (match plus its stages) can be restored on any computer.
  Built-in matches live in `src/data/matches/*.json`.

### Match playback (one take for OBS)

1. **FORTH TRACE logo** (5 s), then **Attention / safety** (7 s). These are shown once per match and are optional in the setup.
2. **For every stage:** a title card (*Stage 2 / 3*, name, par, reps, 4 s). Then the camera **pushes into the stage**
   from black while MAKE READY shows, then all reps. Before each rep **ARE YOU READY?** and **STANDBY** appear large in the
   centre of the screen.
3. **MATCH COMPLETE** at the end.

A single stage played on its own skips the intro by default.

## Player

Each rep runs: reset/prep → **STAND BY** (spoken cue) → random delay → start beep → par time → end beep → reset → … → **TRAINING COMPLETE**.

* **Options:**
  * safety + brand intro
  * spoken "Stand by"
  * running timer
  * signal border
  * seed (same seed = same random delays, so a recording can be repeated)
  * volume
* **Keys:** Space start/pause, R restart, F fullscreen, Esc stop / back.
* **Timing:** beeps are scheduled on the Web Audio clock, so they are sample-accurate. The HUD updates every
  animation frame without React re-renders. The HUD is sized in container units, so it looks identical at
  1920×1080, 2560×1440 and 3840×2160.

### Zoom

* **Zoom (closer)** in the stage properties brings the whole stage closer (1 = full view, up to 2.5).
  The scene scales around the horizon centre, which is the same as a longer lens, so perspective stays correct.

### Record a video file (no OBS needed)

1. Open the match (or stage) player and tick **● Record video file**.
2. Press **Start**. The browser asks to share a tab: choose **this tab**.
3. Keep the mouse still. At the end the video downloads automatically: MP4 in current Chrome, otherwise WebM.

* **Real time:** the recording runs in real time, so an 8-minute match takes 8 minutes.
* **Picture and sound:** with Region Capture (Chrome) only the 16:9 player is recorded, without black bars. The beeps and
  the voice are recorded digitally from the player, not through a microphone.
* **Resolution:** follows the player's size on screen. Fullscreen on a 1080p, 1440p or 4K monitor gives that resolution.
* **Stopping early:** *Stop* asks whether to keep the part recorded so far.

### YouTube workflow

1. Build the stage in the editor, then **Save** (and **Export JSON** for your archive).
2. Press **Play**, or open `#/play/<stageId>` in a browser window.
3. Set the window/display to 1920×1080 (or 1440p/2160p) and press **Fullscreen**.
4. Record with OBS (Display or Window Capture plus desktop audio), then cut in DaVinci Resolve.

## Exporting and sharing stages

* **One stage → file:** *Export JSON* in the editor toolbar downloads `<stageId>.json`. *Import JSON* loads it again,
  on any computer.
* **Saved stages live in the browser** (localStorage): they stay on that computer and in that browser.
* **Make a stage available for everyone (and on every device):** copy the exported JSON into `src/data/stages/`,
  commit and push. After the automatic deploy it appears as a built-in stage in the online version.
* **Video:** *Record video file* in the player (see above), or record the player with OBS.

## Online version (GitHub Pages)

Every push to `main` builds the app and publishes it via `.github/workflows/deploy.yml`.
The link is `https://<account>.github.io/<repo>/`. A stage can be opened directly with `#/play/<stageId>` or `#/edit/<stageId>`.

One-time setup on GitHub: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

To update the online version:

```bash
git add -A
git commit -m "Describe the change"
git push
```

The deploy takes about one minute (watch it under the repo's **Actions** tab).

## Stage JSON

```json
{
  "schemaVersion": 1,
  "id": "stage_001",
  "name": "Stage 1 – Training",
  "environment": "indoor_01",
  "parTime": 5,
  "repetitions": 6,
  "resetTime": 3,
  "standbyDelay": { "min": 1, "max": 2 },
  "objects": [
    { "id": "paper_01", "type": "paper_full", "x": 0.29, "y": 0.64, "scale": 1, "rotation": 0, "zIndex": 0 },
    { "id": "wall_01", "type": "mesh_wall", "x": 0.35, "y": 0.64, "scale": 1, "rotation": 0, "yaw": 60, "zIndex": 0 }
  ],
  "meta": { "difficulty": "beginner", "discipline": "handgun", "tags": ["transitions"] }
}
```

* `x`, `y`: ground point of the object, normalised 0..1 (resolution-independent).
* Optional per object:
  * `elevation` (meters above the floor, e.g. `0.6` = on top of a box)
  * `flip` (mirror left/right, e.g. the diagonal wall sloping the other way)
  * `yaw` (turned wall/target)
  * `opacity`
  * `perspective: "manual"` + `depth`
  * `locked`
  * `label` (stored, not drawn)
  * `motion`
* `motion.kind`: `static | fall | swing | horizontal | vertical | popup | appear | disappear`, with `delay`, `duration`,
  `angle`, `amplitude`, `period`, `trigger`, `hiddenUntilStart`.
  * `swing`: the target rocks left/right around its foot like a metronome, `angle` degrees to each side
    (negative = left first), `period` seconds per full swing. Best with the *Swinger (on pole)* asset, e.g. behind a wall.
  * `amplitude` (slide/bob): how far it moves to each side, **in meters** (negative = left/down first). `period`: seconds
    per full back-and-forth. In the editor the two end points are shown as translucent ghosts with a dashed travel line.
  * `fall` (steel only): the steel goes down `delay` s after the start beep. This simulates your first shot on it.
  * `trigger: "<steel id>"`: the motion starts when that steel falls instead of at the beep. `delay` then counts
    from the fall. This is how activators work: hit the popper, and a target appears, pops up or swings.
  * `hiddenUntilStart` (swing/bob): the target stays invisible until its motion starts.
  * Between reps everything resets: steel stands up again, activated targets disappear.
* Object types:
  * Targets: `paper_full`, `paper_mini`, `paper_stack` (target / no-shoot / target overlapping on one stand), `paper_stack_double`, `paper_swinger` (card on a pivoting pole), `paper_card` (card only, for boxes), `paper_hc_vertical` / `paper_hc_half` / `paper_hc_bottom` / `paper_hc_diagonal` (black hard-cover paint, mirror for the other side; each also as `…_card` without stand), `no_shoot`, `no_shoot_overlay` (card only),
    `steel_popper`, `steel_plate`, `steel_plate_rack`
  * Barriers: `mesh_wall`, `mesh_wall_short`, `mesh_wall_window`, `mesh_wall_diagonal`, `mesh_wall_port`, `mesh_corner`, `wood_wall`, `barrel`, `barrel_barricade`
  * Banners (160 × 50 cm mesh banners for advertising): `banner_forth_trace_black`, `banner_forth_trace_white`, `banner_west_arms`. Select a wall, then click a banner: it hangs on that wall (same position and angle, 1 m up). Adjust with Elevation / Scale. New banners: add a function in `scripts/generate-assets.mjs` (logos go in `scripts/brand/`).
  * Other: `start_box`, `crate` (black box, 60 cm), `crate_wide` (black box, 120 cm — e.g. target + angled no-shoot side by side)
* Objects hidden behind something (e.g. a swinger behind a box) can be selected from the **Objects** list in the right panel.
* Rotation and scale of an elevated object pivot at its own foot (on the box), not at the floor.
* Boxes: select a box, then click *Paper Target (card only)* or a steel target in the library, and it lands on top of the box.
* Example of an activator stage: `src/data/stages/stage_004.json` (popper → swinger rocking behind a wall).
* Environments: `indoor_01`, `indoor_02`, `indoor_03` (bright lane), `outdoor_01`, `outdoor_02`, `outdoor_03` (grass berms), `indoor_04` (beam ceiling), `outdoor_04` (sunset, covered bays).

## Structure

```
src/
  assets/        environments/*.webp  targets/*.svg  barriers/*.svg  other/  audio/  brand/  fonts/
                 registry.ts (asset catalogue)  environments.ts (horizon + camera height per plate)
  components/
    home/        HomePage (matches, archive, all stages)
    match/       MatchPage (stages of a match)
    editor/      StageEditor, AssetLibrary, PropertiesPanel, EditorToolbar, fields
    stage/       StageCanvas (shared renderer), StageObject → TargetObject / BarrierObject
    player/      TrainingPlayer, PlayerOverlay, IntroScreens, FullscreenButton
  data/          stages/*.json (built-in), stageRepository.ts (storage interface)
  hooks/         useStageHistory (undo/redo), useAssetImage (image cache), useFullscreen, useElementSize
  utils/         perspective, schedule, audioEngine, motion, stageIO (validate/import/export), random
  types/stage.ts the data model
scripts/generate-assets.mjs   the single source of the target / barrier / start-box art + beeps
```

## Visual consistency

* **Shared assets:** every stage uses the same SVG files from `src/assets`. To change a design, edit `scripts/generate-assets.mjs`
  and run `npm run assets`, and all stages change together.
* **Target design:** the paper targets are original drawings with practical-style proportions (46 × 58 cm octagon,
  slightly rounded corners, embossed zone lines). They carry no federation name, logo or zone lettering.
* **Environment plates:** these are rendered by `tools/plate-renderer` with one fixed, level camera.
  A real photo can replace a plate if it is shot level and you measure its horizon and camera height in `environments.ts`.

## Prepared for later

* **Accounts / libraries:** `StageRepository` is an interface; swap `LocalStageRepository` for a server API
  (accounts, public library, premium packs).
* **Filters:** `meta.difficulty`, `meta.discipline` and `meta.tags` already exist for difficulty and handgun/rifle filters.
* **Moving targets:** `motion` is in the data model, the editor and the player loop.
* **Random stage generator:** a pure function returning a `Stage`; feed it into `normalizeStage` and open it in the editor.
* **TV casting / second screen:** the player is a plain route (`#/play/<id>`) with no editor dependencies.
