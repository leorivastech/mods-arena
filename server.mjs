import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const port = Number(process.env.PORT || 8787);
const server = http.createServer((req, res) => {
  res.writeHead(req.url === '/' ? 200 : 404, { 'Content-Type': 'text/plain' });
  res.end(req.url === '/' ? 'ok' : 'not found');
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const clients = new Map(), rooms = new Map();
let queue = [];
const send = (p, data) => { if (p?.ws.readyState === WebSocket.OPEN && p.ws.bufferedAmount < 65536) p.ws.send(JSON.stringify(data)); };
const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min;
const label = (s, n) => typeof s === 'string' ? s.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, n) : '';
const look = v => ({ palette: Math.round(finite(v?.palette, 0, 2)) });
const publicPlayer = p => ({ id: p.id, name: p.name, look: p.look });
function unqueue(p) { queue = queue.filter(id => id !== p.id); }
function roundStart(r) {
  r.round++; r.hp = [100, 100]; r.hits = [new Set(), new Set()]; r.states = [null, null]; r.lastAttack = [0, 0];
  r.phase = 'active'; r.startsAt = Date.now() + 1600; r.endsAt = r.startsAt + 45000;
  r.players.forEach((p, side) => send(p, { type: 'round', round: r.round, score: r.score, startsIn: 1600, duration: 45, side }));
}
function startFight(a, b) {
  if (!a?.ready || !b?.ready || a === b || a.room || b.room) return;
  unqueue(a); unqueue(b);
  const r = { id: randomUUID(), players: [a, b], score: [0, 0], round: 0, phase: 'active' };
  rooms.set(r.id, r);
  r.players.forEach((p, side) => { p.look = look({palette:side}); });
  r.players.forEach((p, side) => {
    p.room = r.id; p.side = side;
    send(p, { type: 'fight', room: r.id, side, rival: publicPlayer(r.players[1 - side]) });
  });
  roundStart(r);
}
function finishRound(r, winner) {
  if (r.phase !== 'active') return;
  r.phase = 'between'; r.nextAt = Date.now() + 2500;
  if (winner !== null) r.score[winner]++;
  r.players.forEach(p => send(p, { type: 'roundEnd', winner, score: r.score, hp: r.hp }));
  if (r.score.some(v => v >= 2)) {
    r.phase = 'finished'; r.nextAt = Date.now() + 3300;
    r.players.forEach((p, side) => send(p, { type: 'matchEnd', won: side === winner, score: r.score }));
  }
}
function leave(p) {
  unqueue(p);
  const r = rooms.get(p.room);
  if (r) {
    rooms.delete(r.id);
    for (const other of r.players) { other.room = null; if (other !== p) send(other, { type: 'rivalLeft' }); }
  }
  p.room = null;
}
wss.on('connection', ws => {
  if (clients.size >= 128) { ws.close(1013, 'Room full'); return; }
  const p = { ws, id: randomUUID().slice(0, 8), ready: false, name: '', look: look(), room: null, budget: 140, budgetAt: Date.now(), alive: true };
  clients.set(p.id, p);
  ws.on('pong', () => { p.alive = true; });
  ws.on('error', () => {});
  ws.on('close', () => { leave(p); clients.delete(p.id); });
  ws.on('message', (raw, binary) => {
    const now = Date.now();
    p.budget = Math.min(140, p.budget + (now - p.budgetAt) * .07); p.budgetAt = now;
    if (--p.budget < 0 || binary) { ws.close(1008, 'Message rate'); return; }
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    if (m.type === 'hello') {
      p.name = label(m.name, 18) || 'Wanderer'; p.ready = true;
      send(p, { type: 'welcome', id: p.id }); return;
    }
    if (!p.ready) return;
    if (m.type === 'queue' && !p.room) {
      unqueue(p); queue = queue.filter(id => clients.get(id)?.ready && !clients.get(id).room);
      const rival = clients.get(queue.shift()); if (rival) startFight(rival, p); else queue.push(p.id);
    } else if (m.type === 'leave') leave(p);
    else if (p.room) {
      const r = rooms.get(p.room); if (!r || r.phase !== 'active' || now < r.startsAt) return;
      const side = p.side, rival = r.players[1 - side];
      if (m.type === 'state') {
        const actions = ['idle','step','strike','guard','charge','heavy','break','hit','ko','victory'];
        const state = { x: finite(m.x, 24, 360), hp: r.hp[side], action: actions.includes(m.action) ? m.action : 'idle', facing: m.facing === -1 ? -1 : 1, frame: finite(m.frame, 0, 10), charge: finite(m.charge, 0, 1) };
        r.states[side] = state; send(rival, { type: 'state', ...state, round: r.round });
      } else if (m.type === 'hit' && m.round === r.round && (m.kind === 'strike' || m.kind === 'heavy') && Number.isSafeInteger(m.attack) && m.attack >= 0) {
        // Unique attack IDs and a minimum recovery; clients resolve guard/invulnerability.
        if (r.hits[side].has(m.attack) || now - r.lastAttack[side] < 260 || r.hits[side].size > 256) return;
        r.hits[side].add(m.attack); r.lastAttack[side] = now;
        send(rival, { type: 'hit', attack: m.attack, round: r.round, kind: m.kind, dmg: m.kind === 'heavy' ? 28 : 12 });
      } else if (m.type === 'health' && m.round === r.round) {
        r.hp[side] = Math.min(r.hp[side], finite(m.hp, 0, 100));
        r.players.forEach(q => send(q, { type: 'health', side, hp: r.hp[side], round: r.round, outcome: label(m.outcome, 12) }));
        if (r.hp[side] <= 0) finishRound(r, 1 - side);
      }
    }
  });
});
const tick = setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (r.phase === 'active' && now >= r.endsAt) finishRound(r, r.hp[0] === r.hp[1] ? null : r.hp[0] > r.hp[1] ? 0 : 1);
    else if (r.phase === 'between' && now >= r.nextAt) roundStart(r);
    else if (r.phase === 'finished' && now >= r.nextAt) { rooms.delete(r.id); r.players.forEach(p => { p.room = null; send(p, { type: 'back' }); }); }
  }
}, 100);
const heartbeat = setInterval(() => { for (const p of clients.values()) { if (!p.alive) p.ws.terminate(); else { p.alive = false; p.ws.ping(); } } }, 15000);
server.listen(port, '0.0.0.0', () => console.log(`Arena listening on ${port}; PID ${process.pid}`));
function shutdown() { clearInterval(tick); clearInterval(heartbeat); for (const p of clients.values()) p.ws.close(1001, 'Restarting'); wss.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
