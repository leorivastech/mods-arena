import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const delay = ms => new Promise(r => setTimeout(r, ms));
test('JSON validation, queue, relay, round and disconnect', async t => {
  const port = 18787;
  const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sockets = [];
  t.after(async () => { sockets.forEach(s => s.close()); child.kill('SIGTERM'); await delay(100); });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error('Server exited ' + code)); }); });
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'ok');
  async function player(name) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`), messages = [];
    sockets.push(ws); ws.on('message', d => messages.push(JSON.parse(d)));
    await new Promise(resolve => ws.once('open', resolve));
    const send = m => ws.send(JSON.stringify(m));
    const next = async (type, predicate = () => true) => { const until=Date.now()+4000; while(Date.now()<until){const i=messages.findIndex(m=>m.type===type&&predicate(m));if(i>=0)return messages.splice(i,1)[0];await delay(10);}throw Error('No '+type); };
    ws.send('invalid json'); send({type:'hello',name,look:{palette:99}});
    return {ws,send,next,id:(await next('welcome')).id};
  }
  const a=await player('A'), b=await player('B');
  a.send({type:'queue'});b.send({type:'queue'});const fa=await a.next('fight'),fb=await b.next('fight');assert.equal(fa.room,fb.room);assert.notEqual(fa.side,fb.side);
  const round=await a.next('round');await b.next('round');await delay(1650);
  a.send({type:'state',x:180,action:'strike',facing:1,frame:1,charge:0});assert.equal((await b.next('state')).x,180);
  a.send({type:'hit',round:round.round,attack:1,kind:'heavy',dmg:999});assert.equal((await b.next('hit')).dmg,28);
  a.send({type:'hit',round:round.round,attack:1,kind:'heavy'});await delay(80);
  // A victim's health report is the protocol's round-ending source of truth.
  b.send({type:'health',round:round.round,hp:0,outcome:'hit'});assert.equal((await a.next('roundEnd')).winner,fa.side);
  b.ws.close();await a.next('rivalLeft');
  a.send({type:'queue'});const c=await player('C');c.send({type:'queue'});await a.next('fight');await c.next('fight');c.send({type:'leave'});await a.next('rivalLeft');
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status,200);
});
