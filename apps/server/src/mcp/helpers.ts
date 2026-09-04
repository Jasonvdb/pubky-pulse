import type { FastifyInstance, InjectOptions } from "fastify";

export interface CallToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface InjectResult {
  statusCode: number;
  body: Record<string, unknown>;
}

type ApiOpts = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  payload?: Record<string, unknown> | Array<unknown>;
};

async function inject(app: FastifyInstance, agentKey: string, opts: ApiOpts): Promise<InjectResult> {
  const injectOpts: InjectOptions = {
    method: opts.method,
    url: opts.url,
    headers: { authorization: `Bearer ${agentKey}` },
  };
  if (opts.payload !== undefined) {
    injectOpts.payload = opts.payload;
  }
  const res = await app.inject(injectOpts);
  return { statusCode: res.statusCode, body: res.json() };
}

/**
 * Turn a REST refusal into something an agent can act on.
 *
 * The REST handlers are the single enforcement boundary — no MCP tool
 * re-implements the access rules — so a tool result carries whatever the route
 * decided. The raw body is just `{ error: "..." }`, which does not tell an
 * agent whether to give up, ask a human for a permission, or ask a human for
 * project ownership. Those are very different next moves, so the status code
 * and a one-line hint are attached alongside the original message.
 *
 * The hint never asserts anything the server did not: it is keyed off the
 * status and the exact refusal strings the central access layer produces
 * (`utils/project-access.ts`).
 */
function errorHint(status: number, message: string): string | undefined {
  if (status === 401) {
    return "This agent key is not valid for the request: it may be revoked or expired, or the person who created it may no longer be an active team member on an allowed email domain. A human has to issue a new key.";
  }
  if (status === 404) {
    return "No such resource for this key, or it does not belong to the project/parent named in this call. Re-read the ids with a list or get tool instead of retrying.";
  }
  if (status !== 403) return undefined;
  if (/^missing permission/i.test(message)) {
    return "The key was never granted this permission. Only a human can add it — project ownership does not substitute for it.";
  }
  if (/project ownership/i.test(message)) {
    return "Reads span every project in the team, but this write also needs the human who created this key to own this project. Once a human project owner adds them to the project's owner list, the very next call succeeds with this same key — it does not need to be recreated.";
  }
  if (/requires a user session/i.test(message) || /^only users /i.test(message)) {
    return "Human-only operation: no permission or ownership change unlocks it for an agent key. Ask a human to do it (owner-list changes and deleting projects, apps, feedback, questionnaires, responses, attachments or another author's comment are all human-only).";
  }
  return "Authenticated but not authorized for this operation — see the `pubky-pulse://guide` resource, section \"Access Model\".";
}

function toToolResult(result: InjectResult): CallToolResult {
  if (result.statusCode >= 400) {
    const body =
      typeof result.body === "object" && result.body !== null
        ? result.body
        : { error: String(result.body) };
    const message = typeof body.error === "string" ? body.error : "";
    const hint = errorHint(result.statusCode, message);
    const payload = { status: result.statusCode, ...body, ...(hint ? { hint } : {}) };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(result.body, null, 2) }] };
}

/** Call an internal API route and return an MCP CallToolResult. */
export async function callApi(
  app: FastifyInstance,
  agentKey: string,
  opts: ApiOpts,
): Promise<CallToolResult> {
  return toToolResult(await inject(app, agentKey, opts));
}

/** Call an internal API route and return the parsed JSON body directly. Returns null on error. */
export async function callApiRaw(
  app: FastifyInstance,
  agentKey: string,
  opts: ApiOpts,
): Promise<{ body: Record<string, unknown>; error?: CallToolResult }> {
  const result = await inject(app, agentKey, opts);
  if (result.statusCode >= 400) {
    return { body: result.body, error: toToolResult(result) };
  }
  return { body: result.body };
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
  );
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}
