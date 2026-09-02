"use client";

import { useState, useEffect } from "react";
import { EDITORS, PLACEHOLDER, MCP_URL, SERVER_NAME } from "@/lib/mcp-editors";
import { useUser } from "@/hooks/use-user";
import { api } from "@/lib/api";
import { TerminalCopyButton } from "@/components/terminal-copy-button";

export function LandingMcpSetup() {
  const { user, teams, mutate } = useUser();
  const [selectedEditor, setSelectedEditor] = useState(0);
  const [lazyCreating, setLazyCreating] = useState(false);

  const isAuthenticated = !!user;
  const firstTeam = teams?.[0];
  const defaultKey = firstTeam?.default_agent_key;

  // Auto lazy-create if authenticated but no key
  useEffect(() => {
    if (!isAuthenticated || !firstTeam || defaultKey || lazyCreating) return;
    setLazyCreating(true);
    api
      .post<{ secret: string; created: boolean }>("/v1/auth/default-agent-key", {
        team_id: firstTeam.id,
      })
      .then(() => mutate())
      .catch(() => {})
      .finally(() => setLazyCreating(false));
  }, [isAuthenticated, firstTeam, defaultKey, lazyCreating, mutate]);
  const activeKey = defaultKey || PLACEHOLDER;
  const hasRealKey = activeKey !== PLACEHOLDER;

  const editor = EDITORS[selectedEditor];
  const configText = editor.scopes[0].config(activeKey, MCP_URL, SERVER_NAME);

  return (
    <div>
      {/* Editor pill selector with fade mask */}
      <div className="relative">
        <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-3">
          {EDITORS.map((e, i) => (
            <button
              key={e.name}
              type="button"
              onClick={() => setSelectedEditor(i)}
              aria-pressed={selectedEditor === i}
              className={`cursor-pointer whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                selectedEditor === i
                  ? "bg-brand text-background"
                  : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              }`}
            >
              {e.name}
            </button>
          ))}
        </div>
        {/* Right fade to hint at scrollability */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-3 w-12 bg-linear-to-r from-transparent to-background" />
      </div>

      {/* Config display */}
      <div className="overflow-hidden rounded-xl bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            </div>
            <span className="ml-2 text-xs font-medium text-muted-foreground">{editor.name}</span>
          </div>
          <TerminalCopyButton text={configText} />
        </div>
        <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-relaxed">
          <code className="text-card-foreground">
            {hasRealKey
              ? configText.split(activeKey).map((part, i, arr) => (
                  <span key={i}>
                    {part}
                    {i < arr.length - 1 && <span className="text-brand">{activeKey}</span>}
                  </span>
                ))
              : configText}
          </code>
        </pre>
      </div>

      {/* Note — only show when no real key */}
      {!hasRealKey && (
        <p className="mt-2.5 text-[11px] tracking-wide text-muted-foreground">
          Sign in above to get your key auto-filled
        </p>
      )}
    </div>
  );
}
