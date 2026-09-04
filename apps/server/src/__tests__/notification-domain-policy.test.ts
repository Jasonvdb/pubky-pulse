import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  createUserAndGetToken,
  getTokenAndTeamId,
  testEmailService,
  TEST_DB_URL,
} from "./setup.js";
import { resolveTeamMemberUserIds } from "../utils/team-members.js";

/**
 * The email-domain allowlist on the notification path.
 *
 * HTTP requests revalidate a user's stored address on every call, so removing a
 * domain from PULSE_ALLOWED_EMAIL_DOMAINS locks that person out immediately.
 * Notifications are produced by jobs and by unauthenticated ingest instead, so
 * without an explicit check they would keep mailing internal project data to a
 * revoked address. These tests pin both ends of that path: recipient resolution
 * and the later per-delivery lookup.
 *
 * `pulse.pubky.org` and `example.com` are the suite's configured allowed domains
 * (vitest.config.ts); `revoked.test` stands for a domain that has been removed.
 */
const REVOKED_EMAIL = "former-colleague@revoked.test";

let app: FastifyInstance;
let client: postgres.Sql;
let teamId: string;
let allowedUserId: string;
let revokedUserId: string;

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
  await seedTestData();
  const seeded = await getTokenAndTeamId(app);
  teamId = seeded.teamId;

  const allowed = await createUserAndGetToken(app, "still-here@example.com");
  allowedUserId = allowed.userId;

  // The revoked user signs up while their domain is still allowed, then the
  // domain is dropped — which in production means only that the stored address
  // no longer passes the allowlist. Their team_members row survives.
  const revoked = await createUserAndGetToken(app, "former-colleague@example.com");
  revokedUserId = revoked.userId;
  await client`UPDATE users SET email = ${REVOKED_EMAIL} WHERE id = ${revokedUserId}`;

  testEmailService.lastGenericNotificationEmail = "";
  testEmailService.lastGenericNotificationParams = null;
});

describe("resolveTeamMemberUserIds", () => {
  it("excludes a member whose stored email is on a revoked domain", async () => {
    const ids = await resolveTeamMemberUserIds(app.db, teamId);

    expect(ids).toContain(allowedUserId);
    expect(ids).not.toContain(revokedUserId);
  });
});

describe("NotificationDispatcher domain policy", () => {
  it("creates no notification or delivery rows for a revoked-domain recipient", async () => {
    const result = await app.notificationDispatcher.enqueue({
      type: "feedback.new",
      userIds: [revokedUserId],
      teamId,
      payload: { title: "Internal feedback", body: "Should not leave the org" },
    });

    expect(result.notificationIds).toEqual([]);

    const inbox = await client`SELECT id FROM notifications WHERE user_id = ${revokedUserId}`;
    expect(inbox).toHaveLength(0);

    const deliveries = await client`SELECT id FROM notification_deliveries`;
    expect(deliveries).toHaveLength(0);

    expect(testEmailService.lastGenericNotificationEmail).toBe("");
  });

  it("still notifies the allowed recipients of a mixed fan-out", async () => {
    const result = await app.notificationDispatcher.enqueue({
      type: "feedback.new",
      userIds: [allowedUserId, revokedUserId],
      teamId,
      payload: { title: "Internal feedback" },
    });

    expect(result.notificationIds).toHaveLength(1);

    const inbox = await client`SELECT user_id FROM notifications`;
    expect(inbox.map((r) => r.user_id)).toEqual([allowedUserId]);
  });

  it("skips delivery when the domain is revoked after the row was queued", async () => {
    // The rows are inserted directly so the revocation lands strictly between
    // queueing and delivery — the window `enqueue`'s own check cannot cover.
    const [notif] = await client`
      INSERT INTO notifications (user_id, team_id, type, title, body)
      VALUES (${allowedUserId}, ${teamId}, 'feedback.new', 'Internal feedback', 'Body')
      RETURNING id
    `;
    const [delivery] = await client`
      INSERT INTO notification_deliveries (notification_id, channel, status)
      VALUES (${notif.id}, 'email', 'pending')
      RETURNING id
    `;

    await client`UPDATE users SET email = ${"gone@revoked.test"} WHERE id = ${allowedUserId}`;

    const outcome = await app.notificationDispatcher.runDelivery(delivery.id as string);

    expect(outcome.status).toBe("skipped");
    expect(testEmailService.lastGenericNotificationEmail).toBe("");
  });
});
