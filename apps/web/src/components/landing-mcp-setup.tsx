"use client";

import { useState, useEffect } from "react";
import {
  EDITORS,
  PLACEHOLDER,
  MCP_URL,
  SERVER_NAME,
  SETUP_METHOD_LABELS,
} from "@/lib/mcp-editors";
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
  const scope = editor.scopes[0];
  const setupText = scope.content(activeKey, MCP_URL, SERVER_NAME);

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

      {/* Recommended setup */}
      <div className="overflow-hidden rounded-xl bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            </div>
            <span className="ml-2 text-xs font-medium text-muted-foreground">{editor.name}</span>
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
              {SETUP_METHOD_LABELS[scope.method]}
            </span>
          </div>
          <TerminalCopyButton text={setupText} />
        </div>
        {scope.note && (
          <p className="border-b border-border px-5 py-3 text-xs leading-relaxed text-muted-foreground">
            {scope.note}
          </p>
        )}
        <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-relaxed">
          <code className="text-card-foreground" data-language={scope.language}>
            {hasRealKey
              ? setupText.split(activeKey).map((part, i, arr) => (
                  <span key={i}>
                    {part}
                    {i < arr.length - 1 && <span className="text-brand">{activeKey}</span>}
                  </span>
                ))
              : setupText}
          </code>
        </pre>
        {editor.callout && (
          <p className="border-t border-border bg-muted/20 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
            {editor.callout}
          </p>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-4 text-[11px] tracking-wide text-muted-foreground">
        {!hasRealKey ? <span>Sign in above to get your key auto-filled where supported</span> : <span />}
        <a className="shrink-0 transition-colors hover:text-foreground" href="/docs/mcp/setup">
          All scopes and fallbacks →
        </a>
      </div>
    </div>
  );
}
