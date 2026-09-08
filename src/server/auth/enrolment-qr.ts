import "server-only";
import QRCode from "qrcode";
import { createLogger } from "@/server/log";

const log = createLogger("two-factor");

/**
 * The enrolment URI as a scannable code, encoded as a data URI.
 *
 * An `<img>` rather than inline markup, which keeps it out of
 * `dangerouslySetInnerHTML` entirely — the content security policy already
 * allows `data:` images, so nothing about the policy has to be relaxed for it.
 * The generated SVG carries only path data; the URI itself is encoded into the
 * modules and never echoed into the markup, so there is no text to escape.
 *
 * White background, in both themes, deliberately. A code is read by a camera
 * looking for high contrast between light and dark modules, and inverting it
 * to suit a dark page is how you produce one that some scanners refuse.
 */
export async function qrDataUri(uri: string): Promise<string | null> {
  try {
    const svg = await QRCode.toString(uri, {
      type: "svg",
      margin: 1,
      width: 208,
      color: { dark: "#000000", light: "#ffffff" },
      errorCorrectionLevel: "M",
    });
    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  } catch (error) {
    // The key is shown as text beside this, so enrolment still works. Losing
    // the picture is a worse experience, not a broken one.
    log.error("could not draw the enrolment code", error);
    return null;
  }
}
