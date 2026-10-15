/**
 * One participant of a training session (phone = controller, TV = renderer).
 * Wraps a transport, tracks the peers in the room and keeps the clocks in
 * sync: the TV pings the controller, the controller answers with its clock.
 */
import { ClockSync } from './clockSync';
import { type Peer, PROTOCOL, type Role, type SessionMessage } from './protocol';
import { BroadcastChannelTransport, type Transport, type TransportStatus, WebSocketTransport, newPeerId } from './transport';

type Outgoing = SessionMessage extends infer M ? (M extends { from: string } ? Omit<M, 'from'> : never) : never;

export interface SessionInfo {
  room: string;
  role: Role;
  kind: Transport['kind'];
  status: TransportStatus;
  detail?: string;
  peers: Peer[];
}

export class SessionClient {
  readonly id = newPeerId();
  readonly sync = new ClockSync();
  private transport: Transport;
  private msgListeners = new Set<(m: SessionMessage) => void>();
  private infoListeners = new Set<(i: SessionInfo) => void>();
  private pingTimer = 0;
  private pingId = 0;
  info: SessionInfo;

  constructor(
    readonly room: string,
    readonly role: Role,
    kind: Transport['kind'],
  ) {
    this.transport = kind === 'websocket' ? new WebSocketTransport(room, role, this.id) : new BroadcastChannelTransport(room, role, this.id);
    this.info = { room, role, kind, status: this.transport.status, peers: [] };
    this.transport.onStatus = (status, detail) => {
      this.update({ status, detail });
      if (status === 'open') this.send({ type: 'hello', role, protocol: PROTOCOL });
    };
    this.transport.onMessage = (m) => this.receive(m);
    if (role === 'tv') this.startPinging();
  }

  private update(p: Partial<SessionInfo>) {
    this.info = { ...this.info, ...p };
    for (const l of this.infoListeners) l(this.info);
  }

  private receive(m: SessionMessage) {
    if (m.type === 'peers') {
      this.update({ peers: m.peers });
      // a new controller joined: its clock is a different one
      if (this.role === 'tv' && !m.peers.some((p) => p.role === 'controller')) this.sync.reset();
    } else if (m.type === 'ping' && this.role === 'controller') {
      this.send({ type: 'pong', to: m.from, id: m.id, t0: m.t0, t1: performance.now() });
      return;
    } else if (m.type === 'pong') {
      if (m.to === this.id) this.sync.add(m.t0, m.t1, performance.now());
      return;
    }
    for (const l of this.msgListeners) l(m);
  }

  private startPinging() {
    let n = 0;
    const tick = () => {
      if (this.info.status === 'open' && this.info.peers.some((p) => p.role === 'controller')) {
        this.send({ type: 'ping', id: ++this.pingId, t0: performance.now() });
        n++;
      }
      // a fast burst first for a quick estimate, then keep tracking drift
      this.pingTimer = window.setTimeout(tick, n < 12 ? 250 : 2000);
    };
    tick();
  }

  get controllers() {
    return this.info.peers.filter((p) => p.role === 'controller' && p.id !== this.id);
  }

  get tvs() {
    return this.info.peers.filter((p) => p.role === 'tv' && p.id !== this.id);
  }

  send(m: Outgoing) {
    this.transport.send({ ...m, from: this.id } as SessionMessage);
  }

  onMessage(fn: (m: SessionMessage) => void) {
    this.msgListeners.add(fn);
    return () => void this.msgListeners.delete(fn);
  }

  onInfo(fn: (i: SessionInfo) => void) {
    this.infoListeners.add(fn);
    fn(this.info);
    return () => void this.infoListeners.delete(fn);
  }

  close() {
    clearTimeout(this.pingTimer);
    this.transport.close();
    this.msgListeners.clear();
    this.infoListeners.clear();
  }
}
