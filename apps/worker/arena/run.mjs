import { readFile, appendFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ArenaDatabase, defaultDatabasePath } from './database.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function endpoint(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname))) throw new Error('Model endpoint must use HTTPS (HTTP is allowed only on localhost).');
  return u;
}
async function requestMove(player, state, correction, timeoutMs) {
  const key = process.env[player.keyEnv];
  if (!key) throw new Error(`Missing API key environment variable ${player.keyEnv}`);
  const response = await fetch(endpoint(player.endpoint), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: player.model, ...(player.reasoningEffort ? { reasoning_effort: player.reasoningEffort } : {}), messages: [{ role: 'system', content: 'Return only a JSON object with a single move field containing the coordinate.' }, { role: 'user', content: state + (correction ? `\nPrevious response: ${correction}` : '') }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Model API returned HTTP ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return { error: 'response has no text', usage: data.usage };
  let value;
  try { value = JSON.parse(content); } catch { return { error: 'response is not JSON', usage: data.usage }; }
  if (typeof value?.move !== 'string' || !/^[A-HJ-P](?:[1-9]|1[0-5])$/i.test(value.move)) return { error: 'move must be a coordinate', usage: data.usage };
  return { move: value.move.toUpperCase(), usage: data.usage };
}
async function main() {
  if (!process.argv[2]) throw new Error('Usage: node apps/worker/arena/run.mjs <config.json>');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
  if (!Array.isArray(config.players) || config.players.length !== 2 || config.players.some(p => !p || !['api', 'mcp'].includes(p.type))) throw new Error('Configure exactly two players of type api or mcp.');
  for (const p of config.players) if (p.type === 'api' && (!p.endpoint || !p.model || !p.keyEnv)) throw new Error('API players require endpoint, model and keyEnv.');
  const base = new URL(config.base ?? 'http://127.0.0.1:8787');
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid game server URL');
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(base.hostname)) throw new Error('Game server must use HTTPS unless local.');
  const token = process.env[config.tokenEnv ?? 'RAIN_GO_TOKEN'];
  if (!token) throw new Error('Missing game server access token environment variable.');
  const timeoutMs = config.timeoutMs ?? 60000;
  const maxAttempts = config.maxAttempts ?? 3;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error('Invalid timeoutMs or maxAttempts.');
  const database = new ArenaDatabase(config.databaseFile ?? defaultDatabasePath());
  const record = async event => { if (config.recordFile) await appendFile(config.recordFile, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 }); };
  let id, invites;
  if (config.gameId) {
    if (!/^[a-z0-9]{6,32}$/.test(config.gameId)) throw new Error('Invalid gameId.');
    id = config.gameId;
    const current = await fetch(new URL(`/api/games/${id}`, base));
    if (!current.ok) throw new Error(`Could not read game: HTTP ${current.status}`);
    const { match } = await current.json();
    if (match.kind !== 'gomoku' || match.informationMode !== 'equal' || match.seats.length !== 2 || match.seats.some(s => s.kind !== 'ai')) throw new Error('Resume requires a two-AI-seat gomoku game created with equal information mode.');
    const r = await fetch(new URL(`/api/games/${id}/invites`, base), { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Could not retrieve seat links: HTTP ${r.status}`);
    ({ invites } = await r.json());
  } else {
    const res = await fetch(new URL('/api/games', base), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'gomoku', informationMode: 'equal', seats: config.players.map((p, i) => ({ kind: 'ai', name: p.name ?? p.model ?? `MCP ${i + 1}` })) }) });
    if (!res.ok) throw new Error(`Could not create game: HTTP ${res.status}`);
    const created = await res.json();
    if (created.match.informationMode !== 'equal') throw new Error('Game server does not support equal information mode; upgrade it before running the arena.');
    id = created.match.id;
    invites = created.invites;
  }
  console.log(`Watch: ${new URL(`/g/${id}`, base)}`);
  console.log(`Database: ${database.path}`);
  const initialResponse = await fetch(new URL(`/api/games/${id}`, base));
  if (!initialResponse.ok) throw new Error(`Could not read game: HTTP ${initialResponse.status}`);
  const initial = (await initialResponse.json()).match;
  database.syncGame(base.origin, initial);
  database.setPlayers(base.origin, id, config.players, initial.seats.map(s => s.name));
  const runId = database.startRun(base.origin, id, config.players, timeoutMs, maxAttempts);
  await record({ type: 'start', gameId: id, informationMode: 'equal', players: config.players.map(({ type, name, model, reasoningEffort }) => ({ type, name, model, reasoningEffort })), maxAttempts, timeoutMs });
  const clients = [];
  try {
    for (let i = 0; i < 2; i++) {
      const invite = invites[i].link;
      if (config.players[i].type === 'mcp') { console.log(`MCP seat ${i} (private): ${invite}`); continue; }
      const client = new Client({ name: 'rain-go-arena', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(invite)));
      clients[i] = client;
    }
    while (true) {
      const r = await fetch(new URL(`/api/games/${id}`, base));
      if (!r.ok) throw new Error(`Could not read game: HTTP ${r.status}`);
      const { match } = await r.json();
      database.syncGame(base.origin, match);
      if (match.status.outcome) {
        console.log(`Finished: ${match.status.resultText}`);
        await record({ type: 'finished', outcome: match.status.outcome, result: match.status.resultText, moves: match.log });
        database.endRun(runId, 'finished');
        break;
      }
      const seat = match.status.waitingOn[0];
      if (config.players[seat].type === 'mcp') { await sleep(1500); continue; }
      const snapshot = await clients[seat].callTool({ name: 'get_state', arguments: {} });
      if (snapshot.isError || snapshot.content?.length !== 1 || snapshot.content[0].type !== 'text') throw new Error('Could not get the equal-information MCP state.');
      const state = snapshot.content[0].text;
      let parsed;
      try { parsed = JSON.parse(state); } catch { throw new Error('Game server returned an incompatible MCP state.'); }
      if (parsed.game !== 'gomoku' || parsed.you !== (seat === 0 ? 'black' : 'white') || parsed.turn !== parsed.you || !parsed.rules || !parsed.stones) throw new Error('Game server returned an incompatible MCP state.');
      let correction;
      let played = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const start = Date.now();
        let result;
        try { result = await requestMove(config.players[seat], state, correction, timeoutMs); }
        catch (error) { database.attempt(runId, seat, attempt, 'failed', { reason: 'model request failed', durationMs: Date.now() - start }); throw error; }
        if (!result.move) { correction = result.error; const durationMs = Date.now() - start; database.attempt(runId, seat, attempt, 'invalid', { reason: correction, durationMs, usage: result.usage }); await record({ type: 'invalid', seat, attempt, reason: correction, durationMs, usage: result.usage }); continue; }
        const action = await clients[seat].callTool({ name: 'play', arguments: { move: result.move } });
        if (action.isError) { correction = action.content?.[0]?.text ?? 'Move rejected.'; const durationMs = Date.now() - start; database.attempt(runId, seat, attempt, 'invalid', { move: result.move, reason: 'move rejected', durationMs, usage: result.usage }); await record({ type: 'invalid', seat, attempt, move: result.move, reason: 'move rejected', durationMs }); continue; }
        console.log(`${seat === 0 ? 'Black' : 'White'}: ${result.move}`);
        const durationMs = Date.now() - start;
        database.attempt(runId, seat, attempt, 'accepted', { move: result.move, durationMs, usage: result.usage });
        await record({ type: 'move', seat, move: result.move, durationMs, usage: result.usage });
        played = true;
        break;
      }
      if (!played) throw new Error(`Seat ${seat} failed to produce a legal move after ${maxAttempts} attempts; game remains paused.`);
    }
  } catch (error) {
    database.endRun(runId, 'stopped');
    await record({ type: 'stopped', reason: error.message });
    throw error;
  } finally { await Promise.all(clients.filter(Boolean).map(c => c.close())); database.close(); }
}
main().catch(error => { console.error(`Arena stopped: ${error.message}`); process.exitCode = 1; });
