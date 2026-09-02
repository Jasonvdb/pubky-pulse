import { ImageResponse } from "next/og";
import { OG_TOKENS } from "@/lib/og/og-constants";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * The pulse mark as a self-contained SVG data URI.
 *
 * satori cannot rasterise an inline `<svg>` element, so the mark is handed to
 * it as an `<img>` source. Base64 (rather than a percent-encoded utf8 payload)
 * keeps the `#` in the colour literals from terminating the URI.
 */
const MARK = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="110" height="110" viewBox="0 0 32 32" fill="none"><path d="M2 16H9.5L13 6L17.5 26L21 16H30" stroke="${OG_TOKENS.brand}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
).toString("base64")}`;

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
          background: OG_TOKENS.background,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MARK} width={110} height={110} alt="" />
      </div>
    ),
    { ...size }
  );
}
