import { ImageResponse } from "next/og";

/**
 * The home-screen icon on iOS.
 *
 * iOS ignores the manifest's icons entirely and looks for an apple-touch-icon;
 * without one it screenshots the page, which makes an installed app look
 * broken. Same artwork as `icon.tsx`, at the size iOS actually asks for, and
 * without the maskable safe area — iOS applies its own rounded rectangle and
 * never crops to a circle, so the mark can sit larger in the frame.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #7c5cff 0%, #5b3df5 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            width: 124,
            height: 90,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              width: 82,
              height: 82,
              borderRadius: "50%",
              border: "12px solid rgba(255,255,255,0.95)",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              width: 82,
              height: 82,
              borderRadius: "50%",
              border: "12px solid rgba(255,255,255,0.55)",
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
