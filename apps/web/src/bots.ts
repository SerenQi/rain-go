import { useEffect, useState } from "react";
import type { Effort, ModelConfig, Provider } from "./ai";

/**
 * A person's own AI players, kept on this device. An "api" bot is played by this browser calling a
 * model; an "mcp" bot is an agent elsewhere that gets a seat's connector URL and a prompt.
 */
export interface MyBot {
  id: string;
  name: string;
  avatar: string;
  type: "api" | "mcp";
  provider: Provider;
  customUrl: string;
  model: string;
  effort: Effort;
  /** Keep the API key in localStorage instead of only for this tab. */
  rememberKey: boolean;
}

const BOTS_KEY = "rain-go:bots";
const keyName = (id: string) => `rain-go:bot-key:${id}`;
const CHANGE = "botschange";

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

export function listBots(): MyBot[] {
  try {
    const v = JSON.parse(storage("local")?.getItem(BOTS_KEY) ?? "[]") as MyBot[];
    return Array.isArray(v) ? v.filter((b) => b && typeof b.id === "string") : [];
  } catch {
    return [];
  }
}

function writeBots(bots: MyBot[]) {
  try {
    storage("local")?.setItem(BOTS_KEY, JSON.stringify(bots));
  } catch {
    // Storage unavailable; bots last for this visit only.
  }
  window.dispatchEvent(new Event(CHANGE));
}

export function saveBot(bot: MyBot, key: string) {
  const bots = listBots();
  const i = bots.findIndex((b) => b.id === bot.id);
  writeBots(i < 0 ? [...bots, bot] : bots.map((b) => (b.id === bot.id ? bot : b)));
  try {
    storage("local")?.removeItem(keyName(bot.id));
    storage("session")?.removeItem(keyName(bot.id));
    if (bot.type === "api" && key.trim()) storage(bot.rememberKey ? "local" : "session")?.setItem(keyName(bot.id), key.trim());
  } catch {
    // Storage unavailable.
  }
}

export function deleteBot(id: string) {
  writeBots(listBots().filter((b) => b.id !== id));
  try {
    storage("local")?.removeItem(keyName(id));
    storage("session")?.removeItem(keyName(id));
  } catch {
    // Storage unavailable.
  }
}

export const botKey = (id: string) => storage("local")?.getItem(keyName(id)) || storage("session")?.getItem(keyName(id)) || "";

export const modelOf = (b: MyBot): ModelConfig => ({ provider: b.provider, customUrl: b.customUrl, model: b.model, effort: b.effort, key: botKey(b.id) });

export const newBot = (): MyBot => ({
  id: crypto.randomUUID().slice(0, 8),
  name: "",
  avatar: "drop",
  type: "api",
  provider: "deepseek",
  customUrl: "",
  model: "deepseek-flash",
  effort: "default",
  rememberKey: false,
});

export function useBots(): MyBot[] {
  const [bots, setBots] = useState(listBots);
  useEffect(() => {
    const on = () => setBots(listBots());
    window.addEventListener(CHANGE, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(CHANGE, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  return bots;
}

/**
 * Seats this browser plays with one of its API bots, per game: seat index → bot id and seat token.
 * Kept in sessionStorage, since the browser must stay open to play them anyway.
 */
export type Driven = Record<number, { bot: string; token: string }>;
const drivenKey = (game: string) => `rain-go:driven:${game}`;

export function drivenSeats(game: string): Driven {
  try {
    return JSON.parse(storage("session")?.getItem(drivenKey(game)) ?? "{}") as Driven;
  } catch {
    return {};
  }
}

export function setDriven(game: string, seat: number, entry: { bot: string; token: string } | null) {
  const next = { ...drivenSeats(game) };
  if (entry) next[seat] = entry;
  else delete next[seat];
  try {
    storage("session")?.setItem(drivenKey(game), JSON.stringify(next));
  } catch {
    // Storage unavailable.
  }
  window.dispatchEvent(new Event(CHANGE));
}

export function useDriven(game: string): Driven {
  const [d, setD] = useState(() => drivenSeats(game));
  useEffect(() => {
    const on = () => setD(drivenSeats(game));
    on();
    window.addEventListener(CHANGE, on);
    return () => window.removeEventListener(CHANGE, on);
  }, [game]);
  return d;
}
