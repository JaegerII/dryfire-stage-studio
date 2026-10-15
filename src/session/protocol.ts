/**
 * Messages between the phone (controller: camera + analysis + run control)
 * and the TV (renderer). Only stage data, timing and result summaries are
 * exchanged — never video or pose data.
 *
 * Clocks: every time value is on the SENDER's performance clock (ms) unless
 * noted. The TV converts controller times with its clock-sync offset.
 */
import type { Stage3D } from '../stage3d/types';

export const PROTOCOL = 1;

export type Role = 'controller' | 'tv';

export interface Peer {
  id: string;
  role: Role;
}

export type AudioOutput = 'tv' | 'phone' | 'both';

export interface RunPlan {
  runId: string;
  stage: Stage3D;
  /** Seed for buildSchedule — both sides compute the identical rep timeline from it. */
  seed: string;
  lead: number;
  voiceLead: number;
  /** Controller clock: when t = 0 of the schedule happens. */
  startAt: number;
  audio: AudioOutput;
  voice: boolean;
  showTimer: boolean;
}

/** Short per-rep summary for the TV overlay (the full data stays on the phone). */
export interface RepSummary {
  rep: number;
  status: string;
  presentationMs?: number;
  totalMs?: number;
  reactionMs?: number;
  uncertaintyMs?: number;
  earlyMovement: boolean;
}

export type SessionMessage =
  | { type: 'hello'; from: string; role: Role; protocol: number; name?: string }
  | { type: 'ping'; from: string; id: number; t0: number }
  | { type: 'pong'; from: string; to: string; id: number; t0: number; t1: number }
  | { type: 'stage'; from: string; stage: Stage3D | null }
  | { type: 'run_start'; from: string; plan: RunPlan }
  | { type: 'run_stop'; from: string; runId: string }
  | { type: 'rep_result'; from: string; runId: string; summary: RepSummary }
  | {
      type: 'tv_status';
      from: string;
      state: 'idle' | 'stage' | 'running' | 'complete';
      soundEnabled: boolean;
      /** Clock sync quality as the TV sees it. */
      sync: { offset: number; uncertainty: number; rtt: number } | null;
      /** Audio output latency the TV browser reports, ms (excludes HDMI / TV processing). */
      outputLatencyMs: number | null;
    }
  /** Sent by the relay itself. */
  | { type: 'peers'; peers: Peer[] };

export const isMessage = (v: unknown): v is SessionMessage => !!v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string';
