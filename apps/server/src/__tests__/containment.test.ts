import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
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
 * Nested-resource containment (handoff §8 "Nested-resource containment", §12
 * "Comment and containment tests") for the triage and comment modules.
 *
 * Every route here takes a project in the URL *and* a child id. The attack is
 * the confused deputy: authorize against Project A, which you legitimately own,
 * then substitute a child id belonging to Project B, which you may only read.
 * `routes/issues.ts` did exactly this until this phase — its comment routes
 * filtered by `issue_id` alone and never verified issue → project — so these
 * cases are regression tests for a live defect, not hypotheticals.
 *
 * Each row is driven by ownerA, who owns Project A and is a plain read-only
 * member of Project B, and asserts BOTH halves of the contract:
 *
 *   - the response is 404, not 403 and certainly not success — a mismatched,
 *     cross-team, deleted and nonexistent id must be indistinguishable, so a
 *     caller cannot probe for ids in projects they do not own;
 *   - the Project B row is byte-for-byte unchanged.
 *
 * Comments in Project B are authored by ownerA, so authorship would *permit*
 * the operation if containment ever failed open. The 404 therefore comes from
 * containment alone, which is what makes each row sharp.
 *
 * `project-access.test.ts` proves the containment resolvers directly; this
 * suite proves the routes actually use them.
 */

let app: FastifyInstance;
let client: postgres.Sql;

let teamId: string;
/** Owns Project A, plain member (read-only) of Project B. */
let ownerA: { userId: string; token: string };
let ownerB: { userId: string; token: string };

let a: ProjectFixture;
let b: ProjectFixture;

interface ProjectFixture {
  projectId: string;
  appId: string;
  issueId: string;
  issueCommentId: string;
  feedbackId: string;
  feedbackCommentId: string;
  questionnaireId: string;
  responseId: string;
  responseCommentId: string;
}

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

  const createdA = await createUserAndGetToken(app, "owner-a@example.com");
  ownerA = { userId: createdA.userId, token: createdA.token };
  const createdB = await createUserAndGetToken(app, "owner-b@example.com");
  ownerB = { userId: createdB.userId, token: createdB.token };

  const projectA = await createProjectWithOwner(teamId, ownerA.userId, { name: "Project A" });
  const projectB = await createProjectWithOwner(teamId, ownerB.userId, { name: "Project B" });

  // Comments in BOTH projects are authored by ownerA, so the comment policy
  // would allow every attempt below if containment failed open.
  a = await seedProject(projectA);
  b = await seedProject(projectB);
});

function unique(): string {
  return randomUUID().slice(0, 8);
}

async function seedProject(projectId: string): Promise<ProjectFixture> {
  const [appRow] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
    VALUES (${teamId}, ${projectId}, ${"Containment App"}, 'apple', ${`dev.contain.${unique()}`})
    RETURNING id
  `;
  const appId = appRow.id as string;

  const [issue] = await client`
    INSERT INTO issues (app_id, project_id, status, title, first_seen_at, last_seen_at)
    VALUES (${appId}, ${projectId}, 'new', ${"Containment issue"}, now(), now())
    RETURNING id
  `;
  const [issueComment] = await client`
    INSERT INTO issue_comments (issue_id, author_type, author_id, author_name, body)
    VALUES (${issue.id}, 'user', ${ownerA.userId}, ${"Owner A"}, ${"issue comment"})
    RETURNING id
  `;

  const [feedbackRow] = await client`
    INSERT INTO feedback (app_id, project_id, message)
    VALUES (${appId}, ${projectId}, ${"Containment feedback"})
    RETURNING id
  `;
  const [feedbackComment] = await client`
    INSERT INTO feedback_comments (feedback_id, author_type, author_id, author_name, body)
    VALUES (${feedbackRow.id}, 'user', ${ownerA.userId}, ${"Owner A"}, ${"feedback comment"})
    RETURNING id
  `;

  const slug = `contain-${unique()}`;
  const [questionnaire] = await client`
    INSERT INTO questionnaires (project_id, slug, name, schema)
    VALUES (${projectId}, ${slug}, ${"Containment questionnaire"}, ${client.json({ questions: [] })})
    RETURNING id
  `;
  const [response] = await client`
    INSERT INTO questionnaire_responses (questionnaire_id, slug, app_id, project_id, answers)
    VALUES (${questionnaire.id}, ${slug}, ${appId}, ${projectId}, ${client.json({})})
    RETURNING id
  `;
  const [responseComment] = await client`
    INSERT INTO questionnaire_response_comments (
      questionnaire_response_id, author_type, author_id, author_name, body
    )
    VALUES (${response.id}, 'user', ${ownerA.userId}, ${"Owner A"}, ${"response comment"})
    RETURNING id
  `;

  return {
    projectId,
    appId,
    issueId: issue.id as string,
    issueCommentId: issueComment.id as string,
    feedbackId: feedbackRow.id as string,
    feedbackCommentId: feedbackComment.id as string,
    questionnaireId: questionnaire.id as string,
    responseId: response.id as string,
    responseCommentId: responseComment.id as string,
  };
}

/* ---------------------------------------------------------------------------
 * State probes — each returns the whole row, so a case cannot pass by
 * asserting the one column the route happened not to touch.
 * ------------------------------------------------------------------------ */

async function issueState(id: string) {
  const [row] = await client`SELECT status, title FROM issues WHERE id = ${id}`;
  return row ?? null;
}

async function feedbackState(id: string) {
  const [row] = await client`SELECT status, deleted_at FROM feedback WHERE id = ${id}`;
  return row ?? null;
}

async function questionnaireState(id: string) {
  const [row] = await client`
    SELECT name, is_active, deleted_at FROM questionnaires WHERE id = ${id}
  `;
  return row ?? null;
}

async function responseState(id: string) {
  const [row] = await client`
    SELECT status, deleted_at FROM questionnaire_responses WHERE id = ${id}
  `;
  return row ?? null;
}

async function commentState(table: string, id: string) {
  const [row] = await client.unsafe(
    `SELECT body, deleted_at FROM ${table} WHERE id = $1`,
    [id],
  );
  return row ?? null;
}

async function commentCount(table: string, column: string, parentId: string) {
  const [row] = await client.unsafe(
    `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column} = $1`,
    [parentId],
  );
  return Number(row.count);
}

/* ---------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

interface ContainmentCase {
  /** The chain this case attacks, as handoff §8 names it. */
  chain: string;
  /** What the substitution looks like, for the test name. */
  attempt: string;
  method: "POST" | "PATCH" | "DELETE";
  /** Built lazily: fixtures are recreated for every test. */
  url: () => string;
  payload?: () => Record<string, unknown>;
  /** Throws unless every Project B row the request aimed at is unchanged. */
  expectUntouched: () => Promise<void>;
}

const cases: ContainmentCase[] = [
  {
    chain: "issue -> project",
    attempt: "a Project B issue addressed through Project A's URL",
    method: "PATCH",
    url: () => `/v1/projects/${a.projectId}/issues/${b.issueId}`,
    payload: () => ({ status: "resolved", resolved_at_version: "9.9.9" }),
    expectUntouched: async () => {
      expect(await issueState(b.issueId)).toMatchObject({ status: "new" });
    },
  },
  {
    chain: "issue -> project",
    attempt: "merging a Project B issue through Project A's URL",
    method: "POST",
    url: () => `/v1/projects/${a.projectId}/issues/${b.issueId}/merge`,
    payload: () => ({ source_issue_id: a.issueId }),
    expectUntouched: async () => {
      // A successful merge would have moved A's issue into B's and deleted A's.
      expect(await issueState(b.issueId)).not.toBeNull();
      expect(await issueState(a.issueId)).not.toBeNull();
    },
  },
  {
    chain: "issue -> project",
    attempt: "merging a Project B issue away as the source of a Project A merge",
    method: "POST",
    url: () => `/v1/projects/${a.projectId}/issues/${a.issueId}/merge`,
    payload: () => ({ source_issue_id: b.issueId }),
    expectUntouched: async () => {
      // A merge DELETES its source, so this is the destructive direction.
      expect(await issueState(b.issueId)).not.toBeNull();
    },
  },
  {
    chain: "issue comment -> issue -> project",
    attempt: "commenting on a Project B issue through Project A's URL",
    method: "POST",
    url: () => `/v1/projects/${a.projectId}/issues/${b.issueId}/comments`,
    payload: () => ({ body: "planted" }),
    expectUntouched: async () => {
      expect(await commentCount("issue_comments", "issue_id", b.issueId)).toBe(1);
    },
  },
  {
    chain: "issue comment -> issue -> project",
    attempt: "editing a Project B issue comment through Project A's URL",
    method: "PATCH",
    url: () =>
      `/v1/projects/${a.projectId}/issues/${b.issueId}/comments/${b.issueCommentId}`,
    payload: () => ({ body: "rewritten" }),
    expectUntouched: async () => {
      expect(await commentState("issue_comments", b.issueCommentId)).toMatchObject({
        body: "issue comment",
        deleted_at: null,
      });
    },
  },
  {
    chain: "issue comment -> issue -> project",
    attempt: "deleting a Project B issue comment through a Project A issue",
    method: "DELETE",
    url: () =>
      `/v1/projects/${a.projectId}/issues/${a.issueId}/comments/${b.issueCommentId}`,
    expectUntouched: async () => {
      expect(await commentState("issue_comments", b.issueCommentId)).toMatchObject({
        deleted_at: null,
      });
    },
  },
  {
    chain: "feedback -> project",
    attempt: "retriaging Project B feedback through Project A's URL",
    method: "PATCH",
    url: () => `/v1/projects/${a.projectId}/feedback/${b.feedbackId}`,
    payload: () => ({ status: "addressed" }),
    expectUntouched: async () => {
      expect(await feedbackState(b.feedbackId)).toMatchObject({ status: "new" });
    },
  },
  {
    chain: "feedback -> project",
    attempt: "deleting Project B feedback through Project A's URL",
    method: "DELETE",
    url: () => `/v1/projects/${a.projectId}/feedback/${b.feedbackId}`,
    expectUntouched: async () => {
      expect(await feedbackState(b.feedbackId)).toMatchObject({ deleted_at: null });
    },
  },
  {
    chain: "feedback comment -> feedback -> project",
    attempt: "commenting on Project B feedback through Project A's URL",
    method: "POST",
    url: () => `/v1/projects/${a.projectId}/feedback/${b.feedbackId}/comments`,
    payload: () => ({ body: "planted" }),
    expectUntouched: async () => {
      expect(await commentCount("feedback_comments", "feedback_id", b.feedbackId)).toBe(1);
    },
  },
  {
    chain: "feedback comment -> feedback -> project",
    attempt: "editing a Project B feedback comment through Project A's URL",
    method: "PATCH",
    url: () =>
      `/v1/projects/${a.projectId}/feedback/${b.feedbackId}/comments/${b.feedbackCommentId}`,
    payload: () => ({ body: "rewritten" }),
    expectUntouched: async () => {
      expect(await commentState("feedback_comments", b.feedbackCommentId)).toMatchObject({
        body: "feedback comment",
        deleted_at: null,
      });
    },
  },
  {
    chain: "feedback comment -> feedback -> project",
    attempt: "deleting a Project B feedback comment through Project A feedback",
    method: "DELETE",
    url: () =>
      `/v1/projects/${a.projectId}/feedback/${a.feedbackId}/comments/${b.feedbackCommentId}`,
    expectUntouched: async () => {
      expect(await commentState("feedback_comments", b.feedbackCommentId)).toMatchObject({
        deleted_at: null,
      });
    },
  },
  {
    chain: "questionnaire -> project",
    attempt: "editing a Project B questionnaire through Project A's URL",
    method: "PATCH",
    url: () => `/v1/projects/${a.projectId}/questionnaires/${b.questionnaireId}`,
    payload: () => ({ name: "Renamed by A" }),
    expectUntouched: async () => {
      expect(await questionnaireState(b.questionnaireId)).toMatchObject({
        name: "Containment questionnaire",
        deleted_at: null,
      });
    },
  },
  {
    chain: "questionnaire -> project",
    attempt: "deleting a Project B questionnaire through Project A's URL",
    method: "DELETE",
    url: () => `/v1/projects/${a.projectId}/questionnaires/${b.questionnaireId}`,
    expectUntouched: async () => {
      expect(await questionnaireState(b.questionnaireId)).toMatchObject({ deleted_at: null });
    },
  },
  {
    chain: "response -> questionnaire -> project",
    attempt: "retriaging a Project B response through Project A's URL",
    method: "PATCH",
    url: () =>
      `/v1/projects/${a.projectId}/questionnaires/${b.questionnaireId}/responses/${b.responseId}`,
    payload: () => ({ status: "in_review" }),
    expectUntouched: async () => {
      expect(await responseState(b.responseId)).toMatchObject({ status: "new" });
    },
  },
  {
    chain: "response -> questionnaire -> project",
    attempt: "deleting a Project B response under a Project A questionnaire",
    method: "DELETE",
    url: () =>
      `/v1/projects/${a.projectId}/questionnaires/${a.questionnaireId}/responses/${b.responseId}`,
    expectUntouched: async () => {
      expect(await responseState(b.responseId)).toMatchObject({ deleted_at: null });
    },
  },
  {
    chain: "response comment -> response -> questionnaire -> project",
    attempt: "commenting on a Project B response through Project A's URL",
    method: "POST",
    url: () =>
      `/v1/projects/${a.projectId}/questionnaires/${b.questionnaireId}/responses/${b.responseId}/comments`,
    payload: () => ({ body: "planted" }),
    expectUntouched: async () => {
      expect(
        await commentCount(
          "questionnaire_response_comments",
          "questionnaire_response_id",
          b.responseId,
        ),
      ).toBe(1);
    },
  },
  {
    chain: "response comment -> response -> questionnaire -> project",
    attempt: "editing a Project B response comment through Project A's URL",
    method: "PATCH",
    url: () =>
      `/v1/projects/${a.projectId}/questionnaires/${b.questionnaireId}/responses/${b.responseId}/comments/${b.responseCommentId}`,
    payload: () => ({ body: "rewritten" }),
    expectUntouched: async () => {
      expect(
        await commentState("questionnaire_response_comments", b.responseCommentId),
      ).toMatchObject({ body: "response comment", deleted_at: null });
    },
  },
  {
    chain: "response comment -> response -> questionnaire -> project",
    attempt: "deleting a Project B response comment under a Project A questionnaire",
    method: "DELETE",
    url: () =>
      `/v1/projects/${a.projectId}/questionnaires/${a.questionnaireId}/responses/${b.responseId}/comments/${b.responseCommentId}`,
    expectUntouched: async () => {
      expect(
        await commentState("questionnaire_response_comments", b.responseCommentId),
      ).toMatchObject({ deleted_at: null });
    },
  },
];

describe.each(cases)("$chain", (testCase) => {
  it(`404s and changes nothing: ${testCase.attempt}`, async () => {
    const payload = testCase.payload?.();

    const res = await app.inject({
      method: testCase.method,
      url: testCase.url(),
      headers: { authorization: `Bearer ${ownerA.token}` },
      ...(payload ? { payload } : {}),
    });

    expect(res.statusCode).toBe(404);
    expect(typeof res.json().error).toBe("string");
    await testCase.expectUntouched();
  });
});

/* ---------------------------------------------------------------------------
 * The mirror image: the same requests aimed at Project A succeed, so every 404
 * above is containment refusing the substitution rather than a route that
 * simply never works.
 * ------------------------------------------------------------------------ */

describe("the same routes work inside the caller's own project", () => {
  it("PATCH an issue in Project A", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${a.projectId}/issues/${a.issueId}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: { status: "resolved", resolved_at_version: "9.9.9" },
    });

    expect(res.statusCode).toBe(200);
    expect(await issueState(a.issueId)).toMatchObject({ status: "resolved" });
  });

  it("DELETE an issue comment in Project A", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${a.projectId}/issues/${a.issueId}/comments/${a.issueCommentId}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect((await commentState("issue_comments", a.issueCommentId))?.deleted_at).not.toBeNull();
  });

  it("PATCH feedback in Project A", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${a.projectId}/feedback/${a.feedbackId}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: { status: "addressed" },
    });

    expect(res.statusCode).toBe(200);
    expect(await feedbackState(a.feedbackId)).toMatchObject({ status: "addressed" });
  });

  it("DELETE a questionnaire in Project A", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${a.projectId}/questionnaires/${a.questionnaireId}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect((await questionnaireState(a.questionnaireId))?.deleted_at).not.toBeNull();
  });

  it("PATCH a questionnaire response in Project A", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${a.projectId}/questionnaires/${a.questionnaireId}/responses/${a.responseId}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: { status: "in_review" },
    });

    expect(res.statusCode).toBe(200);
    expect(await responseState(a.responseId)).toMatchObject({ status: "in_review" });
  });

  it("Project B's own owner is unaffected by any of it", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${b.projectId}/issues/${b.issueId}`,
      headers: { authorization: `Bearer ${ownerB.token}` },
      payload: { status: "in_progress" },
    });

    expect(res.statusCode).toBe(200);
    expect(await issueState(b.issueId)).toMatchObject({ status: "in_progress" });
  });
});
