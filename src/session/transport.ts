/**
 * Message transports for a training session.
 *
 *  - WebSocketTransport: through the relay on the Vite dev / preview server
 *    (scripts/trace-relay.mjs) — phone and TV on the same Wi-Fi.
 *  - BroadcastChannelTransport: tabs of the SAME browser on one device, no
 *    server (e.g. the static GitHub Pages build: TV window on a laptop + a
 *    second tab). Cannot reach another device.
 */
import { type Peer, type Role, type SessionMessage, isMessage } from './protocol';

export type TransportStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface Transport {
  readonly kind: 'websocket' | 'broadcast';
  status: TransportStatus;
  send(msg: SessionMessage): void;
  close(): void;
  onMessage?: (msg: SessionMessage) => void;
  onStatus?: (s: TransportStatus, detail?: string) => void;
}

export const RELAY_PATH = '/__trace';

export class WebSocketTransport implements Transport {
  readonly kind = 'websocket';
  status: TransportStatus = 'connecting';
  onMessage?: (msg: SessionMessage) => void;
  onStatus?: (s: TransportStatus, detail?: string) => void;
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private timer = 0;

  constructor(
    private room: string,
    private role: Role,
    private peerId: string,
    private base = location.origin,
  ) {
    this.connect();
  }

  private connect() {
    const url = new URL(RELAY_PATH, this.base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = new URLSearchParams({ room: this.room, role: this.role, id: this.peerId }).toString();
    const ws = new WebSocket(url);
    this.ws = ws;
    this.set('connecting');
    ws.onopen = () => {
      this.retry = 0;
      this.set('open');
    };
    ws.onmessage = (e) => {
      try {
        const m: unknown = JSON.parse(String(e.data));
        if (isMessage(m)) this.onMessage?.(m);
      } catch {
        /* not ours */
      }
    };
    ws.onclose = (e) => {
      if (this.closed) return this.set('closed');
      // 4000..4099 = relay refused the join: retrying would not help
      if (e.code >= 4000 && e.code < 4100) return this.set('error', e.reason);
      this.set('connecting', 'reconnecting');
      this.timer = window.setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.retry++));
    };
    ws.onerror = () => {
      /* onclose follows and handles the retry */
    };
  }

  private set(s: TransportStatus, detail?: string) {
    this.status = s;
    this.onStatus?.(s, detail);
  }

  send(msg: SessionMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }
}

/** Same-browser fallback; emulates the relay's `peers` message with a presence heartbeat. */
export class BroadcastChannelTransport implements Transport {
  readonly kind = 'broadcast';
  status: TransportStatus = 'open';
  onMessage?: (msg: SessionMessage) => void;
  onStatus?: (s: TransportStatus, detail?: string) => void;
  private ch: BroadcastChannel;
  private seen = new Map<string, { role: Role; at: number }>();
  private timer: number;

  constructor(room: string, private role: Role, private peerId: string) {
    this.ch = new BroadcastChannel(`forth-trace:${room}`);
    this.ch.onmessage = (e) => {
      const m = e.data as unknown;
      if (m && typeof m === 'object' && (m as { type?: string }).type === '__presence') {
        const p = m as { id: string; role: Role; bye?: boolean };
        if (p.bye) this.seen.delete(p.id);
        else this.seen.set(p.id, { role: p.role, at: Date.now() });
        this.emitPeers();
        return;
      }
      if (isMessage(m)) this.onMessage?.(m);
    };
    const beat = () => {
      this.ch.postMessage({ type: '__presence', id: this.peerId, role: this.role });
      const now = Date.now();
      for (const [id, p] of this.seen) if (now - p.at > 5000) this.seen.delete(id);
      this.emitPeers();
    };
    beat();
    this.timer = window.setInterval(beat, 2000);
    queueMicrotask(() => this.onStatus?.('open'));
  }

  private emitPeers() {
    const peers: Peer[] = [{ id: this.peerId, role: this.role }, ...[...this.seen].map(([id, p]) => ({ id, role: p.role }))];
    this.onMessage?.({ type: 'peers', peers });
  }

  send(msg: SessionMessage) {
    this.ch.postMessage(msg);
  }

  close() {
    clearInterval(this.timer);
    this.ch.postMessage({ type: '__presence', id: this.peerId, role: this.role, bye: true });
    this.ch.close();
    this.status = 'closed';
  }
}

/** Is the relay reachable from this page? (It only exists on the dev / preview server.) */
export const probeRelay = (timeoutMs = 2500): Promise<boolean> =>
  new Promise((resolve) => {
    let done = false;
    const url = new URL(RELAY_PATH, location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = new URLSearchParams({ room: 'PROBE', role: 'tv', id: `probe-${Math.random().toString(36).slice(2, 8)}` }).toString();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return resolve(false);
    }
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      ws.close();
      resolve(ok);
    };
    ws.onopen = () => finish(true);
    ws.onerror = () => finish(false);
    setTimeout(() => finish(false), timeoutMs);
  });

export const newRoomCode = () => {
  // no 0/O/1/I: codes are typed on a TV remote
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => A[b % A.length]).join('');
};

export const newPeerId = () => `p-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
