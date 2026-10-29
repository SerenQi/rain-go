import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { prefs } from "../api";
import { navigate, type Route } from "../router";
import { IconBoard, IconGear, IconHome, IconTerminal } from "./icons";
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

function BottomNav({ route }: { route: Route }) {
  const go = (key: (typeof NAV)[number]["key"]) => {
    if (key === "lobby") navigate("/");
    else if (key === "connect") navigate("/connect");
    else if (key === "arena") navigate("/arena");
    else {
      const last = prefs.lastGame();
      navigate(last ? `/g/${last}` : "/");
    }
  };
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 px-4 land:hidden pb-[max(10px,env(safe-area-inset-bottom))] lg:pb-[max(14px,env(safe-area-inset-bottom))]">
      <div className="glass mx-auto flex h-[68px] max-w-[520px] items-center justify-around !rounded-[30px] px-2 lg:h-auto lg:!rounded-[34px] lg:py-2.5">
        {NAV.map(({ key, label, icon: Icon }) => {
          const active = route.name === key;
          return (
            <button key={key} onClick={() => go(key)} className="flex w-20 flex-col items-center gap-0.5 lg:gap-1" aria-current={active ? "page" : undefined}>
              <span
                className={`grid h-10 w-10 place-items-center rounded-full transition lg:h-12 lg:w-12 ${active ? "bg-ink text-white" : "text-faint"}`}
              >
                <Icon width={21} height={21} />
              </span>
              <span className={`text-xs lg:text-sm ${active ? "font-semibold text-ink" : "text-faint"}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function Shell({ route, children, wide = false }: { route: Route; children: ReactNode; wide?: boolean }) {
  return (
    <>
      <Backdrop />
      <main
        className={`mx-auto flex h-dvh flex-col overflow-hidden px-4 pb-[calc(80px+max(10px,env(safe-area-inset-bottom)))] land:max-w-none land:pr-[max(12px,env(safe-area-inset-right))] land:pb-[max(8px,env(safe-area-inset-bottom))] land:pl-[max(12px,env(safe-area-inset-left))] lg:block lg:h-auto lg:overflow-visible lg:pb-40 ${
          wide ? "max-w-[520px] lg:max-w-[1100px]" : "max-w-[520px]"
        }`}
      >
        {children}
      </main>
      <BottomNav route={route} />
    </>
  );
}
