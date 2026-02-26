import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: "#07213b",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 96 96"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="10" y="10" width="76" height="76" rx="14" fill="#0b2e52" stroke="#2af2d2" strokeWidth="2" />
          <rect x="24" y="28" width="8" height="8" fill="#53ffd8" />
          <rect x="32" y="28" width="8" height="8" fill="#2af2d2" />
          <rect x="56" y="28" width="8" height="8" fill="#2af2d2" />
          <rect x="64" y="28" width="8" height="8" fill="#53ffd8" />
          <rect x="28" y="36" width="40" height="8" fill="#2af2d2" />
          <rect x="20" y="44" width="56" height="16" fill="#16c3b6" />
          <rect x="24" y="48" width="8" height="8" fill="#062741" />
          <rect x="64" y="48" width="8" height="8" fill="#062741" />
          <rect x="36" y="56" width="24" height="8" fill="#0a365d" />
          <rect x="24" y="64" width="48" height="8" fill="#2af2d2" />
          <rect x="32" y="72" width="32" height="4" fill="#53ffd8" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
