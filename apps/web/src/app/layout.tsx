import type { Metadata, Viewport } from "next";
import { Inter_Tight } from "next/font/google";
import "./globals.css";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { SWRProvider } from "@/lib/swr";
import { TooltipProvider } from "@/components/ui/tooltip";

const interTight = Inter_Tight({ subsets: ["latin"] });

const TITLE = "Pubky Pulse — Agent-First Observability";
const DESCRIPTION =
  "Self-hosted observability for web, backend and mobile apps. Events, metrics, funnels, in-app questionnaires and error tracking, driven by your coding agent over MCP.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// The product has a single, permanently dark theme. Declaring it here keeps the
// browser chrome and form controls dark instead of flashing a light default.
export const viewport: Viewport = {
  themeColor: "#05050A",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
      <body className={interTight.className}>
        <SWRProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </SWRProvider>
      </body>
    </html>
  );
}
