import { describe, expect, it } from 'vitest';
import { createStage3D } from '../repository';
import { ENV3D } from '../types';
import { addObject, addPosition, duplicateObjects, groupObjects, insertVia, moveObjects, moveVia, removePosition, removeVia, ungroupObjects, withGroups } from './ops';

describe('3D editor ops', () => {
  it('adds and moves objects, kept inside the hall', () => {
    const { stage, id } = addObject(createStage3D(), 'mesh_wall', 2, 6, { yaw: 90 });
    expect(stage.objects.find((o) => o.id === id)).toMatchObject({ type: 'mesh_wall', x: 2, d: 6, yaw: 90 });
    const moved = moveObjects(stage, [id], 100, 0.5);
    const o = moved.objects.find((x) => x.id === id)!;
    expect(o.x).toBeLessThanOrEqual(ENV3D.indoor_01.x1);
    expect(o.d).toBeCloseTo(6.5, 6);
  });

  it('duplicates with new ids', () => {
    const s = createStage3D();
    const ids = s.objects.slice(0, 2).map((o) => o.id);
    const r = duplicateObjects(s, ids);
    expect(r.stage.objects).toHaveLength(s.objects.length + 2);
    expect(r.ids.some((id) => ids.includes(id))).toBe(false);
  });

  it('adds positions with legs and relabels', () => {
    let s = createStage3D();
    s = addPosition(s, 3, 4).stage;
    s = addPosition(s, -2, 6).stage;
    expect(s.positions.map((p) => p.label)).toEqual(['START', 'P2', 'P3']);
    expect(s.legs).toHaveLength(2);
    // removing P2 joins START → P3 with one leg
    const r = removePosition(s, 1);
    expect(r.positions.map((p) => p.label)).toEqual(['START', 'P2']);
    expect(r.legs).toHaveLength(1);
    // the start cannot be removed when it is alone
    expect(removePosition(createStage3D(), 0).positions).toHaveLength(1);
  });

  it('groups objects; one member selects the group; copies get a new group', () => {
    const s = createStage3D();
    const [a, b, c] = s.objects.map((o) => o.id);
    const g = groupObjects(s, [a, b]);
    expect(withGroups(g, [a])).toEqual([a, b]);
    expect(withGroups(g, [c])).toEqual([c]);
    const dup = duplicateObjects(g, [a, b]);
    const copies = dup.stage.objects.filter((o) => dup.ids.includes(o.id));
    expect(new Set(copies.map((o) => o.group)).size).toBe(1);
    expect(copies[0].group).not.toBe(g.objects[0].group);
    expect(withGroups(ungroupObjects(g, [a, b]), [a])).toEqual([a]);
  });

  it('keeps objects inside the room of the chosen environment', () => {
    const narrow = { ...createStage3D(), environment: 'indoor_03' as const };
    const { stage, id } = addObject(narrow, 'paper_full', 7, 50);
    const o = stage.objects.find((x) => x.id === id)!;
    expect(o.x).toBeLessThanOrEqual(ENV3D.indoor_03.x1);
    expect(o.d).toBeLessThan(ENV3D.indoor_03.d1);
  });

  it('inserts corner points in the closest segment, moves and removes them', () => {
    let s = addPosition(createStage3D(), 4, 0).stage; // START (0,0) → P2 (4,0)
    s = insertVia(s, 0, 2, 1); // between
    s = insertVia(s, 0, 3.5, 0.5); // between via and P2
    expect(s.legs[0].via).toEqual([{ x: 2, d: 1 }, { x: 3.5, d: 0.5 }]);
    s = moveVia(s, 0, 0, 1, 2);
    expect(s.legs[0].via![0]).toEqual({ x: 1, d: 2 });
    s = removeVia(removeVia(s, 0, 0), 0, 0);
    expect(s.legs[0].via).toBeUndefined();
  });
});
