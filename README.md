# DRYFIRE STAGE STUDIO

Browser app (React + TypeScript + Vite + three.js) for building practical-shooting dry-fire stages **in 3D** and
playing them full screen — for training on a TV, or rendered straight to an MP4 for YouTube.
**A new stage never needs code**: it is a JSON file, built in the top-view editor.

```bash
npm install
npm run dev        # http://localhost:5180
npm run build      # static build in dist/ (any static host)
npm test           # unit tests
```

The 3D ranges and objects come from `tools/plate-renderer` (Blender, see *3D assets* below).

## Pages and routes

| Route | Page |
|---|---|
| `#/` | **Start page**: matches as cards (active / archive), all stages, import, new match / stage |
| `#/match/<id>` | **Match**: its stages in play order, match settings, archive, export |
| `#/match/<id>/play` | **Match player**: logo → safety → every stage → MATCH COMPLETE; plays live or renders one MP4 |
| `#/match/<id>/edit/<stageId>` | **Editor** for a stage of that match (breadcrumb back, previous / next stage) |
| `#/edit/<stageId>` / `#/play/<stageId>` | edit / play a single stage |
| `#/training` | training programs (PP1 / NPA) |
| `#/trace/<tab>` | **FORTH TRACE** on the phone: training, live tracking, analysis, settings (experimental) |
| `#/tv/<CODE>` | **TV renderer** that joins a phone's training session (3D view of the stage) |

The browser's back button works between pages. Leaving the editor with unsaved changes asks first.
Links of the former 3D beta (`#/3d/edit/…`, `#/3d/play/…`) still lead to the same stage.

## Stages

A stage is a floor plan in meters: objects (`x` right of the centre line, `d` downrange, `yaw`, `tilt`, `roll`, height,
size, mirroring, motion), shooter **positions** (`x`, `d`, `heading`, optional `pitch` = look up / down and `eye` = eye
height) and **legs** between them (`after` = seconds at the
previous position, `duration`, `reload`, optional `via` corner points). Par = all waits + moves + `finalTime`.
Repetitions, reset time and standby delay as before.

* **Environments:** Indoor Range 01–04, Indoor Range 05 (270° hall lined with black rubber mats, white ceiling with red
  panels — Glockstore style), Indoor Range 06 (white walls with a rubber-mat band, red textile ducts on the ceiling —
  Swiss Tactical style), Outdoor Berm 01–03, Outdoor 04 (sunset, covered bays) and Outdoor 05
  (limestone hillside like the Slovak Open: bright limestone gravel, earth berms with dry grass, a steep slope with
  bushes, rock outcrops and trees). Built-in stage *Slovak Open – Hillside* (`stage_701`) shows it off.
* **Objects:** paper targets (full, mini, hard cover, cards, stacks, swinger), no-shoots, steel (popper, plate, rack),
  orange mesh / black net / solid black partition walls (also with window), **black nets with openings** (window, low
  window to kneel and look down through, vertical port, or all three in one 3 m net), wood wall, drums (blue, black steel, two
  stacked, lying), barrel barricade, boxes, car tyres (single or two stacked), **rubber-covered mobile target stands**
  (indoor; narrow and wide), **target boxes on Euro pallets**, Euro pallets and **tables** (plain, or the start table with
  pistol and magazines). Range dressing: stage signs (1–3), green windscreen fence, tyre walls, red fault lines, white
  wooden barricade, bushes, rocks, sandbag walls, traffic cones.
  * Select a box, table or drum and add a card / steel: it goes on top. Select a rubber target stand and add a card:
    it is fixed to the stand's front.
* **Start condition** (stage properties, presets or own text, e.g. *Pistol unloaded on the table, magazines on the
  table*): shown in the briefing and on the title card. With a table right in front of the start box the shooter looks
  down at the table until the beep, then up to the targets. Built-in example: *Table Start – Rubber Stands*.
* **Walkways:** every move between two positions runs in a lane marked by red wooden slats on the floor (outdoors with
  gravel between them), from the edge of one shooting box to the next. The red path arrows belong to the briefing (and
  the editor) only; during the run there are just the slats.
* **Built-in indoor stages with the mobile rubber targets:** *Glockstore 270 Bay* (Indoor Range 05: targets left, ahead and
  right, turning to both sides) and *Swiss Tactical Indoor* (Indoor Range 06: black partitions, through a window, wide
  rubber walls, steel to finish). More built-in stages with the range dressing: *Tyre Wall Bay*, *Green Fence Lane*, *Pallet
  Box Hall*, and *Black Net Openings* (kneel and look down through a low window, then a high window and a port).
* **Top-view editor:** plan of the range in meters next to a live 3D view (from the selected shooting box, or the
  briefing view from above).
  * **Environment** at the top of the left panel. Objects that do not fit the new room are pulled inside; outdoors the
    room is the bay between the berms (hatched in the plan).
  * Click or drag targets / walls from the library onto the plan; drag to move, the round handle behind an object turns
    it (5° steps, Shift = free), Q / E turn by 15°, *Tilt* / *Lean sideways* lean it forward / back / sideways, arrows nudge, Ctrl+D duplicates, Del deletes. Select a box first to
    put a card / steel on top of it.
  * **Drag on the empty floor** to select several objects (Shift adds), **right-drag** pans, the wheel zooms.
  * **Groups:** Ctrl+G groups the selection, Ctrl+Shift+G ungroups; clicking one member selects the whole group.
  * **Behaviour:** falling steel (activators), swingers, slides, bobs, pop-ups, appear / disappear, started by the beep
    or by an activator. **Up from / Down at** limits an object to part of the run (seconds after the beep).
  * **+ Position** (P), then click the floor: the next shooting box (START → P2 → P3 …). Drag the box, drag the handle in
    front of it to set where the shooter looks; *Stay (s)* = time at that box. **Look up / down** (R / F, 5° steps) and
    **Stance** (standing, crouched, kneeling, prone) per box, e.g. kneel and look down through a low window. In the
    *View from …* preview, **drag to look around**: it sets the box's turn and up / down.
  * Click a path: *Go after*, *Move takes*, *Reload*. Double-click a path to add a corner point, drag it, double-click
    it to remove it.
  * **Brightness** (stage properties → Camera): darker / lighter range and targets, saved with the stage and used in
    the video. Indoor Range 05 / 06 start a little darker than baked.
  * The *View from …* preview shows the floor as in the run (walkway slats, no path arrows); *Briefing (top)* shows the arrows.
  * **Save** keeps the stage in this browser; Export / Import JSON; **▶ Play / Render** plays it as it is in the editor.
* **Storage:** stages are saved in the browser (localStorage). Built-in stages live in `src/stage3d/stages/*.json`;
  saving a built-in stage keeps your version under the same id (*Revert* on the start page restores the original).

### Former 2.5D stages

Everything used to be 2.5D (objects on a photo plate). On the first start of this version, every stage saved in the
browser by the old studio is converted into a 3D stage **with the same id**, so matches, the TRACE training log and
links keep working; the old data stays in localStorage as a backup. Old stage files and match bundles can still be
imported. The conversion (`src/stage3d/legacy.ts`) puts every object on the floor position its plate position implied,
the start box becomes the start position, and a **dynamic stage** becomes positions: each area is shot from its own
box, the barrier wipe becomes a move with reload, and each area's targets are only up while it is shot.

## Matches and archive

* **A match** is an ordered list of stages, typically 2–4, played as one session or video.
* **Start page:** click a match card to open it, or use **+ New match**.
* **Match page:** create stages (*+ New stage* opens the editor), add existing ones, reorder (↑ ↓), edit, play or remove them.
* **Archive:** archived matches stay unchanged and move to the *Archive* tab. *Restore* brings them back.
* **Export / Import:** a match bundle (match plus copies of its stages) can be restored on any computer.

### Match playback

1. **FORTH TRACE logo** (5 s), then **safety** (7 s) — once per match, optional (*Intro* in the player and the settings).
2. **For every stage:** a title card (*Stage 2 / 3*, name, description, par, reps, targets), the **briefing from above**
   with the path drawn as red arrows (where to move, how long to wait, where to reload), the camera **flies down into
   the shooter's eyes** at the start box, MAKE READY, then all reps with real movement between the positions. Before
   each rep **ARE YOU READY?** and **STANDBY**; the border signals standby / go / time.
3. **MATCH COMPLETE** at the end (a single stage: TRAINING COMPLETE).

The player jumps to every stage (*S1*, *S2* …), has voice / timer / walking-shake options and renders the whole match.

### Match settings

On the match page, **Match settings** apply to that match only (stored in the match, so export / import keeps them):

* **Intro & timing:** logo + safety intro on/off, logo screen, safety screen, stage title card (the break between two
  stages) and the Make Ready lead-in, in seconds (0 skips the logo, safety or title card). Defaults: 5 / 7 / 4 / 2 s.
* **For all stages:** reset time, repetitions and standby delay. A checked value replaces the value of every stage in
  this match while it is played; the stages themselves are not changed. "Reset to defaults" removes all settings.
* The match length on the match page and the start page uses these values.

## Video (MP4)

**Render MP4** in the player renders the stage or the whole match **frame by frame in the browser** (WebCodecs +
mediabunny): 1080p / 1440p / 4K, 30 / 60 fps, with the beeps and the spoken "Stand by" mixed in sample-accurately.
No screen recording, no OBS: the file is identical to the preview and renders about as fast as real time on a desktop GPU (1080p60, with supersampling).

### Batch render (`npm run render`)

Renders stage and match videos without opening the player — like the explainer shorts:
a headless Chrome opens the studio at `#/render` and renders every video frame by frame,
exactly like the player's **Render MP4** button (same reps, same sound). The file is
written to disk while it renders (no size limit), by default to `D:/Dryfire-Videos`,
as 16:9 **and** as a 9:16 short (1080 × 1920): HUD and screens sized to the narrow frame,
the shooter's view a little taller so the targets left and right stay in the picture.

```bash
npm run render                                    # list stages and matches + options
npm run render -- match_001                       # one match, 16:9 + 9:16
npm run render -- match_001,stage_101 --format 16x9 --res 4K
npm run render -- matches                         # every match that is not archived
npm run render -- D:/exports/my_match.json        # a match / stage exported from the studio
```

Options: `--format both|16x9|9x16` · `--res 1080p|1440p|4K` · `--fps 30|60` ·
`--out <folder>` · `--no-voice` · `--timer` · `--fast`.

Quality (also for the player's Render MP4 button): the 3D frame is rendered 2× larger and
scaled down (1.5× above 1440p) — smooth edges, no shimmer or moiré on the barrier mesh while
the camera moves — and encoded at up to 0.3 bit per pixel (≈ 21 Mbit/s at 1080p60, capped at
80 Mbit/s), so the floor and the mesh do not break into blocks in motion. `--fast` skips the
supersampling for a quick look (about 3× quicker). For YouTube, uploading 1440p or 4K also
gets the 1080p viewers a better stream. Stages and matches you made in the browser
are stored in that browser: export them (Export JSON) and pass the file. Needs Chrome
(or set `CHROME_PATH`); 1080p60 renders a little faster than real time, 4K60 at about half speed.

## Online version (GitHub Pages)

Every push to `main` builds the app and publishes it via `.github/workflows/deploy.yml`.
The link is `https://<account>.github.io/<repo>/`. A stage can be opened directly with `#/play/<stageId>` or `#/edit/<stageId>`.

One-time setup on GitHub: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
To make a stage available for everyone, copy its exported JSON into `src/stage3d/stages/`, commit and push.

## 3D assets

* **Look:** the halls are the Blender scenes of `tools/plate-renderer/blender/scene.py`, with light, shadows and
  materials **baked by Cycles** into textures and shown unlit; targets and barriers are the same Blender models, lit
  live with soft shadows.
* **Outdoor ranges:** the grass, berms and ground are **rendered straight down** by Cycles (orthographic, in tiles;
  grass blades, berm shadows and all) and used as the texture of a flat ground plus the berm meshes
  (`env_outdoor_0X.glb`: the bay in 8K, rings at lower resolution out to the horizon; outdoor 04's covered firing line
  is baked geometry). The sky is the HDRI as a tone-mapped panorama (`sky_outdoor_0X.jpg`, `scene.background`); the
  objects are lit by the HDRI's sun (`SUN` in `scene.py`, overcast for 03) plus a sky / ground hemisphere. The grass
  colour seen from above is matched to the plates by `blender/calibrate_grass.py` (`GRASS_GAIN` in `export3d.py`).
  Outdoor 05's steep hillside cannot be textured from above: it is rendered from the shooter's side (12° down) and
  that picture is projected onto it (`backdrop` in `OUTDOOR`, `export3d.py`).
* **Light on the objects outdoors:** the HDRI's sun, a sky / ground hemisphere and a shadowless fill from behind the
  shooter (`LIGHT` in `StageScene3D.ts`), tuned so cardboard and white no-shoots read as clearly as indoors.
* **Files:** `public/3d/*.glb` (+ `sky_*.jpg`), made by `tools/plate-renderer` → `npm run blender3d` (hall bake ≈ 20 min
  on an RTX 2060; `npm run blender3d obj:paper_full` for single objects, `npm run blender3d env:outdoor_02` for one
  outdoor range ≈ 10–30 min, `OUTDOOR_SAMPLES` sets its samples).
* Limits: outdoors the ground is a flat picture of the grass (no blades standing up close to the camera); a sun just
  above the horizon (outdoor 04) lights the objects from 12° so their shadows stay on the stage.

## Structure

```
src/
  stage3d/       types (Stage3D, ENV3D) · repository (built-ins + localStorage, migration) · legacy (old 2.5D format)
                 timeline (briefing, fly-in, reps, camera) · program (match / stage sequence) · StageScene3D (three.js)
                 hud + screens (canvas overlay, part of the MP4) · Player3D · exportVideo · audio · editor/ · stages/*.json
  components/    home/ (start page) · match/ (match page, settings) · training/ · fields (form controls)
  data/          matches/*.json (built-in), matchRepository.ts
  assets/        registry.ts (object catalogue + library icons) · environments.ts (environment list + thumbnails) · audio/ · brand/
  trace/ session/ pose/ motion/ capture/ analytics/   FORTH TRACE (phone tracking + TV)
  utils/         schedule (rep timeline), audioEngine, motion (target motion), matchUtils, matchIO, random
public/3d/       baked environments, objects, sky panoramas
tools/plate-renderer/   Blender scenes and the 3D export
```

## FORTH TRACE · motion tracking (experimental)

The phone films the athlete, MediaPipe Pose runs on the device, and a state machine measures
reaction, time to the presentation zone and stabilisation per rep. A TV browser joins the same
session by room code and shows the stage on the phone's timeline. Architecture, measurement
criteria, web-vs-native assessment and status: **[docs/TRACE_ARCHITECTURE.md](docs/TRACE_ARCHITECTURE.md)** (German).

```bash
npm run dev:lan    # HTTPS on the LAN (phones need HTTPS for the camera) + session relay
npm test           # unit tests (vitest)
npm run models     # copy the MediaPipe runtime + download the pose models into public/ (automatic in dev/build)
```

* Phone: `https://<pc-ip>:5180/#/trace` · TV: `https://<pc-ip>:5180/#/tv/<CODE>` (accept the self-signed certificate on both).
* Everything runs locally: no images or pose data leave the phone; the relay only forwards stage data, timing and result summaries.
* The static GitHub Pages build has no relay: the TV link then only works between tabs of the same browser.
* Times are experimental and not validated against a reference yet. There is no hit detection.

## Training programs (PP1 / NPA)

`#/training` (or **Training** in the top bar) opens two dry-fire training programs on a turning-target simulation:
**PP1 Training** (one target: 25 m 12 reps / 120 s, 15 m 2 rounds × 6 × 2 s, 10 m 3 × 2 s with 2 reps) and
**NPA Training** (LEFT and RIGHT: 25 m, 20 m, 15 m exposures, 10 m). Unofficial dry-fire training simulation —
not affiliated with or endorsed by any shooting association; no shots are detected or scored.

* Every series: task card → READY → short pause (or optional random start delay) → 3…2…1 → start signal → targets →
  end signal → SERIES COMPLETE (NEXT button, or automatic after the configured pause). During a series the screen shows
  only the target(s), the distance and the remaining time.
* Targets turn about their vertical axis; the turn happens outside the visible time, so a 2 s exposure is 2 s fully facing.
* Keys: Space start / pause / resume, F fullscreen (Esc leaves it), M mute, N next, R reset.
* Code (`src/training/`): `config.ts` (all times, one place), `TrainingPhase.ts` (data model), `programs.ts`
  (`PP1Program`, `NPAProgram` — a new discipline is a new object there), `TrainingSequence.ts` (timeline),
  `Timer.ts` (pausable, on the audio clock), `AudioController.ts`, `targets.tsx` (`Target`, `TurningTarget`, the
  target design registry — the built-in neutral geometric target can be replaced by any SVG without touching the logic).
  The gap between exposures and the round pause are training values in `config.ts`, not official values.
