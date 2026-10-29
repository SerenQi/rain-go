import { useEffect, useState } from "react";

export type Route = { name: "lobby" } | { name: "game"; id: string } | { name: "connect" } | { name: "arena" } | { name: "sandbox"; kind: string };

export function parseRoute(path: string): Route {
  const g = /^\/g\/([a-z0-9]+)\/?$/.exec(path);
  if (g) return { name: "game", id: g[1]! };
  if (path.startsWith("/connect")) return { name: "connect" };
  if (path === "/arena" || path === "/arena/") return { name: "arena" };
  const sb = /^\/sandbox\/([a-z]+)\/?$/.exec(path);
  if (sb) return { name: "sandbox", kind: sb[1]! };
  return { name: "lobby" };
}

export function navigate(path: string) {
  if (path === location.pathname) return;
  history.pushState(null, "", path);
  window.dispatchEvent(new Event("routechange"));
  window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", on);
    window.addEventListener("routechange", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("routechange", on);
    };
  }, []);
  return route;
}
