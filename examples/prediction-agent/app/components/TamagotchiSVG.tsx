"use client";

/**
 * TamagotchiSVG — single source of truth for the HiveCaster pixel robot mascot.
 *
 * Pixel-grid robot built entirely from SVG rects on a 24×28 grid.
 * Every element snaps to the grid — no smooth curves, pure pixel art.
 *
 * Supports:
 *  - 5 moods  (hyped / focus / idle / alert / offline)
 *  - CSS-driven animations  (bob, blink, spark pulse, scanline sweep)
 *  - Scalable via `size` prop
 *  - Static mode for favicon / OG image snapshots
 */

export type TamagotchiMood = "hyped" | "focus" | "idle" | "alert" | "offline";

interface TamagotchiSVGProps {
  mood?: TamagotchiMood;
  size?: number;
  /** Disable CSS animations (for favicon snapshots / SSR) */
  static?: boolean;
  className?: string;
}

/* ── colour palettes per mood ─────────────────────────────── */
const PALETTES: Record<TamagotchiMood, {
  primary: string;      // shell border, eyes, mouth, antenna
  screen: string;       // screen background glow tint
  spark: string;        // LED spark colour
  shell: string;        // shell fill
  dim: string;          // darkened variant for details
}> = {
  hyped: {
    primary: "#64ffe8",
    screen: "#0a3a3a",
    spark: "#64ffe8",
    shell: "#071e2c",
    dim: "#2af2d2",
  },
  focus: {
    primary: "#7ce8ff",
    screen: "#082238",
    spark: "#7ce8ff",
    shell: "#071a2e",
    dim: "#3bb8e8",
  },
  idle: {
    primary: "#9dd8ff",
    screen: "#0b2240",
    spark: "#9dd8ff",
    shell: "#091b2d",
    dim: "#6aafda",
  },
  alert: {
    primary: "#f5b942",
    screen: "#2a1e08",
    spark: "#f5b942",
    shell: "#1a1408",
    dim: "#c89530",
  },
  offline: {
    primary: "rgba(255,255,255,0.35)",
    screen: "#111820",
    spark: "rgba(255,255,255,0.15)",
    shell: "#0e1318",
    dim: "rgba(255,255,255,0.18)",
  },
};

/* ── pixel grid constants (24 wide × 28 tall) ─────────────── */
const PX = 1; // each grid cell = 1 SVG unit

export default function TamagotchiSVG({
  mood = "focus",
  size = 36,
  static: isStatic = false,
  className = "",
}: TamagotchiSVGProps) {
  const p = PALETTES[mood];
  const isOffline = mood === "offline";
  const isHyped = mood === "hyped";
  const isAlert = mood === "alert";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 28"
      width={size}
      height={size * (28 / 24)}
      className={`tama-svg ${isStatic ? "" : `tama-svg-${mood}`} ${className}`}
      role="img"
      aria-label={`HiveCaster mascot — ${mood}`}
      style={{ imageRendering: "pixelated" }}
    >
      {/* ── Antenna ─────────────────────────────────────── */}
      {/* ball */}
      <rect className={isStatic ? "" : "tama-svg-spark"} x="11" y="0" width="2" height="2" fill={p.primary} opacity="0.9" />
      {/* stem */}
      <rect x="11" y="2" width="2" height="3" fill={p.primary} opacity="0.6" />

      {/* ── Shell body (outer) ──────────────────────────── */}
      {/* top edge */}
      <rect x="5" y="6" width="14" height="1" fill={p.primary} opacity="0.8" />
      {/* left wall */}
      <rect x="4" y="7" width="1" height="16" fill={p.primary} opacity="0.8" />
      {/* right wall */}
      <rect x="19" y="7" width="1" height="16" fill={p.primary} opacity="0.8" />
      {/* bottom edge */}
      <rect x="5" y="23" width="14" height="1" fill={p.primary} opacity="0.8" />
      {/* corners — pixel chamfer */}
      <rect x="4" y="6" width="1" height="1" fill={p.primary} opacity="0.3" />
      <rect x="19" y="6" width="1" height="1" fill={p.primary} opacity="0.3" />
      <rect x="4" y="23" width="1" height="1" fill={p.primary} opacity="0.3" />
      <rect x="19" y="23" width="1" height="1" fill={p.primary} opacity="0.3" />
      {/* shell fill */}
      <rect x="5" y="7" width="14" height="16" fill={p.shell} />
      {/* highlight scanline at top of shell */}
      <rect x="5" y="7" width="14" height="1" fill="white" opacity="0.05" />

      {/* ── Screen (inner) ──────────────────────────────── */}
      <rect x="7" y="9" width="10" height="12" fill={p.screen} />
      {/* screen border */}
      <rect x="7" y="9" width="10" height="1" fill={p.primary} opacity="0.15" />
      <rect x="7" y="20" width="10" height="1" fill={p.primary} opacity="0.1" />
      <rect x="7" y="10" width="1" height="10" fill={p.primary} opacity="0.1" />
      <rect x="16" y="10" width="1" height="10" fill={p.primary} opacity="0.1" />

      {/* ── Scanline sweep (focus mode) ─────────────────── */}
      {mood === "focus" && !isStatic && (
        <rect className="tama-svg-scanline" x="7" y="10" width="10" height="1" fill={p.primary} opacity="0.25" />
      )}

      {/* ── Eyes ─────────────────────────────────────────── */}
      {isOffline ? (
        <>
          {/* dead eyes — horizontal lines */}
          <rect x="9" y="13" width="2" height="1" fill={p.primary} />
          <rect x="13" y="13" width="2" height="1" fill={p.primary} />
        </>
      ) : (
        <>
          {/* left eye — 2×2 pixel block */}
          <rect className={isStatic ? "" : "tama-svg-eye"} x="9" y="12" width="2" height="2" fill={p.primary} />
          {/* right eye — 2×2 pixel block */}
          <rect className={isStatic ? "" : "tama-svg-eye"} x="13" y="12" width="2" height="2" fill={p.primary} />
          {/* eye highlights (sub-pixel glint) */}
          <rect x="9" y="12" width="1" height="1" fill="white" opacity="0.2" />
          <rect x="13" y="12" width="1" height="1" fill="white" opacity="0.2" />
        </>
      )}

      {/* ── Mouth ────────────────────────────────────────── */}
      {isHyped ? (
        /* wide happy mouth — 4px wide, 2px tall */
        <>
          <rect x="10" y="16" width="4" height="1" fill={p.primary} />
          <rect x="11" y="17" width="2" height="1" fill={p.primary} opacity="0.7" />
        </>
      ) : isAlert ? (
        /* small worried dot */
        <rect x="11" y="16" width="2" height="1" fill={p.primary} opacity="0.8" />
      ) : isOffline ? (
        /* flat line */
        <rect x="10" y="16" width="4" height="1" fill={p.primary} opacity="0.35" />
      ) : (
        /* neutral dash */
        <rect x="10" y="16" width="4" height="1" fill={p.primary} opacity="0.7" />
      )}

      {/* ── Circuit traces (robot detail) ────────────────── */}
      {/* left circuit line */}
      <rect x="5" y="14" width="2" height="1" fill={p.dim} opacity="0.2" />
      <rect x="5" y="16" width="1" height="1" fill={p.dim} opacity="0.15" />
      {/* right circuit line */}
      <rect x="17" y="14" width="2" height="1" fill={p.dim} opacity="0.2" />
      <rect x="18" y="16" width="1" height="1" fill={p.dim} opacity="0.15" />

      {/* ── Spark / LED indicator (top-right) ────────────── */}
      <rect
        className={isStatic ? "" : "tama-svg-spark"}
        x="18" y="7"
        width="2" height="2"
        fill={p.spark}
        opacity={isOffline ? 0.15 : 0.8}
      />

      {/* ── Feet / base pads ─────────────────────────────── */}
      <rect x="6" y="24" width="3" height="2" fill={p.primary} opacity="0.5" />
      <rect x="15" y="24" width="3" height="2" fill={p.primary} opacity="0.5" />
      {/* grounding pixels */}
      <rect x="7" y="26" width="1" height="1" fill={p.dim} opacity="0.2" />
      <rect x="16" y="26" width="1" height="1" fill={p.dim} opacity="0.2" />
    </svg>
  );
}
