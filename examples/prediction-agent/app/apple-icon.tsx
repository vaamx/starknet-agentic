import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon — static snapshot of the TamagotchiSVG pixel robot.
 * Same 24×28 grid geometry used by the dashboard badge (focus mood palette).
 */
export default function AppleIcon() {
  const primary = "#7ce8ff";
  const screen = "#082238";
  const shell = "#071a2e";
  const dim = "#3bb8e8";

  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: "#07213b",
          borderRadius: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="130"
          height="150"
          viewBox="0 0 24 28"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Antenna ball */}
          <rect x="11" y="0" width="2" height="2" fill={primary} opacity="0.9" />
          {/* Antenna stem */}
          <rect x="11" y="2" width="2" height="3" fill={primary} opacity="0.6" />

          {/* Shell border */}
          <rect x="5" y="6" width="14" height="1" fill={primary} opacity="0.8" />
          <rect x="4" y="7" width="1" height="16" fill={primary} opacity="0.8" />
          <rect x="19" y="7" width="1" height="16" fill={primary} opacity="0.8" />
          <rect x="5" y="23" width="14" height="1" fill={primary} opacity="0.8" />
          {/* Shell fill */}
          <rect x="5" y="7" width="14" height="16" fill={shell} />

          {/* Screen */}
          <rect x="7" y="9" width="10" height="12" fill={screen} />

          {/* Eyes — 2×2 blocks */}
          <rect x="9" y="12" width="2" height="2" fill={primary} />
          <rect x="13" y="12" width="2" height="2" fill={primary} />
          {/* Eye glints */}
          <rect x="9" y="12" width="1" height="1" fill="white" opacity="0.2" />
          <rect x="13" y="12" width="1" height="1" fill="white" opacity="0.2" />

          {/* Mouth */}
          <rect x="10" y="16" width="4" height="1" fill={primary} opacity="0.7" />

          {/* Circuit traces */}
          <rect x="5" y="14" width="2" height="1" fill={dim} opacity="0.2" />
          <rect x="17" y="14" width="2" height="1" fill={dim} opacity="0.2" />

          {/* Spark LED */}
          <rect x="18" y="7" width="2" height="2" fill={primary} opacity="0.8" />

          {/* Feet */}
          <rect x="6" y="24" width="3" height="2" fill={primary} opacity="0.5" />
          <rect x="15" y="24" width="3" height="2" fill={primary} opacity="0.5" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
