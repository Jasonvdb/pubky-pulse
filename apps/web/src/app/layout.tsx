import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { SWRProvider } from "@/lib/swr";
import { TooltipProvider } from "@/components/ui/tooltip";

const dmSans = DM_Sans({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://owlmetry.com"),
  title: {
    default: "Owlmetry — Agent-First Observability for Mobile Apps",
    template: "%s | Owlmetry",
  },
  description:
    "Self-hosted observability for web, backend and mobile apps. Events, metrics, funnels, in-app questionnaires, and error tracking — purpose-built for AI coding agents.",
  openGraph: {
    type: "website",
    siteName: "Owlmetry",
    title: "Owlmetry — Agent-First Observability for Mobile Apps",
    description:
      "Self-hosted observability for web, backend and mobile apps. Events, metrics, funnels, questionnaires, and error tracking.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Owlmetry — Agent-First Observability for Mobile Apps",
    description:
      "Self-hosted observability for web, backend and mobile apps. Events, metrics, funnels, and questionnaires — driven by your coding agent.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={dmSans.className}>
        <SWRProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </SWRProvider>
      </body>
    </html>
  );
}
