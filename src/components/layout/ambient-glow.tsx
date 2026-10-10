import type { CSSProperties } from "react";

/* Lueurs d'ambiance reprises du portfolio (AmbientGlows) : fixes à l'écran,
   elles apparaissent en grandissant puis dérivent et se déforment lentement. */

const MINT = "63, 191, 166";
const BLUE = "137, 186, 250";
const PURPLE = "194, 168, 241";

type Lueur = {
  color: string;
  opacity: number;
  x: number;
  y: number;
  size: number;
  drift: "a" | "b" | "c";
  driftDuration: number;
  reverse?: boolean;
  blobDuration: number;
  desktopOnly?: boolean;
};

const LUEURS: Lueur[] = [
  { color: MINT, opacity: 0.15, x: -6, y: 14, size: 62, drift: "a", driftDuration: 64, blobDuration: 26, desktopOnly: true },
  { color: BLUE, opacity: 0.11, x: 104, y: 30, size: 58, drift: "b", driftDuration: 74, blobDuration: 32, reverse: true },
  { color: PURPLE, opacity: 0.09, x: 76, y: -10, size: 48, drift: "c", driftDuration: 56, blobDuration: 23, desktopOnly: true },
  { color: MINT, opacity: 0.1, x: 30, y: 110, size: 56, drift: "b", driftDuration: 70, blobDuration: 30 },
  { color: BLUE, opacity: 0.08, x: -4, y: 82, size: 50, drift: "c", driftDuration: 80, blobDuration: 35, reverse: true, desktopOnly: true },
  { color: MINT, opacity: 0.09, x: 98, y: 94, size: 54, drift: "a", driftDuration: 66, blobDuration: 28, reverse: true },
];

const tint = (color: string, alpha: number) =>
  `rgba(${color}, min(1, calc(${alpha} * var(--mm-ambient-boost, 1) * var(--ambient-dim, 1))))`;

const fond = (color: string, a: number) =>
  `radial-gradient(closest-side, ${tint(color, a)}, ${tint(color, a * 0.6)} 45%, ${tint(color, a * 0.2)} 75%, transparent)`;

export function AmbientGlow() {
  return (
    <div aria-hidden className="ambient-glows pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {LUEURS.map((l, i) => (
        <div
          key={i}
          className={`ambient-enter absolute ${l.desktopOnly ? "hidden md:block" : ""}`}
          style={{
            left: `${l.x}%`,
            top: `${l.y}%`,
            width: `calc(${l.size}rem * var(--ambient-scale, 1))`,
            height: `calc(${l.size}rem * var(--ambient-scale, 1))`,
            marginLeft: `calc(${-l.size / 2}rem * var(--ambient-scale, 1))`,
            marginTop: `calc(${-l.size / 2}rem * var(--ambient-scale, 1))`,
            animationDelay: `${0.45 + i * 0.12}s`,
          }}
        >
          <div
            className={`ambient-drift-${l.drift} h-full w-full`}
            style={{ animationDuration: `${l.driftDuration}s`, animationDirection: l.reverse ? "reverse" : "normal" }}
          >
            <div
              className="ambient-blob h-full w-full rounded-full"
              style={
                {
                  background: fond(l.color, l.opacity),
                  "--blob-duration": `${l.blobDuration}s`,
                  "--blob-delay": `-${(i * 2.7) % l.blobDuration}s`,
                } as CSSProperties
              }
            />
          </div>
        </div>
      ))}
    </div>
  );
}
