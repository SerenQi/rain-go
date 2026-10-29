import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { prefs } from "../api";
import { navigate, type Route } from "../router";
import { BRAND } from "../brand";
import { DropMark, IconBoard, IconGear, IconHome, IconTerminal } from "./icons";
import { Settings } from "./Settings";

export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** True on wide screens, where pages scroll normally. Narrow screens get a one-screen layout. */
export function useWide(query = "(min-width: 1000px)") {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return wide;
}

/** A phone held sideways (matches the `land:` CSS variant). */
export const LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 540px) and (max-width: 999px)";
export const useLandscape = () => useWide(LANDSCAPE_QUERY);

export const hhmm = (d: Date | number) =>
  new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function Backdrop() {
  const [bg, setBg] = useState(prefs.background());
  useEffect(() => {
    const on = () => setBg(prefs.background());
    window.addEventListener("prefschange", on);
    return () => window.removeEventListener("prefschange", on);
  }, []);
  return (
    <div
      className={`backdrop ${bg ? "has-image" : ""}`}
      style={bg ? ({ "--bg-image": `url("${bg.replace(/"/g, "%22")}")` } as CSSProperties) : undefined}
      aria-hidden
    >
      {!bg && (
        <>
          <div className="blob" style={{ width: 260, height: 260, left: "-60px", top: "18%", background: "#8d8d8a" }} />
          <div className="blob" style={{ width: 200, height: 200, right: "-40px", top: "8%", background: "#fbfbf9", animationDelay: "-8s" }} />
          <div className="blob" style={{ width: 320, height: 320, right: "10%", bottom: "-80px", background: "#a3a3a0", animationDelay: "-15s" }} />
        </>
      )}
    </div>
  );
}

export function Header({ status, left }: { status: ReactNode; left?: ReactNode }) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 pt-[max(12px,env(safe-area-inset-top))] pb-2.5 land:pt-2 land:pb-2 lg:pt-6 lg:pb-4">
      <div className="min-w-0">
        {left ?? (
          <div className="truncate text-[clamp(1.05rem,4.6vw,1.4rem)] leading-tight text-muted">
            {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="chip">{status}</span>
        <button className="chip !p-2 !text-ink lg:!p-2.5" onClick={() => setOpen(true)} aria-label="设置">
          <IconGear width={20} height={20} />
        </button>
      </div>
      {open && <Settings onClose={() => setOpen(false)} />}
    </header>
  );
}

const NAV = [
  { key: "lobby", label: "大厅", icon: IconHome },
  { key: "game", label: "棋盘", icon: IconBoard },
  { key: "arena", label: "擂台", icon: IconBoard },
  { key: "connect", label: "连接", icon: IconTerminal },
] as const;

const go = (key: (typeof NAV)[number]["key"]) => {
  if (key === "lobby") navigate("/");
  else if (key === "connect") navigate("/connect");
  else if (key === "arena") navigate("/arena");
  else {
    const last = prefs.lastGame();
    navigate(last ? `/g/${last}` : "/");
  }
};

/** Desktop: the same destinations as a fixed column on the left. */
function SideNav({ route }: { route: Route }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[232px] flex-col p-4 lg:flex">
      <div className="glass flex flex-1 flex-col !rounded-[30px] px-3 py-5">
        <button className="flex items-center gap-3 px-3 text-left" onClick={() => navigate("/")}>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink">
            <DropMark width={26} height={26} />
          </span>
          <span className="min-w-0">
            <span className="block text-[1.35rem] font-bold leading-tight">{BRAND.zh}</span>
            <span className="block truncate text-xs italic text-muted">{BRAND.en}</span>
          </span>
        </button>
        <nav className="mt-8 space-y-1">
          {NAV.map(({ key, label, icon: Icon }) => {
            const active = route.name === key;
            return (
              <button
                key={key}
                onClick={() => go(key)}
                aria-current={active ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${active ? "bg-ink text-white" : "text-ink-2 hover:bg-white/45"}`}
              >
                <Icon width={20} height={20} />
                <span className={active ? "font-semibold" : ""}>{label}</span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto px-3 text-xs leading-relaxed text-faint">{BRAND.tagline} · 人和 AI 同桌</div>
      </div>
    </aside>
  );
}

function BottomNav({ route }: { route: Route }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 px-4 land:hidden pb-[max(10px,env(safe-area-inset-bottom))] lg:hidden">
      <div className="glass mx-auto flex h-[68px] max-w-[520px] items-center justify-around !rounded-[30px] px-2">
        {NAV.map(({ key, label, icon: Icon }) => {
          const active = route.name === key;
          return (
            <button key={key} onClick={() => go(key)} className="flex w-20 flex-col items-center gap-0.5" aria-current={active ? "page" : undefined}>
              <span
                className={`grid h-10 w-10 place-items-center rounded-full transition ${active ? "bg-ink text-white" : "text-faint"}`}
              >
                <Icon width={21} height={21} />
              </span>
              <span className={`text-xs ${active ? "font-semibold text-ink" : "text-faint"}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  return (
    <>
      <Backdrop />
      <main
        className="mx-auto flex h-dvh max-w-[520px] flex-col overflow-hidden px-4 pb-[calc(80px+max(10px,env(safe-area-inset-bottom)))] land:max-w-none land:pr-[max(12px,env(safe-area-inset-right))] land:pb-[max(8px,env(safe-area-inset-bottom))] land:pl-[max(12px,env(safe-area-inset-left))] lg:block lg:h-auto lg:max-w-none lg:overflow-visible lg:pr-8 lg:pb-12 lg:pl-[264px]"
      >
        {/* A layout box only on desktop; on phones the pages stay direct flex children of main. */}
        <div className="contents lg:mx-auto lg:block lg:max-w-[1180px]">{children}</div>
      </main>
      <SideNav route={route} />
      <BottomNav route={route} />
    </>
  );
}
