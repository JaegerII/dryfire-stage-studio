/**
 * Match storage — same pattern as stageRepository: built-in JSON files in
 * ./matches plus the browser's localStorage, behind one interface so a
 * server implementation can replace it later.
 */
import { MATCH_SCHEMA_VERSION, type Match } from '../types/match';
import { newId } from '../utils/random';

export interface MatchRepository {
  list(): (Match & { builtIn: boolean; overridesBuiltIn: boolean })[];
  get(id: string): Match | undefined;
  save(match: Match): Match;
  remove(id: string): void;
}

export const normalizeMatch = (raw: unknown): Match => {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(r as unknown as Match),
    schemaVersion: MATCH_SCHEMA_VERSION,
    id: typeof r.id === 'string' && r.id ? r.id : newId('match'),
    name: typeof r.name === 'string' && r.name ? r.name : 'Match',
    stageIds: Array.isArray(r.stageIds) ? r.stageIds.filter((x): x is string => typeof x === 'string') : [],
  };
};

const BUILT_IN: Match[] = Object.values(
  import.meta.glob<Match>('./matches/*.json', { eager: true, import: 'default' }),
).map(normalizeMatch);

const KEY = 'dryfire-stage-studio.matches.v1';

export class LocalMatchRepository implements MatchRepository {
  private read(): Record<string, Match> {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  private write(all: Record<string, Match>) {
    localStorage.setItem(KEY, JSON.stringify(all));
  }

  list() {
    const local = this.read();
    const isBuiltIn = (id: string) => BUILT_IN.some((m) => m.id === id);
    const own = Object.values(local)
      .map((m) => ({ ...normalizeMatch(m), builtIn: false, overridesBuiltIn: isBuiltIn(m.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const builtIn = BUILT_IN.filter((m) => !local[m.id]).map((m) => ({ ...structuredClone(m), builtIn: true, overridesBuiltIn: false }));
    return [...own, ...builtIn];
  }

  get(id: string) {
    const local = this.read()[id];
    if (local) return normalizeMatch(local);
    const b = BUILT_IN.find((m) => m.id === id);
    return b ? structuredClone(b) : undefined;
  }

  save(match: Match) {
    const saved: Match = { ...match, meta: { ...match.meta, updatedAt: new Date().toISOString() } };
    const all = this.read();
    all[match.id] = saved;
    this.write(all);
    return saved;
  }

  remove(id: string) {
    const all = this.read();
    delete all[id];
    this.write(all);
  }
}

export const matchRepository: MatchRepository = new LocalMatchRepository();

export const createMatch = (): Match => ({
  schemaVersion: MATCH_SCHEMA_VERSION,
  id: newId('match'),
  name: 'New Match',
  stageIds: [],
  meta: { createdAt: new Date().toISOString() },
});
