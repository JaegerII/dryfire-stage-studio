/**
 * FORTH TRACE session relay — a tiny WebSocket room server that lets the phone
 * (controller + camera) and the TV browser join the same training session on
 * the local network. It only forwards JSON messages between the peers of one
 * room; it never sees video or pose data (that stays on the phone).
 *
 * Mounted on the Vite dev / preview server (same origin, same HTTPS cert), path
 * `/__trace?room=<CODE>&role=<controller|tv>&id=<peerId>`.
 */
import { WebSocketServer } from 'ws';

export const RELAY_PATH = '/__trace';
const MAX_MESSAGE = 512 * 1024; // a stage JSON is a few KB; keep a hard ceiling
const MAX_ROOMS = 64;
const MAX_PEERS = 8;
const ROOM_RE = /^[A-Z0-9]{3,8}$/;

export const createRelay = () => {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
  /** room code → peers */
  const rooms = new Map();

  const peerList = (room) => [...room].map((p) => ({ id: p.peerId, role: p.role }));
  const broadcastPeers = (code) => {
    const room = rooms.get(code);
    if (!room) return;
    const msg = JSON.stringify({ type: 'peers', peers: peerList(room) });
    for (const p of room) if (p.readyState === p.OPEN) p.send(msg);
  };

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    const code = (url.searchParams.get('room') ?? '').toUpperCase();
    const role = url.searchParams.get('role');
    const id = url.searchParams.get('id') ?? '';
    if (!ROOM_RE.test(code) || (role !== 'controller' && role !== 'tv') || !/^[\w-]{4,40}$/.test(id)) {
      ws.close(4000, 'bad join parameters');
      return;
    }
    if (!rooms.has(code) && rooms.size >= MAX_ROOMS) return ws.close(4001, 'relay full');
    const room = rooms.get(code) ?? new Set();
    if (room.size >= MAX_PEERS) return ws.close(4002, 'room full');
    rooms.set(code, room);
    Object.assign(ws, { peerId: id, role, alive: true });
    room.add(ws);
    broadcastPeers(code);

    ws.on('pong', () => (ws.alive = true));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      // forward verbatim to every other peer of the room
      for (const p of room) if (p !== ws && p.readyState === p.OPEN) p.send(data.toString());
    });
    ws.on('close', () => {
      room.delete(ws);
      if (!room.size) rooms.delete(code);
      else broadcastPeers(code);
    });
  });

  // drop dead peers (phone went to sleep, TV tab closed without a close frame)
  const heartbeat = setInterval(() => {
    for (const room of rooms.values())
      for (const p of room) {
        if (!p.alive) p.terminate();
        else {
          p.alive = false;
          p.ping();
        }
      }
  }, 10_000);
  heartbeat.unref(); // never keep the process alive on its own (vitest, build)
  wss.on('close', () => clearInterval(heartbeat));

  /** Attach to a Node http(s) server; other upgrade requests (Vite HMR) are left alone. */
  const attach = (server) => {
    server?.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith(RELAY_PATH)) return;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
  };
  return { attach, close: () => wss.close() };
};

/** Vite plugin: the relay runs inside `vite` (dev) and `vite preview`. */
export const traceRelayPlugin = () => {
  const relay = createRelay();
  return {
    name: 'forth-trace-relay',
    configureServer(server) {
      relay.attach(server.httpServer);
    },
    configurePreviewServer(server) {
      relay.attach(server.httpServer);
    },
  };
};
