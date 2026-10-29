import { DurableObject } from "cloudflare:workers";
import type { GameKind, PublicSeat, Seat } from "@rain-go/engine";
import type { Env } from "./env";

export interface GameMeta {
  id: string;
  kind: GameKind;
  seats: PublicSeat[];
  labels: string[];
  over: boolean;
  /** Room still filling up; see Match.waiting. */
  waiting?: boolean;
  waitingOn: Seat[];
  moves: number;
  result?: string;
  createdAt: number;
  updatedAt: number;
}

/** Singleton index of all games, newest first. */
export class Lobby extends DurableObject<Env> {
  /** A conservative global limit, including installations behind a reverse proxy. */
  async reservePublicArena(): Promise<boolean> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const recent = ((await this.ctx.storage.get<number[]>("arena-creates")) ?? []).filter((t) => t > now - 60 * 60 * 1000);
      if (recent.length >= 60) return false;
      recent.push(now);
      await this.ctx.storage.put("arena-creates", recent);
      return true;
    });
  }
  async upsert(meta: GameMeta): Promise<void> {
    await this.ctx.storage.put(`g:${meta.id}`, meta);
  }

  async list(limit = 50, includeFinished = true): Promise<GameMeta[]> {
    const all = await this.ctx.storage.list<GameMeta>({ prefix: "g:" });
    return [...all.values()]
      .filter((g) => Array.isArray(g.seats) && (includeFinished || !g.over))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }
}
