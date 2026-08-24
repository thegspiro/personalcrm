import { ImageResponse } from "next/og";

/**
 * The app icon, drawn rather than shipped as a binary.
 *
 * Generated at build time so there is no PNG to keep in sync with the theme,
 * and so the repository carries no binary assets. The safe area is deliberate:
 * a maskable icon gets cropped to whatever shape the launcher uses, so the
 * mark sits well inside the circle.
 */
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
        {/* Two overlapping rings — people, connected. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            width: 260,
            height: 190,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              width: 170,
              height: 170,
              borderRadius: "50%",
              border: "26px solid rgba(255,255,255,0.95)",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              width: 170,
              height: 170,
              borderRadius: "50%",
              border: "26px solid rgba(255,255,255,0.55)",
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
