"use client";

import { useState, useEffect, useRef } from "react";
import { Copy, Check } from "lucide-react";

export function TerminalCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied!" : "Copy"}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      className="p-1.5 rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground hover:bg-white/5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-chart-2" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
