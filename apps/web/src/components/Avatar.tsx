import type { SeatKind } from "@rain-go/engine";
import type { ReactNode } from "react";

/**
 * Preset avatars. The AI ones are the model makers' logos from Lobe Icons
 * (https://github.com/lobehub/lobe-icons, MIT, @lobehub/icons-static-svg 1.94.0); the marks
 * belong to their owners. Where assets/avatars-anime has a portrait for a model, it is shown
 * instead, with the logo as a badge: fan art by ZipZipPipe via Model Muses (CC BY-NC-SA 4.0,
 * non-commercial; see assets/avatars-anime/CREDITS.md) or a generated one. The rest are small round
 * mascots drawn here.
 */
type Preset = Mascot | Logo;

interface Mascot {
  label: string;
  bg: string;
  body: string;
  /** Drawn behind the face, e.g. ears or a tail. */
  back?: ReactNode;
  /** Drawn over the face, e.g. a sparkle or a hat. */
  front?: ReactNode;
  /** Shape of the body; a circle by default. */
  shape?: ReactNode;
}

interface Logo {
  label: string;
  bg: string;
  logo: string;
  /** The anime-girl portrait for this model, when there is one; the logo then becomes a corner badge. */
  art?: string;
}

const LOGOS = import.meta.glob<string>("../assets/avatars/*.svg", { eager: true, query: "?url&no-inline", import: "default" });
const ARTS = import.meta.glob<string>("../assets/avatars-anime/*.webp", { eager: true, query: "?url&no-inline", import: "default" });
const logo = (id: string) => LOGOS[`../assets/avatars/${id}.svg`]!;
const art = (id: string) => ARTS[`../assets/avatars-anime/${id}.webp`];
const brand = (id: string, label: string, bg: string): Logo => ({ label, bg, logo: logo(id), ...(art(id) ? { art: art(id) } : {}) });

const face = (ink = "#2b2b2b") => (
  <>
    <circle cx="25" cy="35" r="2.6" fill={ink} />
    <circle cx="39" cy="35" r="2.6" fill={ink} />
    <circle cx="26" cy="34" r="0.9" fill="#fff" />
    <circle cx="40" cy="34" r="0.9" fill="#fff" />
    <ellipse cx="20" cy="40" rx="3.2" ry="2" fill="#ff8a8a" opacity="0.55" />
    <ellipse cx="44" cy="40" rx="3.2" ry="2" fill="#ff8a8a" opacity="0.55" />
    <path d="M29 40 q3 3 6 0" stroke={ink} strokeWidth="1.8" fill="none" strokeLinecap="round" />
  </>
);

export const AVATARS: Record<string, Preset> = {
  person: { label: "默认", bg: "#efeae4", body: "#d8c7b5", back: <path d="M14 30 q2 -16 18 -16 q16 0 18 16 q-8 -6 -18 -6 q-10 0 -18 6Z" fill="#6b5a4c" /> },
  drop: {
    label: "水珠",
    bg: "#e7ecef",
    body: "#9fb4c2",
    shape: <path d="M32 10 C42 24 50 31 50 40 a18 18 0 0 1 -36 0 C14 31 22 24 32 10Z" fill="#9fb4c2" />,
  },
  cat: {
    label: "小猫",
    bg: "#f3ece2",
    body: "#c9a27e",
    back: (
      <>
        <path d="M15 26 l2 -14 l11 8Z" fill="#c9a27e" />
        <path d="M49 26 l-2 -14 l-11 8Z" fill="#c9a27e" />
      </>
    ),
  },
  robot: {
    label: "机器人",
    bg: "#e6e9e8",
    body: "#9aa3a0",
    shape: <rect x="13" y="20" width="38" height="32" rx="10" fill="#9aa3a0" />,
    back: (
      <>
        <line x1="32" y1="20" x2="32" y2="11" stroke="#9aa3a0" strokeWidth="2.5" />
        <circle cx="32" cy="10" r="3" fill="#f2b84b" />
      </>
    ),
  },
  // Overseas
  spark: brand("spark", "Claude", "#f8ebe4"),
  knot: brand("knot", "ChatGPT", "#f1f1ef"),
  twin: brand("twin", "Gemini", "#eaf0fd"),
  grok: brand("grok", "Grok", "#ececec"),
  llama: brand("llama", "Llama", "#e8f2fd"),
  mistral: brand("mistral", "Mistral", "#fdf1e3"),
  // China
  whale: brand("whale", "DeepSeek", "#e8edfe"),
  cloud: brand("cloud", "通义千问", "#efeafd"),
  bean: brand("bean", "豆包", "#ecf0fe"),
  moon: brand("moon", "Kimi", "#ececf0"),
  glm: brand("glm", "智谱", "#e9ecfe"),
  wave: brand("wave", "MiniMax", "#fde9ec"),
  wenxin: brand("wenxin", "文心", "#e7effc"),
  hunyuan: brand("hunyuan", "混元", "#e5f0fd"),
  xinghuo: brand("xinghuo", "星火", "#e8f1fd"),
};

export const AVATAR_IDS = Object.keys(AVATARS);

/** Shown under avatar pickers: the portraits are fan art and their licence asks for credit. */
export function AvatarCredit() {
  return (
    <p className="mt-1.5 text-[0.7rem] leading-snug text-faint">
      二次元头像为同人二创，非官方形象：画师 ZipZipPipe（DeepSeek 角色原设：上善无形），收录于{" "}
      <a className="underline" href="https://github.com/saya-ch/model-muses" target="_blank" rel="noopener noreferrer">
        Model Muses
      </a>
      ，CC BY-NC-SA 4.0，仅限非商业使用。文心、星火为 AI 生成。
    </p>
  );
}

/** The avatar shown when a seat has none: a person for humans, a robot for game bots, a drop for AIs. */
export const defaultAvatar = (kind: SeatKind) => (kind === "human" ? "person" : kind === "bot" ? "robot" : "drop");

export function Avatar({ id, kind = "ai", size = 40, className = "" }: { id?: string; kind?: SeatKind; size?: number; className?: string }) {
  const p = AVATARS[id ?? ""] ?? AVATARS[defaultAvatar(kind)]!;
  if ("logo" in p && p.art) {
    // Big enough to tell apart: show the model's logo as a badge so the portrait stays recognisable.
    const badge = size >= 40 ? Math.round(size * 0.36) : 0;
    return (
      <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }} role="img" aria-label={p.label}>
        <img src={p.art} alt="" width={size} height={size} draggable={false} className="h-full w-full rounded-full object-cover" style={{ background: p.bg }} />
        {badge > 0 && (
          <span
            className="absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-white shadow-sm"
            style={{ width: badge, height: badge }}
          >
            <img src={p.logo} alt="" width={Math.round(badge * 0.66)} height={Math.round(badge * 0.66)} draggable={false} />
          </span>
        )}
      </span>
    );
  }
  if ("logo" in p) {
    return (
      <span
        className={`grid shrink-0 place-items-center rounded-full ${className}`}
        style={{ width: size, height: size, background: p.bg, boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.05)" }}
        role="img"
        aria-label={p.label}
      >
        <img src={p.logo} alt="" width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} draggable={false} />
      </span>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`shrink-0 rounded-full ${className}`} role="img" aria-label={p.label}>
      <circle cx="32" cy="32" r="32" fill={p.bg} />
      {p.back}
      {p.shape ?? <circle cx="32" cy="36" r="18" fill={p.body} />}
      {face(p.body === "#2d2d38" ? "#f4f4f4" : "#2b2b2b")}
      {p.front}
    </svg>
  );
}
