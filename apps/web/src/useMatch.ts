import type { MatchView } from "@rain-go/engine";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

/**
 * Loads a match and keeps it live over a WebSocket. The server only sends the view of the seat
 * `seatToken` holds, or, without one, the seat a read-only `watchToken` shows.
 */
export function useMatch(id: string, seatToken: string, watchToken = "") {
  const [match, setMatchRaw] = useState<MatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  const setMatch = useCallback((m: MatchView) => {
    setMatchRaw((prev) => (prev && prev.id === m.id && prev.version > m.version ? prev : m));
    setSyncedAt(Date.now());
  }, []);

  useEffect(() => {
    setMatchRaw(null);
    setError(null);
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const watch = seatToken ? "" : watchToken;
    api.getGame(id, seatToken || undefined, watch || undefined).then(setMatch, (e: unknown) => setError(e instanceof ApiError && e.status === 404 ? "找不到这局" : "加载失败"));

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const q = seatToken ? `?t=${encodeURIComponent(seatToken)}` : watch ? `?w=${encodeURIComponent(watch)}` : "";
      ws = new WebSocket(`${proto}://${location.host}/api/games/${id}/ws${q}`);
      ws.onopen = () => {
        setLive(true);
        retry = 0;
      };
      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        const m = JSON.parse(String(e.data)) as { type: string; match?: MatchView };
        if (m.type === "match" && m.match) setMatch(m.match);
      };
      ws.onclose = () => {
        setLive(false);
        if (!stopped) timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10_000));
      };
    };
    connect();
    const ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(ping);
      ws?.close();
    };
  }, [id, seatToken, watchToken, setMatch]);

  return { match, setMatch, error, live, syncedAt };
}
