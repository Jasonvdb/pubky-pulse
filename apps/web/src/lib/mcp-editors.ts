import { API_URL } from "@/lib/api";

export const PLACEHOLDER = "YOUR_AGENT_KEY";

export function maskKey(key: string): string {
  if (!key || key === PLACEHOLDER) return PLACEHOLDER;
  const visible = key.slice(0, 20); // "pulse_agent_" + 8 hex chars
  return `${visible}${"*".repeat(8)}`;
}

export const MCP_URL = `${API_URL}/mcp`;
const IS_DEV = process.env.NODE_ENV === "development";
export const SERVER_NAME = IS_DEV ? "pubky-pulse-local-dev" : "pubky-pulse";

export type SetupMethod = "command" | "native-ui" | "config";

export const SETUP_METHOD_LABELS: Record<SetupMethod, string> = {
  command: "Command",
  "native-ui": "Native UI",
  config: "Config",
};

export interface EditorScope {
  label: string;
  method: SetupMethod;
  language: string;
  note?: string;
  /** Returns the setup content with the key, MCP URL, and server name injected. */
  content: (key: string, url: string, name: string) => string;
}

export interface EditorConfig {
  name: string;
  callout?: string;
  scopes: EditorScope[];
}

export const EDITORS: EditorConfig[] = [
  {
    name: "Claude Code",
    callout: "Verify the connection by typing /mcp in Claude Code.",
    scopes: [
      {
        label: "Add globally",
        method: "command",
        language: "bash",
        note: "Fastest setup. Available across all your projects and stored in your user config.",
        content: (key, url, name) =>
          `claude mcp add --transport http --scope user ${name} ${url} \\
  --header "Authorization: Bearer ${key}"`,
      },
      {
        label: "Share with project",
        method: "command",
        language: "bash",
        note:
          "Writes a shareable .mcp.json in the project root. Set PUBKY_PULSE_AGENT_KEY before starting Claude Code; never commit a literal agent key.",
        content: (_key, url, name) =>
          `claude mcp add --transport http --scope project ${name} ${url} \\
  --header 'Authorization: Bearer \${PUBKY_PULSE_AGENT_KEY}'`,
      },
    ],
  },
  {
    name: "Codex",
    callout:
      "The Codex CLI cannot add a literal static header; its command path requires a durable bearer-token environment variable.",
    scopes: [
      {
        label: "Add globally",
        method: "config",
        language: "toml",
        note: "Add to ~/.codex/config.toml for a self-contained setup:",
        content: (key, url, name) =>
          `[mcp_servers.${name}]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${key}" }`,
      },
      {
        label: "Just current project",
        method: "config",
        language: "toml",
        note: "Add to .codex/config.toml in a trusted project:",
        content: (key, url, name) =>
          `[mcp_servers.${name}]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${key}" }`,
      },
      {
        label: "CLI with env var",
        method: "command",
        language: "bash",
        note:
          "First set PUBKY_PULSE_AGENT_KEY in the environment that launches Codex. This adds the server to your user config without putting the key in the command.",
        content: (_key, url, name) =>
          `codex mcp add ${name} --url ${url} --bearer-token-env-var PUBKY_PULSE_AGENT_KEY`,
      },
    ],
  },
  {
    name: "OpenCode",
    scopes: [
      {
        label: "Add globally",
        method: "command",
        language: "bash",
        note:
          "Fastest setup. If your installed version does not recognize --url or --header, update OpenCode.",
        content: (key, url, name) =>
          `opencode mcp add ${name} --url ${url} --header "Authorization=Bearer ${key}"`,
      },
      {
        label: "Project config",
        method: "config",
        language: "json",
        note:
          "Add to opencode.json or opencode.jsonc in the project root. Set PUBKY_PULSE_AGENT_KEY before launching OpenCode; the config references it without storing the key.",
        content: (_key, url, name) =>
          JSON.stringify(
            {
              $schema: "https://opencode.ai/config.json",
              mcp: {
                [name]: {
                  type: "remote",
                  url,
                  oauth: false,
                  headers: { Authorization: "Bearer {env:PUBKY_PULSE_AGENT_KEY}" },
                },
              },
            },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "Cursor",
    callout:
      "The official install deep link is intentionally not used here because it would put your live agent key in a URL and browser history.",
    scopes: [
      {
        label: "Add globally",
        method: "config",
        language: "json",
        note: "Add to ~/.cursor/mcp.json:",
        content: (key, url, name) =>
          JSON.stringify(
            {
              mcpServers: {
                [name]: { type: "http", url, headers: { Authorization: `Bearer ${key}` } },
              },
            },
            null,
            2,
          ),
      },
      {
        label: "Just current project",
        method: "config",
        language: "json",
        note:
          "Add to .cursor/mcp.json. This file may be shared: never commit the generated literal key; use Cursor's ${env:PUBKY_PULSE_AGENT_KEY} interpolation first.",
        content: (key, url, name) =>
          JSON.stringify(
            {
              mcpServers: {
                [name]: { type: "http", url, headers: { Authorization: `Bearer ${key}` } },
              },
            },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "VS Code",
    callout:
      "You can also run MCP: Add Server from the Command Palette. The command example uses POSIX shell quoting; use the Command Palette on Windows.",
    scopes: [
      {
        label: "Add to user profile",
        method: "command",
        language: "bash",
        note: "Fastest global setup. The server is available in every workspace opened by this profile.",
        content: (key, url, name) =>
          `code --add-mcp '${JSON.stringify({
            name,
            type: "http",
            url,
            headers: { Authorization: `Bearer ${key}` },
          })}'`,
      },
      {
        label: "Share with project",
        method: "config",
        language: "json",
        note:
          "Add to .vscode/mcp.json. VS Code prompts for the key as a password input, keeping it out of the shared file.",
        content: (_key, url, name) =>
          JSON.stringify(
            {
              servers: {
                [name]: {
                  type: "http",
                  url,
                  headers: {
                    Authorization: "Bearer ${input:pubky-pulse-agent-key}",
                  },
                },
              },
              inputs: [
                {
                  type: "promptString",
                  id: "pubky-pulse-agent-key",
                  description: "Pubky Pulse agent key",
                  password: true,
                },
              ],
            },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "Claude Desktop",
    callout:
      "Direct connection works only when Add custom connector exposes custom HTTP request-header fields, a beta and organization-dependent feature. If those fields are absent, Claude Desktop cannot connect directly because Pubky Pulse requires bearer authentication. Custom connectors may be shared with the organization, so a per-user agent key may be unsuitable; confirm your organization's policy before saving it.",
    scopes: [
      {
        label: "Direct remote (beta)",
        method: "native-ui",
        language: "text",
        note:
          "Open Customize > Connectors > Add custom connector in Claude Desktop, enter these values, then save.",
        content: (key, url) =>
          `URL: ${url}\nHTTP header name: Authorization\nHTTP header value: Bearer ${key}`,
      },
    ],
  },
  {
    name: "Windsurf",
    callout:
      "For shared config, use Windsurf's ${env:PUBKY_PULSE_AGENT_KEY} or ${file:/path/to/secret} interpolation instead of committing a literal key. Organization admins may also restrict MCP servers with an allowlist.",
    scopes: [
      {
        label: "Add globally",
        method: "config",
        language: "json",
        note:
          "Open Windsurf Settings > Cascade > MCP Servers > View raw config, then add this entry. The file is ~/.codeium/windsurf/mcp_config.json.",
        content: (key, url, name) =>
          JSON.stringify(
            { mcpServers: { [name]: { url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "Zed",
    callout: "Zed has no MCP add command; use its native UI or project settings.",
    scopes: [
      {
        label: "Add globally",
        method: "native-ui",
        language: "text",
        note:
          "Open Settings > AI > MCP Servers > Add Server > Add Remote Server in Zed, enter these values, then save.",
        content: (key, url, name) =>
          `Name: ${name}\nURL: ${url}\nHTTP header name: Authorization\nHTTP header value: Bearer ${key}`,
      },
      {
        label: "Project settings",
        method: "config",
        language: "json",
        note:
          "Add to .zed/settings.json only in a project you trust. Never commit the generated literal key.",
        content: (key, url, name) =>
          JSON.stringify(
            {
              context_servers: {
                [name]: { url, headers: { Authorization: `Bearer ${key}` } },
              },
            },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "JetBrains",
    callout:
      "Use a current IDE and AI Assistant plugin. Organization policy may disable MCP or restrict which servers can be added.",
    scopes: [
      {
        label: "Global level",
        method: "config",
        language: "json",
        note:
          "Open Settings > Tools > AI Assistant > Model Context Protocol (MCP), click +, choose the Global level, and enter this configuration:",
        content: (key, url, name) =>
          JSON.stringify(
            { mcpServers: { [name]: { url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
      {
        label: "Project level",
        method: "config",
        language: "json",
        note:
          "Open Settings > Tools > AI Assistant > Model Context Protocol (MCP), click +, choose the Project level, and enter this configuration. Only do this in a project you trust.",
        content: (key, url, name) =>
          JSON.stringify(
            { mcpServers: { [name]: { url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "Cline",
    callout:
      "The Cline CLI is separate from the Cline VS Code extension. The default setup below configures the extension; the CLI wizard is a separate option.",
    scopes: [
      {
        label: "VS Code extension",
        method: "config",
        language: "json",
        note:
          "Open the Cline sidebar, select MCP Servers, then Edit MCP Settings and add this entry:",
        content: (key, url, name) =>
          JSON.stringify(
            {
              mcpServers: {
                [name]: {
                  type: "streamableHttp",
                  url,
                  headers: { Authorization: `Bearer ${key}` },
                },
              },
            },
            null,
            2,
          ),
      },
      {
        label: "Cline CLI",
        method: "command",
        language: "bash",
        note:
          "Fastest Cline CLI setup. This opens a wizard where you add the Authorization header; it does not configure the VS Code extension.",
        content: (_key, url, name) => `cline mcp install ${name} --transport http ${url}`,
      },
    ],
  },
  {
    name: "Roo Code",
    callout:
      "Project-level .roo/mcp.json may be committed. Never put the generated literal agent key in a shared repository.",
    scopes: [
      {
        label: "Add globally",
        method: "config",
        language: "json",
        note: "Open the Roo Code MCP server view, choose global configuration, and add this entry:",
        content: (key, url, name) =>
          JSON.stringify(
            {
              mcpServers: {
                [name]: {
                  type: "streamable-http",
                  url,
                  headers: { Authorization: `Bearer ${key}` },
                },
              },
            },
            null,
            2,
          ),
      },
      {
        label: "Just current project",
        method: "config",
        language: "json",
        note:
          "Add to .roo/mcp.json in the project root. Replace the generated key with a local secret before committing the file.",
        content: (key, url, name) =>
          JSON.stringify(
            {
              mcpServers: {
                [name]: {
                  type: "streamable-http",
                  url,
                  headers: { Authorization: `Bearer ${key}` },
                },
              },
            },
            null,
            2,
          ),
      },
    ],
  },
];
