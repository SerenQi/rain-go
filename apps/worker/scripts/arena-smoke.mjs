// Run against a local Worker with PUBLIC_ARENA=1: node scripts/arena-smoke.mjs
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const base = process.env.BASE ?? 'http://127.0.0.1:8788';
const create = await fetch(`${base}/api/arena/games`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ names: ['API test', 'MCP test'] }) });
assert.equal(create.status, 201);
const { match, invites } = await create.json();
assert.equal(match.informationMode, 'equal');
const id = match.id;
const token = new URL(invites[0].link).pathname.split('/').pop();
const friendToken = new URL(invites[1].link).pathname.split('/').pop();
const client = new Client({ name: 'arena-smoke', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(invites[0].link)));
try {
  const state = await (await fetch(`${base}/api/arena/${id}/state`, { headers: { 'x-seat': token } })).json();
  const mcp = await client.callTool({ name: 'get_state', arguments: {} });
  assert.equal(state.state, mcp.content[0].text, 'browser and MCP receive the same game state');
  assert.equal((await fetch(`${base}/api/arena/${id}/state`)).status, 403);
  assert.equal((await fetch(`${base}/api/arena/${id}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Friend' }) })).status, 403);
  assert.equal((await fetch(`${base}/api/arena/${id}/join`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-seat': friendToken, origin: base }, body: JSON.stringify({ name: 'Friend' }) })).status, 200);
  assert.equal((await fetch(`${base}/api/arena/${id}/move`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-seat': token, origin: 'https://other.example' }, body: JSON.stringify({ move: 'H8' }) })).status, 403);
  assert.equal((await fetch(`${base}/api/arena/${id}/move`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-seat': token, origin: base }, body: JSON.stringify({ move: 'H8' }) })).status, 200);
  assert.equal((await fetch(`${base}/api/arena/${id}/move`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-seat': token, origin: base }, body: JSON.stringify({ move: 'H7' }) })).status, 409);
  assert.equal((await fetch(`${base}/api/arena/${id}/move`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-seat': friendToken, origin: base }, body: JSON.stringify({ move: 'H7' }) })).status, 200);
  const final = (await (await fetch(`${base}/api/games/${id}`)).json()).match;
  assert.equal(final.seats[1].name, 'Friend');
  assert.deepEqual(final.log.map((m) => m.move), ['H8', 'H7']);
  console.log('Browser arena: friend join, equal state, seat authorization, origin and turns passed.');
} finally { await client.close(); }
