import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import type { Permission } from "@pubky-pulse/shared";
import {
  buildApp,
  truncateAll,
  seedTestData,
  createUserAndGetToken,
  createProjectWithOwner,
  addProjectOwner,
  TEST_DB_URL,
} from "./setup.js";

/**
 * MCP access control (handoff §9).
 *
 * MCP tools forward the agent credential into the REST handlers, and REST is
 * the single enforcement boundary — no tool re-implements the ACL. So this
 * suite is deliberately narrow: it proves the *delegation* actually reaches
 * the central checks, and that the discovery surfaces (SERVER_INSTRUCTIONS and
 * the `pubky-pulse://guide` resource) describe the policy that is really
 * enforced. `project-acl-matrix.test.ts` carries the exhaustive per-endpoint
 * matrix at the REST layer; duplicating it through JSON-RPC would only add
 * runtime.
 *
 * Actors, matching the other ACL suites:
 *   ownerA — team member, owner of Project A only;
 *   ownerB — team member, owner of Project B only.
 *
 * `agentOfOwnerA` is created by ownerA and holds every permission used below,
 * so a refusal is never ambiguous between "missing permission" and "creator
 * does not own the project".
 *
 * `pulse.pubky.org` and `example.com` are the suite's configured allowed
 * domains (vitest.config.ts); no deployment domain appears here.
 */

const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

/** Every permission any tool call in this suite needs. */
const AGENT_PERMISSIONS: Permission[] = [
  "projects:read",
  "projects:write",
  "apps:write",
  "metrics:write",
  "issues:write",
  "events:write",
  "questionnaires:write",
];

let app: FastifyInstance;
let client: postgres.Sql;

interface Actor {
  userId: string;
  token: string;
}

let teamId: string;
let ownerA: Actor;
let ownerB: Actor;
let projectA: string;
let projectB: string;
let appInB: string;
/** Agent key created by ownerA: owns Project A through its creator, not Project B. */
let agentOfOwnerA: string;

beforeAll(async () => {
  app = await buildApp();
  client = postgres(TEST_DB_URL, { max: 1 });
});

afterAll(async () => {
  await client.end();
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  const seeded = await seedTestData();
  teamId = seeded.teamId;

  ownerA = await signUp("mcp-owner-a@example.com");
  ownerB = await signUp("mcp-owner-b@example.com");

  projectA = await createProjectWithOwner(teamId, ownerA.userId, { name: "MCP Project A" });
  projectB = await createProjectWithOwner(teamId, ownerB.userId, { name: "MCP Project B" });
  appInB = await insertApp(projectB, "MCP App B");

  agentOfOwnerA = await insertAgentKey(ownerA.userId, AGENT_PERMISSIONS);
});

async function signUp(email: string): Promise<Actor> {
  const created = await createUserAndGetToken(app, email);
  return { userId: created.userId, token: created.token };
}

/**
 * Insert an agent key straight into the database, as the other ACL suites do:
 * these keys belong to plain members, and the point of the suite is what the
 * key can reach, not how it was minted.
 */
async function insertAgentKey(createdBy: string, permissions: Permission[]): Promise<string> {
  const secret = `pulse_agent_${randomUUID().replace(/-/g, "")}`;
  await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${secret}, 'agent', ${null}, ${teamId}, 'MCP ACL Test Agent Key', ${createdBy},
      ${JSON.stringify(permissions)}::jsonb
    )
  `;
  return secret;
}

function unique(): string {
  return randomUUID().slice(0, 8);
}

async function insertApp(projectId: string, name: string): Promise<string> {
  const [row] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
    VALUES (${teamId}, ${projectId}, ${name}, 'apple', ${`dev.mcpacl.${unique()}`})
    RETURNING id
  `;
  return row.id as string;
}

async function insertIssue(projectId: string, appId: string): Promise<string> {
  const [row] = await client`
    INSERT INTO issues (app_id, project_id, status, title, first_seen_at, last_seen_at)
    VALUES (${appId}, ${projectId}, 'new', ${"MCP ACL issue"}, now(), now())
    RETURNING id
  `;
  return row.id as string;
}

async function insertAttachment(projectId: string, appId: string): Promise<string> {
  const [row] = await client`
    INSERT INTO event_attachments (
      project_id, app_id, original_filename, content_type, size_bytes, sha256,
      storage_path, uploaded_at
    )
    VALUES (
      ${projectId}, ${appId}, 'mcp-acl.bin', 'application/octet-stream', ${64},
      ${"b".repeat(64)}, ${`mcp-acl/${unique()}`}, now()
    )
    RETURNING id
  `;
  return row.id as string;
}

/* ---------------------------------------------------------------------------
 * JSON-RPC plumbing — the same stateless shape `mcp.test.ts` uses.
 * ------------------------------------------------------------------------ */

async function mcpRequest(agentKey: string, method: string, params: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: { ...MCP_HEADERS, authorization: `Bearer ${agentKey}` },
    payload: { jsonrpc: "2.0", id: 1, method, params },
  });
}

interface ToolOutcome {
  isError: boolean;
  parsed: Record<string, unknown>;
}

/** Call one MCP tool and return its parsed JSON payload plus the error flag. */
async function callTool(
  agentKey: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<ToolOutcome> {
  const res = await mcpRequest(agentKey, "tools/call", { name: toolName, arguments: args });
  const body = res.json();
  const text = body.result?.content?.[0]?.text;
  expect(text, `tool ${toolName} returned no content: ${JSON.stringify(body)}`).toBeTruthy();
  return { isError: body.result.isError ?? false, parsed: JSON.parse(text) };
}

/* ------------------------------------------------------------------------- */

describe("MCP access control", () => {
  describe("reads span the team, writes follow the creator's ownership", () => {
    it("reads every project in the team and labels the creator's access level", async () => {
      const { isError, parsed } = await callTool(agentOfOwnerA, "list-projects", { team_id: teamId });
      expect(isError).toBe(false);

      const byId = new Map(
        (parsed.projects as { id: string; access_level: string }[]).map((p) => [p.id, p.access_level]),
      );
      // Project B is readable even though the key's creator does not own it —
      // reads are team-wide — and it is labelled so the agent can tell that a
      // write there would be refused before attempting one.
      expect(byId.get(projectA)).toBe("owner");
      expect(byId.get(projectB)).toBe("viewer");
    });

    it("allows an ordinary write in a project the key's creator owns", async () => {
      const { isError, parsed } = await callTool(agentOfOwnerA, "create-metric", {
        project_id: projectA,
        name: "Allowed Metric",
        slug: "allowed-metric",
      });

      expect(isError).toBe(false);
      expect(parsed.slug).toBe("allowed-metric");

      const rows = await client`
        SELECT id FROM metric_definitions WHERE project_id = ${projectA} AND slug = 'allowed-metric'
      `;
      expect(rows).toHaveLength(1);
    });

    it("denies the same write in a project the key's creator does not own, and writes nothing", async () => {
      const { isError, parsed } = await callTool(agentOfOwnerA, "create-metric", {
        project_id: projectB,
        name: "Denied Metric",
        slug: "denied-metric",
      });

      expect(isError).toBe(true);
      expect(parsed.status).toBe(403);
      expect(parsed.error).toMatch(/ownership/i);
      // The refusal explains the remedy — add the creator to the owner list —
      // rather than sending the agent off to mint a new key.
      expect(parsed.hint).toMatch(/owner list/i);

      const rows = await client`
        SELECT id FROM metric_definitions WHERE project_id = ${projectB}
      `;
      expect(rows).toHaveLength(0);
    });

    it("lets the same key write as soon as its creator is added as an owner, with no new key", async () => {
      const denied = await callTool(agentOfOwnerA, "create-metric", {
        project_id: projectB,
        name: "Later Metric",
        slug: "later-metric",
      });
      expect(denied.isError).toBe(true);

      await addProjectOwner(projectB, ownerA.userId);

      const allowed = await callTool(agentOfOwnerA, "create-metric", {
        project_id: projectB,
        name: "Later Metric",
        slug: "later-metric",
      });
      expect(allowed.isError).toBe(false);
      expect(allowed.parsed.slug).toBe("later-metric");
    });

    it("separates a missing permission from missing ownership", async () => {
      const keyWithoutMetrics = await insertAgentKey(ownerA.userId, ["projects:read"]);

      const { isError, parsed } = await callTool(keyWithoutMetrics, "create-metric", {
        project_id: projectA,
        name: "No Permission",
        slug: "no-permission",
      });

      expect(isError).toBe(true);
      expect(parsed.status).toBe(403);
      expect(parsed.error).toMatch(/permission/i);
      expect(parsed.hint).toMatch(/permission/i);
    });
  });

  describe("project creation through MCP", () => {
    it("makes the key's creator the first owner, not the key", async () => {
      const created = await callTool(agentOfOwnerA, "create-project", {
        team_id: teamId,
        name: "Agent Created",
        slug: `agent-created-${unique()}`,
      });
      expect(created.isError).toBe(false);

      const newProjectId = created.parsed.id as string;
      const owners = await client`
        SELECT user_id FROM project_owners WHERE project_id = ${newProjectId}
      `;
      expect(owners.map((o) => o.user_id)).toEqual([ownerA.userId]);

      // Ownership is the creator's, so the same key can immediately write to
      // what it just created.
      const updated = await callTool(agentOfOwnerA, "update-project", {
        project_id: newProjectId,
        name: "Agent Renamed",
      });
      expect(updated.isError).toBe(false);
      expect(updated.parsed.name).toBe("Agent Renamed");

      // ...and ownerB, who owns a different project, still cannot.
      const agentOfOwnerB = await insertAgentKey(ownerB.userId, AGENT_PERMISSIONS);
      const refused = await callTool(agentOfOwnerB, "update-project", {
        project_id: newProjectId,
        name: "Hijacked",
      });
      expect(refused.isError).toBe(true);
      expect(refused.parsed.error).toMatch(/ownership/i);
    });
  });

  describe("the comment exception", () => {
    it("comments on a project the key's creator does not own, authored by that exact key", async () => {
      const issueInB = await insertIssue(projectB, appInB);

      const { isError, parsed } = await callTool(agentOfOwnerA, "add-issue-comment", {
        project_id: projectB,
        issue_id: issueInB,
        body: "Investigated from a project I do not own.",
      });

      expect(isError).toBe(false);

      const [row] = await client`
        SELECT author_type, author_id FROM issue_comments WHERE id = ${parsed.id as string}
      `;
      // Authorship is the key, never its creator: another key of ownerA's must
      // not be able to edit or delete this comment later.
      expect(row.author_type).toBe("agent");
      const [keyRow] = await client`SELECT id FROM api_keys WHERE secret = ${agentOfOwnerA}`;
      expect(row.author_id).toBe(keyRow.id);

      // The exception replaces only the ownership predicate — an ordinary
      // write in the same project is still refused.
      const triage = await callTool(agentOfOwnerA, "claim-issue", {
        project_id: projectB,
        issue_id: issueInB,
      });
      expect(triage.isError).toBe(true);
      expect(triage.parsed.error).toMatch(/ownership/i);
    });
  });

  describe("human-only destructive operations", () => {
    it("refuses to delete an attachment even in a project the creator owns", async () => {
      const appInA = await insertApp(projectA, "MCP App A");
      const attachmentId = await insertAttachment(projectA, appInA);

      const { isError, parsed } = await callTool(agentOfOwnerA, "delete-attachment", {
        attachment_id: attachmentId,
      });

      expect(isError).toBe(true);
      expect(parsed.status).toBe(403);
      expect(parsed.error).toMatch(/user session/i);
      expect(parsed.hint).toMatch(/human-only/i);

      const [row] = await client`
        SELECT deleted_at FROM event_attachments WHERE id = ${attachmentId}
      `;
      expect(row.deleted_at).toBeNull();
    });

    it("refuses to delete a questionnaire even in a project the creator owns", async () => {
      const [questionnaire] = await client`
        INSERT INTO questionnaires (project_id, slug, name, schema)
        VALUES (
          ${projectA}, ${`mcp-acl-q-${unique()}`}, ${"MCP ACL Questionnaire"},
          ${client.json({
            version: 1,
            questions: [{ id: "q_text", type: "text", title: "Tell us", required: false }],
          })}
        )
        RETURNING id
      `;

      const { isError, parsed } = await callTool(agentOfOwnerA, "delete-questionnaire", {
        project_id: projectA,
        questionnaire_id: questionnaire.id as string,
      });

      expect(isError).toBe(true);
      // This route refuses agents before the shared check, with its own
      // wording; the hint still tells the agent it is a human-only operation.
      expect(parsed.error).toMatch(/only users/i);
      expect(parsed.hint).toMatch(/human-only/i);

      const [row] = await client`
        SELECT deleted_at FROM questionnaires WHERE id = ${questionnaire.id as string}
      `;
      expect(row.deleted_at).toBeNull();
    });
  });

  describe("discovery surfaces describe the enforced policy", () => {
    it("states the read/write split and the human-only limits in SERVER_INSTRUCTIONS", async () => {
      const res = await mcpRequest(agentOfOwnerA, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      });
      const instructions: string = res.json().result.instructions;

      expect(instructions).toContain("Access model");
      expect(instructions).toMatch(/intersection, never a union/i);
      expect(instructions).toMatch(/creator/i);
      expect(instructions).toMatch(/human-only/i);
      expect(instructions).toMatch(/no key recreation/i);
    });

    it("documents the access model in the guide and no longer mentions invitations", async () => {
      const res = await mcpRequest(agentOfOwnerA, "resources/read", {
        uri: "pubky-pulse://guide",
      });
      const guide: string = res.json().result.contents[0].text;

      expect(guide).toContain("## Access Model");
      expect(guide).toMatch(/creator currently owns the target project/i);
      expect(guide).toMatch(/create-project` makes your key's creator the project's first owner/i);
      expect(guide).toMatch(/human-only/i);
      // p10 removed team invitations entirely — access is granted by email
      // domain, so the guide must not send an agent looking for an invite flow.
      expect(guide).not.toMatch(/invitation/i);
      // Team roles are `owner | member`; `admin` was removed with them.
      expect(guide).not.toMatch(/admin role/i);
    });
  });
});
