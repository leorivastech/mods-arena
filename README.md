# After Hours / Arena

An automatic rooftop fighter inside T3 Code. All art is drawn locally on canvas; sound is synthesized with WebAudio. No external assets.

## Play

`/fight` opens the pane and joins the queue. Nothing opens at session start. A human rival starts a best-of-three match immediately. After six seconds without a match (including an unreachable server), the house CPU starts automatically. A result lasts 3.3 seconds, saves the record, and returns to waiting and matchmaking. A rival disconnect cancels the fight without changing the record and returns to waiting.

Space: tap to strike, hold to guard, release a full charge for a heavy. Optional arrow movement remains. Sound starts on the first game key press; M toggles it. Escape returns focus to chat. CPU combat pauses in chat; human combat keeps running with local input released. Click the canvas to resume.

Only settings:

- `/fight name <name>` — saves a name (18 characters maximum) and loads its win/loss record.
- `/fight server <ws-url>` — saves a `ws://` or `wss://` endpoint.

There are no menus, buttons, lounge, chat, invitations or appearance settings.

## Run the matchmaking server

Node 20 or newer; the only dependency is `ws`.

```sh
npm install
npm start
```

It listens on `PORT` (8787 by default), answers `GET /` with `ok`, and speaks WebSocket on the same port. Everything is kept in memory: there is no database and no accounts. It runs as is on any host that gives a Node process a port, such as Render's free web service (build `npm install`, start `npm start`).

## Install the mod

Copy the `mod/` folder to `~/.agents/mods/arena/` on a machine running a T3 Code build with mods, then type `/fight`. Point it at your own server with `/fight server wss://your-host`.

## Protocol

JSON over one WebSocket:

- `hello {name}` → `welcome {id}`. The server assigns fighter colors by side; rival look is internal metadata, not a setting or a message to change appearance.
- `queue {}` pairs the next two eligible players → `fight {room, side, rival:{id,name,look}}`, then `round {round,score,startsIn,duration,side}`.
- `leave {}` removes a CPU-bound client from the queue, or cancels its current human match. The other client receives `rivalLeft {}`. Closing the socket does the same.
- `state {x,action,facing,frame,charge}` is relayed at about 30 Hz; received state includes `hp,round`. Rivals interpolate 90 ms in the past.
- `hit {round,attack,kind}` uses a unique attack ID and server-selected damage. The victim resolves guard/invulnerability and reports `health {round,hp,outcome}`; both clients receive the accepted health.
- Server sends `roundEnd {winner,score,hp}`, `matchEnd {won,score}`, then `back {}` after 3.3 seconds. Clients automatically queue again. Round countdown: 1.6 seconds; duration: 45 seconds; round break: 2.5 seconds.

No room snapshots, movement/chat messages, challenges, accept/decline, appearance changes or unused acknowledgements. Maximum 128 connections, 4096-byte payloads, a message rate budget and heartbeat cleanup. Invalid JSON is ignored. This remains client-trusted casual netcode, without authentication or anti-cheat.

## Verification

`node --test server.test.mjs` checks queue, relay, damage constraints, round completion and disconnect handling. `node hook-check.mjs` checks no startup pane and agent events. `node test-real.mjs` drives two isolated Chrome contexts in the running :8478 app, completes human combat through Space inputs, checks automatic CPU/return flows, persistence, keyboard focus, sound state and FPS, and captures evidence in `shots/`. Run a detached copy of `server.mjs` with `PORT=18788` and save its PID in `shots/test-server.pid` first. The suite uses that isolated endpoint so existing clients cannot steal matches; it stops that PID for the offline test. It restores the test threads to the usual 8787 endpoint afterward. It never restarts the dev app. See `REPORT.md` and `shots/simple-results.json` for this run.
