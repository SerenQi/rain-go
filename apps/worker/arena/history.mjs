import { ArenaDatabase, defaultDatabasePath } from './database.mjs';
const path = process.env.ARENA_DATABASE ?? defaultDatabasePath();
const db = new ArenaDatabase(path);
try {
  const id = process.argv[2];
  if (!id) {
    const games = db.db.prepare(`SELECT server,game_id,kind,status,result,created_at FROM games ORDER BY created_at DESC`).all();
    for (const g of games) {
      const players = db.db.prepare('SELECT seat,name,connection,model,provider FROM players WHERE server=? AND game_id=? ORDER BY seat').all(g.server,g.game_id);
      console.log(JSON.stringify({ ...g, players }));
    }
    if (!games.length) console.log('No arena games recorded.');
  } else {
    const games=db.db.prepare('SELECT * FROM games WHERE game_id=?').all(id);
    if (games.length !== 1) throw new Error(games.length ? 'Game ID occurs on multiple servers; inspect the database with server and game_id.' : 'Game not found.');
    const game=games[0];
    const players=db.db.prepare('SELECT seat,name,connection,model,provider FROM players WHERE server=? AND game_id=? ORDER BY seat').all(game.server,id);
    const moves=db.db.prepare('SELECT number,seat,move,played_at FROM moves WHERE server=? AND game_id=? ORDER BY number').all(game.server,id);
    const runs=db.db.prepare('SELECT * FROM runs WHERE server=? AND game_id=? ORDER BY id').all(game.server,id).map(run=>({ ...run, players:db.db.prepare('SELECT seat,reasoning_effort FROM run_players WHERE run_id=? ORDER BY seat').all(run.id), attempts:db.db.prepare('SELECT * FROM attempts WHERE run_id=? ORDER BY id').all(run.id) }));
    console.log(JSON.stringify({ game, players, moves, runs },null,2));
  }
} finally { db.close(); }
