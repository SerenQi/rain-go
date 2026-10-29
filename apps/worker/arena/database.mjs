import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const defaultDatabasePath = () => join(homedir(), '.local', 'share', 'rain-go', 'arena.sqlite');

export class ArenaDatabase {
  constructor(path = defaultDatabasePath()) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS games (
        server TEXT NOT NULL, game_id TEXT NOT NULL, kind TEXT NOT NULL,
        information_mode TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        status TEXT NOT NULL, result TEXT, outcome_json TEXT, PRIMARY KEY(server, game_id));
      CREATE TABLE IF NOT EXISTS players (
        server TEXT NOT NULL, game_id TEXT NOT NULL, seat INTEGER NOT NULL, name TEXT NOT NULL,
        connection TEXT NOT NULL CHECK(connection IN ('api','mcp')), model TEXT, provider TEXT,
        PRIMARY KEY(server, game_id, seat), FOREIGN KEY(server, game_id) REFERENCES games(server, game_id));
      CREATE TABLE IF NOT EXISTS moves (
        server TEXT NOT NULL, game_id TEXT NOT NULL, number INTEGER NOT NULL, seat INTEGER NOT NULL,
        move TEXT NOT NULL, played_at INTEGER NOT NULL, PRIMARY KEY(server, game_id, number),
        FOREIGN KEY(server, game_id) REFERENCES games(server, game_id));
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY, server TEXT NOT NULL, game_id TEXT NOT NULL, started_at TEXT NOT NULL,
        ended_at TEXT, state TEXT NOT NULL, timeout_ms INTEGER, max_attempts INTEGER,
        FOREIGN KEY(server, game_id) REFERENCES games(server, game_id));
      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, seat INTEGER NOT NULL, attempt INTEGER NOT NULL,
        status TEXT NOT NULL, move TEXT, reason TEXT, duration_ms INTEGER,
        prompt_tokens INTEGER, completion_tokens INTEGER, reasoning_tokens INTEGER, total_tokens INTEGER,
        FOREIGN KEY(run_id) REFERENCES runs(id));
      CREATE TABLE IF NOT EXISTS run_players (
        run_id INTEGER NOT NULL, seat INTEGER NOT NULL, reasoning_effort TEXT,
        PRIMARY KEY(run_id, seat), FOREIGN KEY(run_id) REFERENCES runs(id));
      CREATE INDEX IF NOT EXISTS games_created_idx ON games(created_at DESC);
      CREATE INDEX IF NOT EXISTS moves_game_idx ON moves(server, game_id, number);
      PRAGMA user_version = 1;`);
  }
  syncGame(server, match) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO games(server,game_id,kind,information_mode,created_at,updated_at,status,result,outcome_json)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(server,game_id) DO UPDATE SET updated_at=excluded.updated_at,
        status=excluded.status,result=excluded.result,outcome_json=excluded.outcome_json`).run(server,match.id,match.kind,match.informationMode ?? null,match.createdAt,match.updatedAt,match.status.outcome ? 'finished' : 'active',match.status.resultText ?? null,match.status.outcome ? JSON.stringify(match.status.outcome) : null);
      const stmt = this.db.prepare(`INSERT INTO moves(server,game_id,number,seat,move,played_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(server,game_id,number) DO NOTHING`);
      match.log.forEach((entry,i) => stmt.run(server,match.id,i+1,entry.seat,entry.move,entry.t));
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  setPlayers(server, id, players, names) {
    const insert = this.db.prepare(`INSERT INTO players(server,game_id,seat,name,connection,model,provider) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(server,game_id,seat) DO UPDATE SET model=COALESCE(players.model,excluded.model),provider=COALESCE(players.provider,excluded.provider)`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (let i=0;i<players.length;i++) {
        const p=players[i], old=this.db.prepare('SELECT connection,model,provider FROM players WHERE server=? AND game_id=? AND seat=?').get(server,id,i);
        if (old && (old.connection !== p.type || (old.model && p.model && old.model !== p.model) || (old.provider && p.provider && old.provider !== p.provider))) throw new Error(`Seat ${i} does not match recorded player metadata.`);
        insert.run(server,id,i,names[i] ?? p.name ?? `Seat ${i}`,p.type,p.model ?? null,p.provider ?? null);
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  startRun(server,id,players,timeoutMs,maxAttempts,startedAt = new Date().toISOString()) {
    const result=this.db.prepare("INSERT INTO runs(server,game_id,started_at,state,timeout_ms,max_attempts) VALUES(?,?,?,'running',?,?)").run(server,id,startedAt,timeoutMs,maxAttempts);
    const run=Number(result.lastInsertRowid), stmt=this.db.prepare('INSERT INTO run_players(run_id,seat,reasoning_effort) VALUES(?,?,?)');
    players.forEach((p,i)=>stmt.run(run,i,p.reasoningEffort ?? null));
    return run;
  }
  attempt(run, seat, attempt, status, details = {}) {
    const usage=details.usage ?? {};
    const number = x => Number.isSafeInteger(x) && x >= 0 ? x : null;
    this.db.prepare('INSERT INTO attempts(run_id,seat,attempt,status,move,reason,duration_ms,prompt_tokens,completion_tokens,reasoning_tokens,total_tokens) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(run,seat,attempt,status,details.move ?? null,details.reason ?? null,number(details.durationMs),number(usage.prompt_tokens),number(usage.completion_tokens),number(usage.completion_tokens_details?.reasoning_tokens),number(usage.total_tokens));
  }
  endRun(run,state,endedAt = new Date().toISOString()) { this.db.prepare('UPDATE runs SET state=?,ended_at=? WHERE id=?').run(state,endedAt,run); }
  close() { this.db.close(); }
}
