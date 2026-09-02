import { ImageResponse } from "next/og";
import { OG_SIZE, OG_TOKENS } from "@/lib/og/og-constants";
import { getOgFonts } from "@/lib/og/og-fonts";

export const alt =
  "Pubky Pulse — agent-first observability for web, backend and mobile apps";
export const size = OG_SIZE;
export const contentType = "image/png";

const PILLS = ["Events", "Metrics", "Funnels", "Issues"];

/**
 * The pulse mark as a self-contained SVG data URI.
 *
 * satori cannot rasterise an inline `<svg>` element, so the mark is handed to
 * it as an `<img>` source. Base64 (rather than a percent-encoded utf8 payload)
 * keeps the `#` in the colour literals from terminating the URI.
 */
const MARK = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 32 32" fill="none"><path d="M2 16H9.5L13 6L17.5 26L21 16H30" stroke="${OG_TOKENS.brand}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
).toString("base64")}`;

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: OG_TOKENS.background,
          position: "relative",
        }}
      >
        {/*
          Deliberately flat: satori's rasteriser bands large radial gradients
          into visible concentric rings, and the design system is flat dark with
          lime as its only accent anyway — the mark and the footer carry it.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MARK} width={140} height={140} alt="" style={{ marginBottom: 28 }} />

        <div
          style={{
            display: "flex",
            fontSize: 56,
            fontWeight: 700,
            color: OG_TOKENS.foreground,
            letterSpacing: "-1.5px",
          }}
        >
          Pubky Pulse
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 26,
            fontWeight: 400,
            color: OG_TOKENS.mutedForeground,
            marginTop: 16,
          }}
        >
          Agent-first observability for web, backend and mobile apps
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 44 }}>
          {PILLS.map((label) => (
            <div
              key={label}
              style={{
                display: "flex",
                padding: "10px 24px",
                borderRadius: 100,
                border: `1px solid ${OG_TOKENS.avatarMuted}`,
                fontSize: 20,
                fontWeight: 500,
                color: OG_TOKENS.secondaryForeground,
              }}
            >
              {label}
            </div>
          ))}
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 40,
            display: "flex",
            fontSize: 20,
            fontWeight: 500,
            color: OG_TOKENS.brand,
            letterSpacing: "0.5px",
          }}
        >
          pulse.pubky.org
        </div>
      </div>
    ),
    { ...size, fonts: getOgFonts() }
  );
}
