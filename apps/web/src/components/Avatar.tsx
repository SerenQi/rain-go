import type { SeatKind } from "@rain-go/engine";
import type { ReactNode } from "react";

/**
 * Preset avatars: small round mascots drawn here, in the colours people associate with each
 * assistant. They are original drawings, not the companies' logos.
 */
interface Preset {
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

const sparkle = (x: number, y: number, r: number, fill: string) => (
  <path d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`} fill={fill} />
);

export const AVATARS: Record<string, Preset> = {
  drop: {
    label: "水珠",
    bg: "#e7ecef",
    body: "#9fb4c2",
    shape: <path d="M32 10 C42 24 50 31 50 40 a18 18 0 0 1 -36 0 C14 31 22 24 32 10Z" fill="#9fb4c2" />,
  },
  person: { label: "默认", bg: "#efeae4", body: "#d8c7b5", back: <path d="M14 30 q2 -16 18 -16 q16 0 18 16 q-8 -6 -18 -6 q-10 0 -18 6Z" fill="#6b5a4c" /> },
  spark: {
    label: "Claude",
    bg: "#f8e6dc",
    body: "#e2895f",
    front: sparkle(46, 16, 7, "#fff4ec"),
  },
  knot: {
    label: "ChatGPT",
    bg: "#dff1ec",
    body: "#3f9f86",
    back: (
      <>
        <circle cx="17" cy="20" r="6" fill="#3f9f86" />
        <circle cx="47" cy="20" r="6" fill="#3f9f86" />
      </>
    ),
    front: <circle cx="32" cy="14" r="3" fill="#dff1ec" />,
  },
  twin: {
    label: "Gemini",
    bg: "#e5e8fb",
    body: "#6f86e8",
    front: (
      <>
        {sparkle(18, 16, 6, "#b48bf2")}
        {sparkle(47, 18, 4.5, "#fff")}
      </>
    ),
  },
  whale: {
    label: "DeepSeek",
    bg: "#dfe9fb",
    body: "#4d6bfe",
    shape: <ellipse cx="32" cy="38" rx="20" ry="16" fill="#4d6bfe" />,
    back: <path d="M48 28 q8 -10 12 -4 q-4 2 -6 8Z" fill="#4d6bfe" />,
    front: (
      <>
        <path d="M30 18 q2 -6 0 -9 M30 18 q-4 -4 -8 -4 M30 18 q4 -4 8 -3" stroke="#9db4ff" strokeWidth="2" fill="none" strokeLinecap="round" />
        <ellipse cx="32" cy="47" rx="11" ry="5" fill="#dfe9fb" opacity="0.6" />
      </>
    ),
  },
  cloud: {
    label: "通义千问",
    bg: "#ece4fb",
    body: "#7a5af5",
    shape: <path d="M16 46 a10 10 0 0 1 2 -19 a14 14 0 0 1 27 -2 a10 10 0 0 1 3 21Z" fill="#7a5af5" />,
  },
  bean: {
    label: "豆包",
    bg: "#fbf0dc",
    body: "#fff9ee",
    shape: <path d="M12 42 q0 -20 20 -22 q20 2 20 22 q0 8 -20 8 q-20 0 -20 -8Z" fill="#fff9ee" stroke="#e7cfa5" strokeWidth="1.5" />,
    front: <path d="M26 21 q3 -5 6 -1 q3 -4 6 1" stroke="#e7cfa5" strokeWidth="1.6" fill="none" strokeLinecap="round" />,
  },
  moon: {
    label: "Kimi",
    bg: "#e3e3e8",
    body: "#2d2d38",
    front: <path d="M44 12 a8 8 0 1 0 6 12 a6 6 0 1 1 -6 -12Z" fill="#f5d76e" />,
  },
  wave: {
    label: "MiniMax",
    bg: "#fde4ea",
    body: "#f2557a",
    front: <path d="M16 18 q4 -5 8 0 t8 0 t8 0 t8 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />,
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
};

export const AVATAR_IDS = Object.keys(AVATARS);

/** The avatar shown when a seat has none: a person for humans, a robot for game bots, a drop for AIs. */
export const defaultAvatar = (kind: SeatKind) => (kind === "human" ? "person" : kind === "bot" ? "robot" : "drop");

export function Avatar({ id, kind = "ai", size = 40, className = "" }: { id?: string; kind?: SeatKind; size?: number; className?: string }) {
  const p = AVATARS[id ?? ""] ?? AVATARS[defaultAvatar(kind)]!;
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
