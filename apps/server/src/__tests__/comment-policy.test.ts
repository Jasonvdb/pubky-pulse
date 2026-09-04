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
  getTokenAndTeamId,
  TEST_DB_URL,
} from "./setup.js";

/**
 * The comment policy, proved through the routes (handoff §12 "Comment and
 * containment tests").
 *
 * `project-access.test.ts` already exercises `evaluateCommentPolicy` directly.
 * This suite proves each of the three comment implementations — issues,
 * feedback, questionnaire responses — is actually *wired* to that one policy,
 * by driving the same table of cases through all three from the outside. Before
 * this phase each route carried its own inline `auth.type === "user" ?
 * user_id : key_id` comparison and its own moderation rule; the point of the
 * table is that the three now behave identically.
 *
 * The rules under test (handoff §2 "Reads, writes, and comments"):
 *
 *   - a read-only team member may create a comment, and may edit or delete
 *     only comments they authored;
 *   - a human project owner may DELETE any comment in the project for
 *     moderation, but may never EDIT another person's comment;
 *   - an agent may create comments and edit/delete comments authored by that
 *     EXACT key — not by a sibling key with the same creator, and not by the
 *     human who created it, even when that human owns the project.
 *
 * Comments are inserted straight into the database with an explicit author, so
 * the case under test is the only route call in the attempt: a fixture built
 * through its own author's request would hide a missing check behind a passing
 * one.
 *
 * `pulse.pubky.org` and `example.com` are the suite's configured allowed
 * domains (vitest.config.ts); no deployment domain appears here.
 */

let app: FastifyInstance;
let client: postgres.Sql;

interface Actor {
  userId: string;
  token: string;
}

interface AgentKey {
  id: string;
  secret: string;
}

/** Every write permission the three comment routes ask for. */
const COMMENT_PERMISSIONS: Permission[] = [
  "issues:read",
  "issues:write",
  "feedback:read",
  "feedback:write",
  "questionnaires:read",
  "questionnaires:write",
];

let teamId: string;
/** Owner of Project A — the human moderator in every row below. */
let ownerA: Actor;
/** A member of the same team who owns no project: the read-only commenter. */
let viewer: Actor;
let projectA: string;
let appA: string;

/** Two distinct agent keys created by the *same* human, ownerA. */
let agentA: AgentKey;
let agentASibling: AgentKey;
/** An agent key created by the viewer, who owns nothing. */
let agentOfViewer: AgentKey;

/** Fixtures the three comment surfaces hang off, all inside Project A. */
let issueId: string;
let feedbackId: string;
let questionnaireId: string;
let responseId: string;

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
  await getTokenAndTeamId(app);

  ownerA = await signUp("owner-a@example.com");
  viewer = await signUp("viewer@example.com");

  projectA = await createProjectWithOwner(teamId, ownerA.userId, { name: "Project A" });
  appA = await insertApp(projectA);

  agentA = await insertAgentKey(ownerA.userId);
  agentASibling = await insertAgentKey(ownerA.userId);
  agentOfViewer = await insertAgentKey(viewer.userId);

  issueId = await insertIssue(projectA, appA);
  feedbackId = await insertFeedback(projectA, appA);
  questionnaireId = await insertQuestionnaire(projectA);
  responseId = await insertResponse(projectA, appA, questionnaireId);
});

async function signUp(email: string): Promise<Actor> {
  const created = await createUserAndGetToken(app, email);
  return { userId: created.userId, token: created.token };
}

function unique(): string {
  return randomUUID().slice(0, 8);
}

/**
 * Insert an agent key directly, as the other ACL suites do: `POST
 * /v1/auth/keys` still carries the old team-role gate, and these keys belong to
 * plain members.
 */
async function insertAgentKey(createdBy: string): Promise<AgentKey> {
  const secret = `pulse_agent_${randomUUID().replace(/-/g, "")}`;
  const [row] = await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${secret}, 'agent', ${null}, ${teamId}, 'Comment Policy Agent', ${createdBy},
      ${JSON.stringify(COMMENT_PERMISSIONS)}::jsonb
    )
    RETURNING id
  `;
  return { id: row.id as string, secret };
}

async function insertApp(projectId: string): Promise<string> {
  const [row] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
    VALUES (${teamId}, ${projectId}, ${"Comment Policy App"}, 'apple', ${`dev.comments.${unique()}`})
    RETURNING id
  `;
  return row.id as string;
}

async function insertIssue(projectId: string, appId: string): Promise<string> {
  const [row] = await client`
    INSERT INTO issues (app_id, project_id, status, title, first_seen_at, last_seen_at)
    VALUES (${appId}, ${projectId}, 'new', ${"Comment policy issue"}, now(), now())
    RETURNING id
  `;
  return row.id as string;
}

async function insertFeedback(projectId: string, appId: string): Promise<string> {
  const [row] = await client`
    INSERT INTO feedback (app_id, project_id, message)
    VALUES (${appId}, ${projectId}, ${"Comment policy feedback"})
    RETURNING id
  `;
  return row.id as string;
}

async function insertQuestionnaire(projectId: string): Promise<string> {
  const [row] = await client`
    INSERT INTO questionnaires (project_id, slug, name, schema)
    VALUES (
      ${projectId}, ${`cp-${unique()}`}, ${"Comment policy questionnaire"},
      ${client.json({ questions: [] })}
    )
    RETURNING id
  `;
  return row.id as string;
}

async function insertResponse(
  projectId: string,
  appId: string,
  parentId: string,
): Promise<string> {
  const [parent] = await client`SELECT slug FROM questionnaires WHERE id = ${parentId}`;
  const [row] = await client`
    INSERT INTO questionnaire_responses (questionnaire_id, slug, app_id, project_id, answers)
    VALUES (${parentId}, ${parent.slug}, ${appId}, ${projectId}, ${client.json({})})
    RETURNING id
  `;
  return row.id as string;
}

/* ---------------------------------------------------------------------------
 * The three comment surfaces
 * ------------------------------------------------------------------------ */

interface StoredComment {
  body: string;
  deleted_at: Date | null;
}

interface Surface {
  /** How the route table names this comment implementation. */
  name: string;
  /** The collection URL, for create. */
  collectionUrl: () => string;
  /** The single-comment URL, for edit and delete. */
  commentUrl: (commentId: string) => string;
  /** Insert a comment attributed to an exact author, bypassing the route. */
  insertComment: (
    authorType: "user" | "agent",
    authorId: string,
    body: string,
  ) => Promise<string>;
  /** Read the stored row back, to prove a refusal changed nothing. */
  readComment: (commentId: string) => Promise<StoredComment>;
}

const surfaces: Surface[] = [
  {
    name: "issue comments",
    collectionUrl: () => `/v1/projects/${projectA}/issues/${issueId}/comments`,
    commentUrl: (commentId) =>
      `/v1/projects/${projectA}/issues/${issueId}/comments/${commentId}`,
    insertComment: async (authorType, authorId, body) => {
      const [row] = await client`
        INSERT INTO issue_comments (issue_id, author_type, author_id, author_name, body)
        VALUES (${issueId}, ${authorType}, ${authorId}, ${"Fixture Author"}, ${body})
        RETURNING id
      `;
      return row.id as string;
    },
    readComment: async (commentId) => {
      const [row] = await client`
        SELECT body, deleted_at FROM issue_comments WHERE id = ${commentId}
      `;
      return row as unknown as StoredComment;
    },
  },
  {
    name: "feedback comments",
    collectionUrl: () => `/v1/projects/${projectA}/feedback/${feedbackId}/comments`,
    commentUrl: (commentId) =>
      `/v1/projects/${projectA}/feedback/${feedbackId}/comments/${commentId}`,
    insertComment: async (authorType, authorId, body) => {
      const [row] = await client`
        INSERT INTO feedback_comments (feedback_id, author_type, author_id, author_name, body)
        VALUES (${feedbackId}, ${authorType}, ${authorId}, ${"Fixture Author"}, ${body})
        RETURNING id
      `;
      return row.id as string;
    },
    readComment: async (commentId) => {
      const [row] = await client`
        SELECT body, deleted_at FROM feedback_comments WHERE id = ${commentId}
      `;
      return row as unknown as StoredComment;
    },
  },
  {
    name: "questionnaire response comments",
    collectionUrl: () =>
      `/v1/projects/${projectA}/questionnaires/${questionnaireId}/responses/${responseId}/comments`,
    commentUrl: (commentId) =>
      `/v1/projects/${projectA}/questionnaires/${questionnaireId}/responses/${responseId}/comments/${commentId}`,
    insertComment: async (authorType, authorId, body) => {
      const [row] = await client`
        INSERT INTO questionnaire_response_comments (
          questionnaire_response_id, author_type, author_id, author_name, body
        )
        VALUES (${responseId}, ${authorType}, ${authorId}, ${"Fixture Author"}, ${body})
        RETURNING id
      `;
      return row.id as string;
    },
    readComment: async (commentId) => {
      const [row] = await client`
        SELECT body, deleted_at FROM questionnaire_response_comments WHERE id = ${commentId}
      `;
      return row as unknown as StoredComment;
    },
  },
];

/* ---------------------------------------------------------------------------
 * Request helpers
 * ------------------------------------------------------------------------ */

function create(surface: Surface, credential: string, body: string) {
  return app.inject({
    method: "POST",
    url: surface.collectionUrl(),
    headers: { authorization: `Bearer ${credential}` },
    payload: { body },
  });
}

function edit(surface: Surface, credential: string, commentId: string, body: string) {
  return app.inject({
    method: "PATCH",
    url: surface.commentUrl(commentId),
    headers: { authorization: `Bearer ${credential}` },
    payload: { body },
  });
}

function remove(surface: Surface, credential: string, commentId: string) {
  return app.inject({
    method: "DELETE",
    url: surface.commentUrl(commentId),
    headers: { authorization: `Bearer ${credential}` },
  });
}

describe.each(surfaces)("$name", (surface) => {
  it("a read-only member may create a comment", async () => {
    const res = await create(surface, viewer.token, "A viewer's note");

    expect(res.statusCode).toBe(201);
    expect(res.json().author_type).toBe("user");
    expect(res.json().author_id).toBe(viewer.userId);
  });

  it("a read-only member may edit and delete their own comment", async () => {
    const commentId = await surface.insertComment("user", viewer.userId, "mine");

    const edited = await edit(surface, viewer.token, commentId, "mine, revised");
    expect(edited.statusCode).toBe(200);
    expect((await surface.readComment(commentId)).body).toBe("mine, revised");

    const deleted = await remove(surface, viewer.token, commentId);
    expect(deleted.statusCode).toBe(200);
    expect((await surface.readComment(commentId)).deleted_at).not.toBeNull();
  });

  it("a read-only member cannot edit another user's comment", async () => {
    const commentId = await surface.insertComment("user", ownerA.userId, "the owner's words");

    const res = await edit(surface, viewer.token, commentId, "rewritten");

    expect(res.statusCode).toBe(403);
    expect((await surface.readComment(commentId)).body).toBe("the owner's words");
  });

  it("a read-only member cannot delete another user's comment", async () => {
    const commentId = await surface.insertComment("user", ownerA.userId, "the owner's words");

    const res = await remove(surface, viewer.token, commentId);

    expect(res.statusCode).toBe(403);
    expect((await surface.readComment(commentId)).deleted_at).toBeNull();
  });

  it("a human project owner may delete another author's comment for moderation", async () => {
    const commentId = await surface.insertComment("user", viewer.userId, "off topic");

    const res = await remove(surface, ownerA.token, commentId);

    expect(res.statusCode).toBe(200);
    expect((await surface.readComment(commentId)).deleted_at).not.toBeNull();
  });

  it("a human project owner may NOT edit another author's comment", async () => {
    const commentId = await surface.insertComment("user", viewer.userId, "someone else's words");

    const res = await edit(surface, ownerA.token, commentId, "put words in their mouth");

    expect(res.statusCode).toBe(403);
    expect((await surface.readComment(commentId)).body).toBe("someone else's words");
  });

  it("an agent may edit and delete a comment authored by that exact key", async () => {
    const commentId = await surface.insertComment("agent", agentA.id, "agent note");

    const edited = await edit(surface, agentA.secret, commentId, "agent note, revised");
    expect(edited.statusCode).toBe(200);
    expect((await surface.readComment(commentId)).body).toBe("agent note, revised");

    const deleted = await remove(surface, agentA.secret, commentId);
    expect(deleted.statusCode).toBe(200);
    expect((await surface.readComment(commentId)).deleted_at).not.toBeNull();
  });

  it("an agent cannot touch a sibling key's comment, even with the same creator", async () => {
    const commentId = await surface.insertComment("agent", agentASibling.id, "sibling note");

    const edited = await edit(surface, agentA.secret, commentId, "rewritten");
    expect(edited.statusCode).toBe(403);

    const deleted = await remove(surface, agentA.secret, commentId);
    expect(deleted.statusCode).toBe(403);

    const stored = await surface.readComment(commentId);
    expect(stored.body).toBe("sibling note");
    expect(stored.deleted_at).toBeNull();
  });

  it("an agent cannot use its creator's identity to delete the creator's own comment", async () => {
    // ownerA created this key and owns the project, so the *creator* could
    // moderate this comment. The key may not: moderation is a human judgement,
    // and an agent's authorship is the key, never the human behind it.
    const commentId = await surface.insertComment("user", ownerA.userId, "the creator's words");

    const deleted = await remove(surface, agentA.secret, commentId);
    expect(deleted.statusCode).toBe(403);

    const edited = await edit(surface, agentA.secret, commentId, "rewritten");
    expect(edited.statusCode).toBe(403);

    const stored = await surface.readComment(commentId);
    expect(stored.body).toBe("the creator's words");
    expect(stored.deleted_at).toBeNull();
  });

  it("an agent whose creator owns no project may still comment", async () => {
    // The exception replaces only the project-owner predicate, so an agent
    // inherits its creator's right to comment on a project they can read.
    const res = await create(surface, agentOfViewer.secret, "note from a viewer's agent");

    expect(res.statusCode).toBe(201);
    expect(res.json().author_type).toBe("agent");
    expect(res.json().author_id).toBe(agentOfViewer.id);
  });
});
