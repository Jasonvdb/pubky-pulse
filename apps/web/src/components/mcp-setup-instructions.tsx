"use client";

import { useState, useEffect } from "react";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Eye, EyeOff, LogIn, KeyRound } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { CopyButton } from "@/components/copy-button";
import { api } from "@/lib/api";
import {
  EDITORS,
  PLACEHOLDER,
  MCP_URL,
  SERVER_NAME,
  SETUP_METHOD_LABELS,
  maskKey,
} from "@/lib/mcp-editors";

function renderNote(note: string) {
  return (
    <div className="mb-3 text-sm [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs">
      {note.split("\n").map((line, i) => {
        if (line.startsWith("```")) return null;
        if (line.startsWith("- **")) {
          const match = line.match(/- \*\*(.+?)\*\* `(.+?)`/);
          if (match)
            return (
              <p key={i}>
                <strong>{match[1]}</strong> <code>{match[2]}</code>
              </p>
            );
        }
        if (line.match(/^\d+\./)) {
          return <p key={i}>{line}</p>;
        }
        if (line.trim() === "") return null;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

export function McpSetupInstructions() {
  const { user, teams, isLoading, mutate } = useUser();
  const [keyVisible, setKeyVisible] = useState(false);
  const [lazyCreating, setLazyCreating] = useState(false);
  const [scopeSelections, setScopeSelections] = useState<Record<string, number>>({});

  // Determine auth state
  const isAuthenticated = !!user;
  const firstTeam = teams?.[0];
  const defaultKey = firstTeam?.default_agent_key;
  const activeKey = defaultKey || PLACEHOLDER;
  const displayKey = keyVisible ? activeKey : maskKey(activeKey);
  const hasRealKey = activeKey !== PLACEHOLDER;

  // Auto lazy-create if authenticated but no key
  useEffect(() => {
    if (!isAuthenticated || !firstTeam || defaultKey || lazyCreating) return;

    setLazyCreating(true);
    api
      .post<{ secret: string; created: boolean }>("/v1/auth/default-agent-key", {
        team_id: firstTeam.id,
      })
      .then(() => {
        mutate(); // Refresh /v1/auth/me to pick up the new key
      })
      .catch(() => {
        // Silently fail — user can still copy configs with placeholder
      })
      .finally(() => setLazyCreating(false));
  }, [isAuthenticated, firstTeam, defaultKey, lazyCreating, mutate]);

  if (isLoading) {
    return (
      <div className="my-6 rounded-lg border border-border bg-card p-6 animate-pulse">
        <div className="h-4 w-48 rounded bg-muted" />
        <div className="mt-4 h-32 rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="my-6">
      {/* Auth status banner */}
      {!isAuthenticated ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-chart-3/30 bg-chart-3/10 px-4 py-3">
          <LogIn className="h-4 w-4 shrink-0 text-chart-3" />
          <p className="flex-1 text-sm text-foreground">
            Sign in to get your API key pre-filled in the setup methods that can safely use it.
          </p>
          <a
            href="/login?redirect=/docs/mcp/setup"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-background shadow-xs transition-all outline-none hover:bg-brand/90 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Sign in
          </a>
        </div>
      ) : hasRealKey ? (
        <div className="mb-4 rounded-lg border border-chart-2/30 bg-chart-2/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <KeyRound className="h-4 w-4 shrink-0 text-chart-2" />
            <p className="flex-1 text-sm text-foreground">
              Your agent API key is pre-filled in the setup methods that can safely use it.
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setKeyVisible(!keyVisible)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-chart-2 transition-colors outline-none hover:bg-chart-2/20 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                title={keyVisible ? "Hide key" : "Show key"}
              >
                {keyVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {keyVisible ? "Hide" : "Show"}
              </button>
              <CopyButton text={activeKey} />
            </div>
          </div>
          {/* Key display */}
          <div className="mt-2 flex items-center gap-2 rounded bg-background/60 px-3 py-1.5 font-mono text-xs text-chart-2/90">
            {displayKey}
          </div>
        </div>
      ) : lazyCreating ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 animate-pulse">
          <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Creating your default agent key...</p>
        </div>
      ) : null}

      {/* MCP client setup tabs */}
      <Tabs items={EDITORS.map((e) => e.name)}>
        {EDITORS.map((editor) => {
          const scopeIdx = scopeSelections[editor.name] ?? 0;
          const scope = editor.scopes[scopeIdx];
          const setupText = scope.content(activeKey, MCP_URL, SERVER_NAME);
          const setupDisplay = scope.content(displayKey, MCP_URL, SERVER_NAME);
          return (
            <Tab key={editor.name} value={editor.name}>
              {/* Scope toggle — only shown when editor has multiple scopes */}
              {editor.scopes.length > 1 && (
                <div className="mb-3 inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
                  {editor.scopes.map((s, i) => (
                    <button
                      key={s.label}
                      type="button"
                      aria-pressed={scopeIdx === i}
                      onClick={() =>
                        setScopeSelections((prev) => ({ ...prev, [editor.name]: i }))
                      }
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        scopeIdx === i
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-brand/10 px-2 py-0.5 font-semibold uppercase tracking-wide text-brand">
                  {SETUP_METHOD_LABELS[scope.method]}
                </span>
                <span>{scope.label}</span>
              </div>

              {/* Note */}
              {scope.note && renderNote(scope.note)}

              {/* Copyable setup content */}
              <div className="relative">
                <pre className="overflow-x-auto rounded-lg border border-border bg-fd-code-background p-4 text-sm">
                  <code data-language={scope.language}>{setupDisplay}</code>
                </pre>
                <div className="absolute right-2 top-2">
                  <CopyButton text={setupText} />
                </div>
              </div>

              {/* Callout */}
              {editor.callout && (
                <div className="mt-3 rounded-lg border border-fd-border bg-fd-card px-4 py-3 text-sm text-fd-muted-foreground">
                  {editor.callout}
                </div>
              )}
            </Tab>
          );
        })}
      </Tabs>
    </div>
  );
}
