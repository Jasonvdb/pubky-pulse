import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import postgres from "postgres";
import type { Permission } from "@pubky-pulse/shared";
import {
  buildApp,
  truncateAll,
  seedTestData,
  createUserAndGetToken,
  createForeignTeam,
  createProjectWithOwner,
  addProjectOwner,
  getTokenAndTeamId,
  TEST_CLIENT_KEY,
  TEST_DB_URL,
  TEST_IMPORT_KEY,
  TEST_USER,
} from "./setup.js";
import {
  enforceProjectWrite,
  evaluateProjectWrite,
  loadProjectAccess,
  resolveActorUserId,
  resolveAppInProject,
  resolveAttachmentAccess,
  resolveFeedbackCommentInProject,
  resolveFeedbackInProject,
  resolveIssueCommentInProject,
  resolveIssueInProject,
  resolveJobRunAccess,
  resolveQuestionnaireInProject,
  resolveQuestionnaireResponseCommentInProject,
  resolveQuestionnaireResponseInProject,
} from "../utils/project-access.js";
import { evaluateCommentPolicy } from "../utils/comment-policy.js";
import { resolveAccessibleProjectIdFromApp } from "../utils/project.js";
import type { ProjectWriteOptions } from "../utils/project-access.js";
import type { ApiKeyContext, AuthContext, UserContext } from "../types.js";

/**
 * Truth-table coverage for the central project-access layer (handoff §12), run
 * against the helper directly rather than through routes: no route consumes it
 * yet, and the policy is worth pinning down on its own terms before ~45 call
 * sites depend on it.
 *
 * Canonical actors, per the handoff:
 *   teamOwner — the configured singleton team owner; owns neither project;
 *   ownerA    — member, first owner of Project A;
 *   coOwnerA  — member, added as an equal owner of Project A;
 *   ownerB    — member, first owner of Project B, therefore a viewer of A.
 *
 * `pulse.pubky.org` and `example.com` are the suite's configured allowed
 * domains (vitest.config.ts); no deployment domain appears here.
 */

let app: FastifyInstance;
let client: postgres.Sql;

interface Actor {
  userId: string;
  email: string;
  token: string;
}

let teamId: string;
let teamOwner: Actor;
let ownerA: Actor;
let coOwnerA: Actor;
let ownerB: Actor;
let projectA: string;
let projectB: string;
let resourcesA: ProjectResources;
let resourcesB: ProjectResources;

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

  const { token: ownerToken } = await getTokenAndTeamId(app);
  teamOwner = { userId: seeded.userId as string, email: TEST_USER.email, token: ownerToken };

  ownerA = await signUp("owner-a@example.com");
  coOwnerA = await signUp("co-owner-a@example.com");
  ownerB = await signUp("owner-b@example.com");

  projectA = await createProjectWithOwner(teamId, ownerA.userId, { name: "Project A" });
  await addProjectOwner(projectA, coOwnerA.userId);
  projectB = await createProjectWithOwner(teamId, ownerB.userId, { name: "Project B" });

  resourcesA = await seedProjectResources(projectA, "a");
  resourcesB = await seedProjectResources(projectB, "b");
});

async function signUp(email: string): Promise<Actor> {
  const created = await createUserAndGetToken(app, email);
  return { userId: created.userId, email, token: created.token };
}

/**
 * Insert an agent key straight into the database. The key-creation route still
 * carries the old team-role gate, which a plain member does not clear; these
 * rows are about what the *middleware* does with an existing key, so they build
 * one directly rather than depending on a route this phase does not touch.
 */
async function insertAgentKey(createdBy: string, permissions: Permission[]): Promise<string> {
  const secret = `pulse_agent_${randomUUID().replace(/-/g, "")}`;
  await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${secret}, 'agent', ${null}, ${teamId}, 'ACL Test Agent Key', ${createdBy},
      ${JSON.stringify(permissions)}::jsonb
    )
  `;
  return secret;
}

/* ---------------------------------------------------------------- fixtures */

interface ProjectResources {
  appId: string;
  issueId: string;
  issueCommentId: string;
  feedbackId: string;
  feedbackCommentId: string;
  questionnaireId: string;
  responseId: string;
  responseCommentId: string;
  attachmentId: string;
  jobRunId: string;
}

/** One of every containment-chain leaf, so a chain can be probed from either project. */
async function seedProjectResources(projectId: string, tag: string): Promise<ProjectResources> {
  const [appRow] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
    VALUES (${teamId}, ${projectId}, ${`App ${tag}`}, 'apple', ${`org.pubky.pulse.test.${tag}`})
    RETURNING id
  `;
  const [issue] = await client`
    INSERT INTO issues (app_id, project_id, title, first_seen_at, last_seen_at)
    VALUES (${appRow.id}, ${projectId}, ${`Issue ${tag}`}, now(), now())
    RETURNING id
  `;
  const [issueComment] = await client`
    INSERT INTO issue_comments (issue_id, author_type, author_id, author_name, body)
    VALUES (${issue.id}, 'user', ${ownerA.userId}, 'Owner A', ${`Issue note ${tag}`})
    RETURNING id
  `;
  const [feedbackRow] = await client`
    INSERT INTO feedback (app_id, project_id, message)
    VALUES (${appRow.id}, ${projectId}, ${`Feedback ${tag}`})
    RETURNING id
  `;
  const [feedbackComment] = await client`
    INSERT INTO feedback_comments (feedback_id, author_type, author_id, author_name, body)
    VALUES (${feedbackRow.id}, 'user', ${ownerA.userId}, 'Owner A', ${`Feedback note ${tag}`})
    RETURNING id
  `;
  const [questionnaire] = await client`
    INSERT INTO questionnaires (project_id, app_id, slug, name, schema)
    VALUES (${projectId}, ${appRow.id}, ${`survey-${tag}`}, ${`Survey ${tag}`}, ${client.json({ questions: [] })})
    RETURNING id
  `;
  const [response] = await client`
    INSERT INTO questionnaire_responses (questionnaire_id, slug, app_id, project_id, answers)
    VALUES (${questionnaire.id}, ${`survey-${tag}`}, ${appRow.id}, ${projectId}, ${client.json({})})
    RETURNING id
  `;
  const [responseComment] = await client`
    INSERT INTO questionnaire_response_comments
      (questionnaire_response_id, author_type, author_id, author_name, body)
    VALUES (${response.id}, 'user', ${ownerA.userId}, 'Owner A', ${`Response note ${tag}`})
    RETURNING id
  `;
  const [attachment] = await client`
    INSERT INTO event_attachments
      (project_id, app_id, original_filename, content_type, size_bytes, sha256, storage_path)
    VALUES (
      ${projectId}, ${appRow.id}, ${`log-${tag}.txt`}, 'text/plain', 12,
      ${"a".repeat(64)}, ${`attachments/${tag}.txt`}
    )
    RETURNING id
  `;
  const [jobRun] = await client`
    INSERT INTO job_runs (job_type, status, team_id, project_id, triggered_by)
    VALUES ('stats_aggregate_daily', 'running', ${teamId}, ${projectId}, 'test')
    RETURNING id
  `;

  return {
    appId: appRow.id as string,
    issueId: issue.id as string,
    issueCommentId: issueComment.id as string,
    feedbackId: feedbackRow.id as string,
    feedbackCommentId: feedbackComment.id as string,
    questionnaireId: questionnaire.id as string,
    responseId: response.id as string,
    responseCommentId: responseComment.id as string,
    attachmentId: attachment.id as string,
    jobRunId: jobRun.id as string,
  };
}

/* ------------------------------------------------------- context + capture */

/**
 * Auth contexts as `middleware/auth.ts` builds them after revalidation. The
 * middleware's own job — proving the identity is still valid — is covered by
 * the domain-lockdown suite and, for the rows that turn on it, by the injected
 * requests further down.
 */
function userContext(actor: Actor, opts: { isTeamOwner?: boolean } = {}): UserContext {
  const isTeamOwner = opts.isTeamOwner ?? false;
  return {
    type: "user",
    user_id: actor.userId,
    email: actor.email,
    team_id: teamId,
    is_team_owner: isTeamOwner,
    team_memberships: [{ team_id: teamId, role: isTeamOwner ? "owner" : "member" }],
  };
}

function agentContext(
  createdBy: string,
  permissions: Permission[],
  keyId: string = randomUUID(),
): ApiKeyContext {
  return {
    type: "api_key",
    key_id: keyId,
    key_type: "agent",
    app_id: null,
    team_id: teamId,
    created_by: createdBy,
    permissions,
  };
}

function ingestionContext(keyType: "client" | "import", appId: string): ApiKeyContext {
  return {
    type: "api_key",
    key_id: randomUUID(),
    key_type: keyType,
    app_id: appId,
    team_id: teamId,
    created_by: ownerA.userId,
    permissions: ["events:write", "users:write"],
  };
}

interface Captured {
  code: number | null;
  body: { error?: string } | undefined;
}

/** A minimal reply that records what the helper sent instead of writing a response. */
function captureReply(): { reply: FastifyReply; captured: Captured } {
  const captured: Captured = { code: null, body: undefined };
  const reply = {
    code(status: number) {
      captured.code = status;
      return this;
    },
    send(body: { error?: string }) {
      captured.body = body;
      return this;
    },
  };
  return { reply: reply as unknown as FastifyReply, captured };
}

async function attemptWrite(
  projectId: string,
  auth: AuthContext,
  options: ProjectWriteOptions = {},
) {
  const { reply, captured } = captureReply();
  const access = await enforceProjectWrite(app, projectId, auth, reply, options);
  return { access, captured };
}

const ORDINARY_WRITE = { permission: "issues:write" as const };

/* ------------------------------------------------------------ 1..3 humans */

describe("project access — human principals", () => {
  it("row 1: a human project owner is allowed an ordinary write", async () => {
    const { access, captured } = await attemptWrite(projectA, userContext(ownerA));

    expect(captured.code).toBeNull();
    expect(access).not.toBeNull();
    expect(access?.project).toEqual({ id: projectA, team_id: teamId });
    expect(access?.actor_user_id).toBe(ownerA.userId);
    expect(access?.is_project_owner).toBe(true);
    expect(access?.is_team_owner).toBe(false);
  });

  it("row 1: an added co-owner is an equal owner", async () => {
    const { access, captured } = await attemptWrite(projectA, userContext(coOwnerA));

    expect(captured.code).toBeNull();
    expect(access?.is_project_owner).toBe(true);
  });

  it("row 2: a same-team viewer is denied with 403, not 404", async () => {
    const { access, captured } = await attemptWrite(projectA, userContext(ownerB));

    expect(access).toBeNull();
    expect(captured.code).toBe(403);
    expect(captured.body?.error).toBe("Requires project ownership");
  });

  it("row 2: the viewer can still see the project — reads are unaffected", async () => {
    const resolved = await loadProjectAccess(app, projectA, userContext(ownerB));

    expect(resolved?.id).toBe(projectA);
    expect(resolved?.is_project_owner).toBe(false);
  });

  it("row 3: the team owner is denied an ordinary write in a project they do not own", async () => {
    const { access, captured } = await attemptWrite(
      projectA,
      userContext(teamOwner, { isTeamOwner: true }),
    );

    expect(access).toBeNull();
    expect(captured.code).toBe(403);
    expect(captured.body?.error).toBe("Requires project ownership");
  });

  it("row 3: the team owner is allowed a recovery-only operation on that same project", async () => {
    const { access, captured } = await attemptWrite(
      projectA,
      userContext(teamOwner, { isTeamOwner: true }),
      { humanOnly: true, allowTeamOwnerRecovery: true },
    );

    expect(captured.code).toBeNull();
    expect(access?.is_project_owner).toBe(false);
    expect(access?.is_team_owner).toBe(true);
  });

  it("row 3: recovery authority does not reach a plain member", async () => {
    const { access, captured } = await attemptWrite(projectA, userContext(ownerB), {
      humanOnly: true,
      allowTeamOwnerRecovery: true,
    });

    expect(access).toBeNull();
    expect(captured.code).toBe(403);
  });

  it("a project outside the caller's team is 404, never 403", async () => {
    const foreign = await createForeignTeam();
    const { access, captured } = await attemptWrite(foreign.projectId, userContext(ownerA));

    expect(access).toBeNull();
    expect(captured.code).toBe(404);
    expect(captured.body?.error).toBe("Project not found");
  });

  it("a soft-deleted project is 404 even for its own owner", async () => {
    await client`UPDATE projects SET deleted_at = now() WHERE id = ${projectA}`;
    const { access, captured } = await attemptWrite(projectA, userContext(ownerA));

    expect(access).toBeNull();
    expect(captured.code).toBe(404);
  });
});

/* ------------------------------------------------------------- 4..7 keys */

describe("project access — key principals", () => {
  it("row 4: an agent whose creator owns the project and holds the permission is allowed", async () => {
    const auth = agentContext(ownerA.userId, ["issues:write"]);
    const { access, captured } = await attemptWrite(projectA, auth, ORDINARY_WRITE);

    expect(captured.code).toBeNull();
    expect(access?.actor_user_id).toBe(ownerA.userId);
    expect(access?.is_project_owner).toBe(true);
    // Recovery authority is never inherited, even from a team-owner creator.
    expect(access?.is_team_owner).toBe(false);
  });

  it("row 4: an agent created by the team owner still gets no recovery authority", async () => {
    const auth = agentContext(teamOwner.userId, ["issues:write"]);
    const { access, captured } = await attemptWrite(projectA, auth, {
      ...ORDINARY_WRITE,
      allowTeamOwnerRecovery: true,
    });

    expect(access).toBeNull();
    expect(captured.code).toBe(403);
    expect(captured.body?.error).toBe("Requires project ownership");
  });

  it("row 5: the same agent without the route's permission is denied", async () => {
    const auth = agentContext(ownerA.userId, ["issues:read"]);
    const { access, captured } = await attemptWrite(projectA, auth, ORDINARY_WRITE);

    expect(access).toBeNull();
    expect(captured.code).toBe(403);
    expect(captured.body?.error).toBe("Missing permission: issues:write");
  });

  it("row 6: an agent with the permission but a non-owner creator is denied", async () => {
    const auth = agentContext(ownerB.userId, ["issues:write"]);
    const { access, captured } = await attemptWrite(projectA, auth, ORDINARY_WRITE);

    expect(access).toBeNull();
    expect(captured.code).toBe(403);
    expect(captured.body?.error).toBe("Requires project ownership");
  });

  it("row 6: ownership is the intersection, not a union — the same key still writes its own project", async () => {
    const auth = agentContext(ownerB.userId, ["issues:write"]);
    const { access, captured } = await attemptWrite(projectB, auth, ORDINARY_WRITE);

    expect(captured.code).toBeNull();
    expect(access?.is_project_owner).toBe(true);
  });

  it("row 7: client and import keys have no project-management actor at all", () => {
    for (const keyType of ["client", "import"] as const) {
      const auth = ingestionContext(keyType, resourcesA.appId);
      expect(resolveActorUserId(auth)).toBeNull();
    }
  });

  it("row 7: client and import keys are denied management access with 403", async () => {
    for (const keyType of ["client", "import"] as const) {
      const auth = ingestionContext(keyType, resourcesA.appId);
      const { access, captured } = await attemptWrite(projectA, auth, ORDINARY_WRITE);

      expect(access).toBeNull();
      expect(captured.code).toBe(403);
      expect(captured.body?.error).toBe("This operation requires a user session or an agent key");
    }
  });

  it("row 7: an ingestion key cannot borrow ownership from the human who created it", async () => {
    // The key's creator owns Project A; the key still must not.
    const auth = ingestionContext("client", resourcesA.appId);
    const resolved = await loadProjectAccess(app, projectA, auth);

    expect(resolved?.is_project_owner).toBe(false);
    expect(resolved?.actor_user_id).toBeNull();
  });
});

/* ------------------------------- 8..9 identity revalidation (middleware) */

/**
 * Rows 8 and 9 are decided before the access layer runs: a revoked creator or a
 * removed membership must fail authentication outright, so these go through
 * real requests rather than a hand-built context.
 */
describe("project access — invalid identity is 401, not 403", () => {
  async function listProjects(credential: string) {
    return app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${credential}` },
    });
  }

  it("row 8: an agent key whose creator moved to a disallowed domain is unauthorized", async () => {
    const key = await insertAgentKey(ownerA.userId, ["projects:read"]);
    expect((await listProjects(key)).statusCode).toBe(200);

    await client`UPDATE users SET email = 'owner-a@blocked.test' WHERE id = ${ownerA.userId}`;

    expect((await listProjects(key)).statusCode).toBe(401);
  });

  it("row 8: an agent key whose creator is not a member of the singleton team is unauthorized", async () => {
    const foreign = await createForeignTeam();

    expect((await listProjects(foreign.apiKeySecret)).statusCode).toBe(401);
  });

  it("row 9: removing a membership unauthorizes that user's JWT and their agent key alike", async () => {
    const key = await insertAgentKey(ownerA.userId, ["projects:read"]);
    expect((await listProjects(ownerA.token)).statusCode).toBe(200);
    expect((await listProjects(key)).statusCode).toBe(200);

    await client`DELETE FROM team_members WHERE team_id = ${teamId} AND user_id = ${ownerA.userId}`;

    expect((await listProjects(ownerA.token)).statusCode).toBe(401);
    expect((await listProjects(key)).statusCode).toBe(401);
  });

  it("removing project ownership leaves reads working but denies the next write", async () => {
    const auth = agentContext(ownerA.userId, ["issues:write"]);
    expect((await attemptWrite(projectA, auth, ORDINARY_WRITE)).access).not.toBeNull();

    await client`DELETE FROM project_owners WHERE project_id = ${projectA} AND user_id = ${ownerA.userId}`;

    const after = await attemptWrite(projectA, auth, ORDINARY_WRITE);
    expect(after.access).toBeNull();
    expect(after.captured.code).toBe(403);
    expect((await loadProjectAccess(app, projectA, userContext(ownerA)))?.id).toBe(projectA);
  });
});

/* ------------------------------------------------------------ 10 comments */

describe("comment policy", () => {
  const humanComment = (userId: string) => ({ author_type: "user", author_id: userId });
  const agentComment = (keyId: string) => ({ author_type: "agent", author_id: keyId });

  async function accessFor(auth: AuthContext, projectId = projectA) {
    const resolved = await loadProjectAccess(app, projectId, auth);
    if (!resolved) throw new Error("project should be visible");
    return resolved;
  }

  it("row 10: a read-only member may create a comment in a project they do not own", async () => {
    const auth = userContext(ownerB);
    expect(evaluateCommentPolicy(auth, await accessFor(auth), { action: "create" })).toBeNull();
  });

  it("row 10: a read-only member may edit and delete their own comment", async () => {
    const auth = userContext(ownerB);
    const access = await accessFor(auth);
    const own = humanComment(ownerB.userId);

    expect(evaluateCommentPolicy(auth, access, { action: "edit", comment: own })).toBeNull();
    expect(evaluateCommentPolicy(auth, access, { action: "delete", comment: own })).toBeNull();
  });

  it("row 10: a read-only member may not touch another author's comment", async () => {
    const auth = userContext(ownerB);
    const access = await accessFor(auth);
    const other = humanComment(ownerA.userId);

    expect(evaluateCommentPolicy(auth, access, { action: "edit", comment: other })?.status).toBe(403);
    expect(evaluateCommentPolicy(auth, access, { action: "delete", comment: other })?.status).toBe(403);
  });

  it("row 10: a human project owner may delete another author's comment but never edit it", async () => {
    const auth = userContext(ownerA);
    const access = await accessFor(auth);
    const other = humanComment(ownerB.userId);

    expect(evaluateCommentPolicy(auth, access, { action: "delete", comment: other })).toBeNull();
    expect(evaluateCommentPolicy(auth, access, { action: "edit", comment: other })?.error).toBe(
      "Only the original author can edit this comment",
    );
  });

  it("row 10: the team owner does not get moderation in a project they do not own", async () => {
    const auth = userContext(teamOwner, { isTeamOwner: true });
    const access = await accessFor(auth);

    expect(
      evaluateCommentPolicy(auth, access, { action: "delete", comment: humanComment(ownerA.userId) })
        ?.status,
    ).toBe(403);
  });

  it("row 10: an agent may edit and delete only comments authored by that exact key", async () => {
    const auth = agentContext(ownerA.userId, ["issues:write"]);
    const access = await accessFor(auth);
    const otherKeyId = randomUUID();

    expect(evaluateCommentPolicy(auth, access, { action: "create" })).toBeNull();
    expect(
      evaluateCommentPolicy(auth, access, { action: "edit", comment: agentComment(auth.key_id) }),
    ).toBeNull();
    expect(
      evaluateCommentPolicy(auth, access, { action: "delete", comment: agentComment(auth.key_id) }),
    ).toBeNull();
    expect(
      evaluateCommentPolicy(auth, access, { action: "delete", comment: agentComment(otherKeyId) })
        ?.status,
    ).toBe(403);
  });

  it("row 10: an agent never moderates, even when its creator owns the project", async () => {
    const auth = agentContext(ownerA.userId, ["issues:write"]);
    const access = await accessFor(auth);
    expect(access.is_project_owner).toBe(true);

    // Its creator's own human comment is still not the agent's to delete.
    expect(
      evaluateCommentPolicy(auth, access, { action: "delete", comment: humanComment(ownerA.userId) })
        ?.status,
    ).toBe(403);
  });

  it("row 10: an author id shared across principal types is not authorship", async () => {
    const auth = agentContext(ownerA.userId, ["issues:write"], ownerA.userId);
    const access = await accessFor(auth);

    expect(
      evaluateCommentPolicy(auth, access, { action: "edit", comment: humanComment(ownerA.userId) })
        ?.status,
    ).toBe(403);
  });

  it("row 10: client and import keys hold no comment identity", async () => {
    for (const keyType of ["client", "import"] as const) {
      const auth = ingestionContext(keyType, resourcesA.appId);
      const access = await accessFor(auth);
      expect(evaluateCommentPolicy(auth, access, { action: "create" })?.status).toBe(403);
    }
  });
});

/* ------------------------------------------------- 11 human-only operations */

describe("human-only operations", () => {
  it("row 11: a human-only destructive operation rejects an otherwise authorized agent", async () => {
    const auth = agentContext(ownerA.userId, ["projects:write"]);
    const allowed = await attemptWrite(projectA, auth, { permission: "projects:write" });
    expect(allowed.access).not.toBeNull();

    const { access, captured } = await attemptWrite(projectA, auth, {
      permission: "projects:write",
      humanOnly: true,
    });

    expect(access).toBeNull();
    expect(captured.code).toBe(403);
    expect(captured.body?.error).toBe("This operation requires a user session");
  });

  it("row 11: the project's human owner performs the same operation", async () => {
    const { access, captured } = await attemptWrite(projectA, userContext(ownerA), {
      humanOnly: true,
    });

    expect(captured.code).toBeNull();
    expect(access?.is_project_owner).toBe(true);
  });

  it("evaluateProjectWrite is decidable without a database round-trip", () => {
    const facts = { actor_user_id: ownerA.userId, is_project_owner: true, is_team_owner: false };
    const agent = agentContext(ownerA.userId, ["projects:write"]);

    expect(evaluateProjectWrite(agent, facts, { permission: "projects:write" })).toBeNull();
    expect(evaluateProjectWrite(agent, facts, { humanOnly: true })?.status).toBe(403);
  });
});

/* ------------------------------------------------------------- containment */

describe("containment resolvers", () => {
  /**
   * Each chain is probed twice: with its own project (resolves, and carries
   * that project's ownership), and with the *other* project's id in the URL
   * (404, and no ownership fact leaks). This is the confused-deputy case — a
   * caller authorized against Project A substituting a Project B child id.
   */
  async function probe<T>(
    run: (reply: FastifyReply) => Promise<T | null>,
  ): Promise<{ result: T | null; captured: Captured }> {
    const { reply, captured } = captureReply();
    return { result: await run(reply), captured };
  }

  const chains: Array<{
    name: string;
    notFound: string;
    resolve: (projectId: string, res: ProjectResources, auth: AuthContext, reply: FastifyReply) => Promise<unknown>;
  }> = [
    {
      name: "app -> project",
      notFound: "App not found",
      resolve: (projectId, res, auth, reply) =>
        resolveAppInProject(app, { projectId, appId: res.appId }, auth, reply),
    },
    {
      name: "issue -> project",
      notFound: "Issue not found",
      resolve: (projectId, res, auth, reply) =>
        resolveIssueInProject(app, { projectId, issueId: res.issueId }, auth, reply),
    },
    {
      name: "issue comment -> issue -> project",
      notFound: "Comment not found",
      resolve: (projectId, res, auth, reply) =>
        resolveIssueCommentInProject(
          app,
          { projectId, issueId: res.issueId, commentId: res.issueCommentId },
          auth,
          reply,
        ),
    },
    {
      name: "feedback -> project",
      notFound: "Feedback not found",
      resolve: (projectId, res, auth, reply) =>
        resolveFeedbackInProject(app, { projectId, feedbackId: res.feedbackId }, auth, reply),
    },
    {
      name: "feedback comment -> feedback -> project",
      notFound: "Comment not found",
      resolve: (projectId, res, auth, reply) =>
        resolveFeedbackCommentInProject(
          app,
          { projectId, feedbackId: res.feedbackId, commentId: res.feedbackCommentId },
          auth,
          reply,
        ),
    },
    {
      name: "questionnaire -> project",
      notFound: "Questionnaire not found",
      resolve: (projectId, res, auth, reply) =>
        resolveQuestionnaireInProject(
          app,
          { projectId, questionnaireId: res.questionnaireId },
          auth,
          reply,
        ),
    },
    {
      name: "response -> questionnaire -> project",
      notFound: "Response not found",
      resolve: (projectId, res, auth, reply) =>
        resolveQuestionnaireResponseInProject(
          app,
          { projectId, questionnaireId: res.questionnaireId, responseId: res.responseId },
          auth,
          reply,
        ),
    },
    {
      name: "response comment -> response -> questionnaire -> project",
      notFound: "Comment not found",
      resolve: (projectId, res, auth, reply) =>
        resolveQuestionnaireResponseCommentInProject(
          app,
          {
            projectId,
            questionnaireId: res.questionnaireId,
            responseId: res.responseId,
            commentId: res.responseCommentId,
          },
          auth,
          reply,
        ),
    },
    {
      name: "attachment -> app -> project",
      notFound: "Attachment not found",
      resolve: (projectId, res, auth, reply) =>
        resolveAttachmentAccess(app, { projectId, attachmentId: res.attachmentId }, auth, reply),
    },
    {
      name: "job run -> project/team",
      notFound: "Job run not found",
      resolve: (projectId, res, auth, reply) =>
        resolveJobRunAccess(app, { projectId, runId: res.jobRunId }, auth, reply),
    },
  ];

  for (const chain of chains) {
    it(`${chain.name}: resolves inside its own project with that project's ownership`, async () => {
      const auth = userContext(ownerA);
      const { result, captured } = await probe((reply) =>
        chain.resolve(projectA, resourcesA, auth, reply),
      );

      expect(captured.code).toBeNull();
      expect(result).not.toBeNull();
      const access = result as { project: { id: string } | null; is_project_owner: boolean };
      expect(access.project?.id).toBe(projectA);
      expect(access.is_project_owner).toBe(true);
    });

    it(`${chain.name}: a Project B child under a Project A URL is 404`, async () => {
      const auth = userContext(ownerA);
      const { result, captured } = await probe((reply) =>
        chain.resolve(projectA, resourcesB, auth, reply),
      );

      expect(result).toBeNull();
      expect(captured.code).toBe(404);
      expect(captured.body?.error).toBe(chain.notFound);
    });

    it(`${chain.name}: reports the containing project's ownership, not the URL's`, async () => {
      // ownerB owns Project B only. Resolving a Project B child returns
      // ownership; the same call against Project A's children does not.
      const auth = userContext(ownerB);
      const { result: owned } = await probe((reply) =>
        chain.resolve(projectB, resourcesB, auth, reply),
      );
      const { result: unowned } = await probe((reply) =>
        chain.resolve(projectA, resourcesA, auth, reply),
      );

      expect((owned as { is_project_owner: boolean }).is_project_owner).toBe(true);
      expect((unowned as { is_project_owner: boolean }).is_project_owner).toBe(false);
    });
  }

  it("a child in another team is 404, indistinguishable from a missing one", async () => {
    const foreign = await createForeignTeam();
    const auth = userContext(ownerA);
    const { result, captured } = await probe((reply) =>
      resolveFeedbackInProject(
        app,
        { projectId: foreign.projectId, feedbackId: foreign.feedbackId },
        auth,
        reply,
      ),
    );

    expect(result).toBeNull();
    expect(captured.code).toBe(404);
    expect(captured.body?.error).toBe("Feedback not found");
  });

  it("a soft-deleted comment no longer resolves", async () => {
    await client`UPDATE issue_comments SET deleted_at = now() WHERE id = ${resourcesA.issueCommentId}`;
    const auth = userContext(ownerA);
    const { result, captured } = await probe((reply) =>
      resolveIssueCommentInProject(
        app,
        { projectId: projectA, issueId: resourcesA.issueId, commentId: resourcesA.issueCommentId },
        auth,
        reply,
      ),
    );

    expect(result).toBeNull();
    expect(captured.code).toBe(404);
  });

  it("a comment addressed under the wrong parent in the same project is 404", async () => {
    const auth = userContext(ownerA);
    const [otherIssue] = await client`
      INSERT INTO issues (app_id, project_id, title, first_seen_at, last_seen_at)
      VALUES (${resourcesA.appId}, ${projectA}, 'Other issue', now(), now())
      RETURNING id
    `;
    const { result, captured } = await probe((reply) =>
      resolveIssueCommentInProject(
        app,
        { projectId: projectA, issueId: otherIssue.id as string, commentId: resourcesA.issueCommentId },
        auth,
        reply,
      ),
    );

    expect(result).toBeNull();
    expect(captured.code).toBe(404);
  });
});

/* --------------------------------------------- predicated app -> project id */

describe("resolveAccessibleProjectIdFromApp", () => {
  it("resolves an app inside a team the caller can reach", async () => {
    const resolved = await resolveAccessibleProjectIdFromApp(app, resourcesA.appId, userContext(ownerA));
    expect(resolved).toBe(projectA);
  });

  it("refuses to resolve an app belonging to another team", async () => {
    const foreign = await createForeignTeam();
    const resolved = await resolveAccessibleProjectIdFromApp(app, foreign.appId, userContext(ownerA));
    expect(resolved).toBeNull();
  });

  it("refuses a soft-deleted app", async () => {
    await client`UPDATE apps SET deleted_at = now() WHERE id = ${resourcesA.appId}`;
    const resolved = await resolveAccessibleProjectIdFromApp(app, resourcesA.appId, userContext(ownerA));
    expect(resolved).toBeNull();
  });
});

/* ---------------------------------------------------------- key hygiene */

describe("configured ingestion keys carry no management actor", () => {
  it("neither the seeded client key nor the import key can manage a project", async () => {
    for (const secret of [TEST_CLIENT_KEY, TEST_IMPORT_KEY]) {
      const res = await app.inject({
        method: "GET",
        url: "/v1/projects",
        headers: { authorization: `Bearer ${secret}` },
      });
      expect(res.statusCode).toBe(403);
    }
  });
});
