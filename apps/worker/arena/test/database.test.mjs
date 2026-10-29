import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArenaDatabase } from '../database.mjs';

test('stores arena metadata, full move history, attempts and final outcome without secrets', () => {
  const db = new ArenaDatabase(':memory:');
  const server='http://localhost:8788', id='abc123';
  const match={id,kind:'gomoku',informationMode:'equal',createdAt:1,updatedAt:2,status:{outcome:null},log:[{seat:0,move:'H8',t:2}]};
  const players=[{type:'mcp',name:'Codex'},{type:'api',name:'MiniMax',model:'MiniMax-M3.1-Flash',provider:'MiniMax',keyEnv:'SECRET_KEY',endpoint:'https://example.test/key'}];
  db.syncGame(server,match); db.setPlayers(server,id,players,['Codex','MiniMax']);
  const run=db.startRun(server,id,players,120000,3);
  db.attempt(run,1,1,'accepted',{move:'G8',durationMs:1234,usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30,completion_tokens_details:{reasoning_tokens:15}}});
  db.syncGame(server,{...match,updatedAt:3,status:{outcome:{winners:[1],text:'test'},resultText:'MiniMax won'},log:[...match.log,{seat:1,move:'G8',t:3}]});
  db.endRun(run,'finished');
  assert.equal(db.db.prepare('SELECT status FROM games').get().status,'finished');
  assert.deepEqual(db.db.prepare('SELECT move FROM moves ORDER BY number').all().map(r=>r.move),['H8','G8']);
  assert.equal(db.db.prepare('SELECT model FROM players WHERE seat=1').get().model,'MiniMax-M3.1-Flash');
  assert.equal(db.db.prepare('SELECT model FROM players WHERE seat=0').get().model,null);
  assert.equal(db.db.prepare('SELECT reasoning_tokens FROM attempts').get().reasoning_tokens,15);
  assert.throws(()=>db.setPlayers(server,id,[{type:'api'},{type:'api'}],[]),/does not match/);
  const content=JSON.stringify(db.db.prepare('SELECT * FROM players').all());
  assert.doesNotMatch(content,/SECRET_KEY|example\.test/);
  db.close();
});
