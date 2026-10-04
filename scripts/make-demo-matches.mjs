// Generates the two demo matches (match_002, match_003) and their stages.
// Positions are given in meters (x right, z downrange from the start box) and
// converted with the plate camera (horizon 0.4, eye height 1.5 m, focal 1.4).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const conv = (x, z) => {
  const d = z + 2.2;
  return { x: +(0.5 + (0.7875 * x) / d).toFixed(4), y: +(0.4 + 2.1 / d).toFixed(4) };
};
let n = 0;
const o = (type, x, z, extra = {}) => ({ id: `${type}_${++n}`, type, ...conv(x, z), scale: 1, rotation: 0, zIndex: 0, ...extra });
const start = () => ({ id: 'start_box', type: 'start_box', x: 0.5, y: 0.97, scale: 1, rotation: 0, zIndex: 0 });
const stage = (id, name, description, environment, parTime, objects, meta) => ({
  schemaVersion: 1,
  id,
  name,
  description,
  environment,
  parTime,
  repetitions: 5,
  resetTime: 3,
  standbyDelay: { min: 1, max: 2 },
  objects: [start(), ...objects],
  view: { zoom: 1.25 },
  meta: { author: 'FORTH TRACE', discipline: 'handgun', ...meta },
});

const stages = [];
const add = (s) => {
  stages.push(s);
  n = 0;
  return s.id;
};

// ------------------------------------------------------------------ Match 02 – Steel & Activators
const m2 = [];
n = 0;
m2.push(
  add(
    stage('stage_101', 'Box Drill', 'Two cards on a wide box, then swing out to paper and steel.', 'outdoor_03', 5.5, [
      o('crate_wide', -2.3, 6.8),
      o('paper_card', -2.6, 6.8, { elevation: 0.6, rotation: -3 }),
      o('paper_hc_half_card', -2.0, 6.8, { elevation: 0.6, rotation: 4 }),
      o('paper_full', 0.2, 10.5),
      o('steel_popper', -0.7, 13),
      o('paper_hc_vertical', 3.0, 7.4),
      o('mesh_wall_diagonal', 1.4, 7.6, { yaw: -35 }),
    ], { difficulty: 'beginner', tags: ['boxes', 'hard cover'] }),
  ),
);
n = 0;
m2.push(
  add(
    stage('stage_102', 'Activator', 'Hit the popper — the swinger behind the wall starts rocking.', 'outdoor_01', 6.5, (() => {
      const popper = o('steel_popper', 0.5, 12, { motion: { kind: 'fall', delay: 1.2 } });
      return [
        o('paper_full', -3.0, 6.8),
        popper,
        o('paper_swinger', -1.3, 9.2, { motion: { kind: 'swing', angle: 40, period: 1.5, trigger: popper.id, delay: 0 } }),
        o('mesh_wall_short', -1.3, 8.9),
        o('paper_stack', 2.4, 7.6),
        o('steel_plate', 1.6, 12.5),
      ];
    })(), { difficulty: 'intermediate', tags: ['activator', 'swinger', 'steel'] }),
  ),
);
n = 0;
m2.push(
  add(
    stage('stage_103', 'Plate Rack Finish', 'Paper left and right, one through the port, finish on the plate rack.', 'indoor_03', 7, [
      o('paper_full', -0.9, 7.6),
      o('paper_hc_bottom', 2.0, 7),
      o('mesh_wall_port', -2.6, 6.2),
      o('paper_full', -3.69, 8.6), // lined up with the port (seen only through the slot)
      o('steel_plate_rack', 0.3, 12),
    ], { difficulty: 'intermediate', tags: ['plate rack', 'port'] }),
  ),
);

// ------------------------------------------------------------------ Match 03 – Indoor Movers
const m3 = [];
n = 0;
m3.push(
  add(
    stage('stage_201', 'Swinger Lane', 'A swinger rocks behind the wall from the start beep — time your shots.', 'indoor_02', 6, [
      o('paper_hc_vertical', -2.6, 6.6),
      o('mesh_wall', 0, 7.2),
      o('paper_swinger', 0, 7.6, { motion: { kind: 'swing', angle: 40, period: 1.4, delay: 0 } }),
      o('steel_popper', -2.3, 12.5),
      o('paper_hc_diagonal', 2.6, 6.6, { flip: true }),
      o('no_shoot', 2.9, 6.3),
    ], { difficulty: 'intermediate', tags: ['swinger', 'hard cover'] }),
  ),
);
n = 0;
m3.push(
  add(
    stage('stage_202', 'Window & Port', 'One target through the window, one through the port, steel to finish.', 'indoor_01', 6.5, [
      o('paper_stack', -3.1, 7),
      o('mesh_wall_window', -1.0, 6.6),
      o('paper_full', -1.0, 8.6),
      o('mesh_wall_port', 1.9, 6.6),
      o('paper_full', 1.64, 8.4),
      o('steel_plate', 3.3, 12),
    ], { difficulty: 'advanced', tags: ['window', 'port', 'partial'] }),
  ),
);
n = 0;
m3.push(
  add(
    stage('stage_203', 'Pop-up Finale', 'Hit the popper — a target appears behind the diagonal wall.', 'indoor_03', 7, (() => {
      const popper = o('steel_popper', 0, 12.5, { motion: { kind: 'fall', delay: 1.4 } });
      return [
        o('paper_hc_vertical', -2.5, 7),
        o('paper_mini', -1.0, 10),
        popper,
        o('mesh_wall_diagonal', 2.2, 7.6, { flip: true }),
        o('paper_full', 2.3, 9.4, { motion: { kind: 'appear', trigger: popper.id, delay: 0.3 } }),
        o('crate', 0.9, 6.4),
        o('paper_hc_half_card', 0.9, 6.4, { elevation: 0.6, flip: true }),
      ];
    })(), { difficulty: 'advanced', tags: ['activator', 'pop-up', 'mini'] }),
  ),
);

// ------------------------------------------------------------------ Match 04 – Outdoor Classics
const m4 = [];
n = 0;
m4.push(
  add(
    stage('stage_301', 'El Prez Style', 'Three paper side by side, then steel left and right in depth.', 'outdoor_02', 5, [
      o('paper_full', -1.2, 9),
      o('paper_full', 0, 9),
      o('paper_full', 1.2, 9),
      o('steel_popper', -2.8, 12.5),
      o('steel_plate', 2.8, 12.5),
    ], { difficulty: 'beginner', tags: ['transitions', 'steel'] }),
  ),
);
n = 0;
m4.push(
  add(
    stage('stage_302', 'Slider', 'A mover slides behind two walls — catch it in the gap.', 'outdoor_03', 6.5, [
      o('crate', -3.0, 6.8),
      o('paper_card', -3.0, 6.8, { elevation: 0.6 }),
      o('paper_full', 0, 10, { motion: { kind: 'horizontal', amplitude: 1.3, period: 3.2, delay: 0 } }),
      o('mesh_wall_short', -1.05, 8.2),
      o('mesh_wall_short', 1.05, 8.2),
      o('paper_hc_bottom', 3.0, 7),
      o('steel_popper', 3.2, 14),
    ], { difficulty: 'intermediate', tags: ['mover', 'boxes'] }),
  ),
);
n = 0;
m4.push(
  add(
    stage('stage_303', 'Long Steel', 'One close paper, then steel at distance — plate rack to finish.', 'outdoor_01', 7, [
      o('paper_full', -1.8, 6.4),
      o('steel_popper', -4.2, 14),
      o('steel_plate', 2.9, 13.5),
      o('steel_popper', 1.6, 15),
      o('steel_plate_rack', -0.2, 15.5),
    ], { difficulty: 'intermediate', tags: ['steel', 'plate rack', 'distance'] }),
  ),
);

// ------------------------------------------------------------------ Match 05 – Indoor Tactics
const m5 = [];
n = 0;
m5.push(
  add(
    stage('stage_401', 'Flash Target', 'Hit the popper — a target pops up for only 1.5 seconds.', 'indoor_03', 6, (() => {
      const popper = o('steel_popper', -1.4, 12.5, { motion: { kind: 'fall', delay: 1.0 } });
      return [
        o('paper_hc_vertical', -2.5, 7),
        popper,
        o('paper_full', 1.5, 10.5, { motion: { kind: 'popup', trigger: popper.id, delay: 0.2, duration: 1.5 } }),
        o('paper_stack_double', 0.2, 8),
        o('paper_mini', 2.7, 7.2),
      ];
    })(), { difficulty: 'advanced', tags: ['activator', 'pop-up', 'disappearing'] }),
  ),
);
n = 0;
m5.push(
  add(
    stage('stage_402', 'Twin Ports', 'Two ports, one target behind each, hard cover and steel in the middle.', 'indoor_02', 6.5, [
      o('mesh_wall_port', -1.6, 6.6),
      o('paper_full', -2.34, 8.8), // seen through the left port
      o('mesh_wall_port', 1.6, 6.6, { flip: true }),
      o('paper_full', 2.34, 8.8), // seen through the right port
      o('paper_hc_half', 0, 9.6),
      o('steel_plate', 0.85, 13),
    ], { difficulty: 'advanced', tags: ['port', 'partial', 'hard cover'] }),
  ),
);
n = 0;
m5.push(
  add(
    stage('stage_403', 'Box Row', 'Cards on boxes, a swinger behind the wall, steel to finish.', 'indoor_01', 7, [
      o('paper_full', -3.3, 9.5),
      o('crate_wide', -1.6, 7),
      o('paper_hc_vertical_card', -1.95, 7, { elevation: 0.6 }),
      o('no_shoot_overlay', -1.35, 7, { elevation: 0.6, rotation: 8 }),
      o('mesh_wall', 0.4, 9.6),
      o('paper_swinger', 0.4, 10, { motion: { kind: 'swing', angle: 35, period: 1.8, delay: 0 } }),
      o('crate', 1.9, 7),
      o('paper_hc_diagonal_card', 1.9, 7, { elevation: 0.6 }),
      o('steel_popper', 4.4, 12.5),
    ], { difficulty: 'intermediate', tags: ['boxes', 'swinger', 'hard cover'] }),
  ),
);

for (const s of stages) writeFileSync(join(root, 'stages', `${s.id}.json`), JSON.stringify(s, null, 2) + '\n');

const matches = [
  { id: 'match_002', name: 'Match 02 – Steel & Activators', description: 'Boxes, an activated swinger and a plate rack finish.', stageIds: m2 },
  { id: 'match_003', name: 'Match 03 – Indoor Movers', description: 'A swinger behind a wall, window and port, a pop-up finale.', stageIds: m3 },
  { id: 'match_004', name: 'Match 04 – Outdoor Classics', description: 'El Prez style, a sliding mover and long steel.', stageIds: m4 },
  { id: 'match_005', name: 'Match 05 – Indoor Tactics', description: 'A flash target, twin ports and a row of boxes.', stageIds: m5 },
];
for (const m of matches) {
  writeFileSync(
    join(root, 'matches', `${m.id}.json`),
    JSON.stringify({ schemaVersion: 1, ...m, meta: { author: 'FORTH TRACE', tags: ['demo'] } }, null, 2) + '\n',
  );
}
console.log(`wrote ${stages.length} stages, ${matches.length} matches`);
