import { eq } from "drizzle-orm";
import { users, apiKeys } from "@pubky-pulse/db";
import type { Db } from "@pubky-pulse/db";
import type { AuthContext } from "../types.js";

export interface CommentActor {
  authorType: "user" | "agent";
  authorId: string;
}

export interface CommentAuthor extends CommentActor {
  authorName: string;
}

/**
 * The identity a comment written by this caller is attributed to, resolved
 * without touching the database — the authorship half of
 * `resolveCommentAuthor`, and the value `utils/comment-policy.ts` compares a
 * stored comment against.
 *
 * An agent comment is authored by the *exact key*, not by the human who
 * created it: two keys made by the same person are different authors, which is
 * what stops one agent from editing or deleting another's comments.
 *
 * Returns null for client and import keys. They are the SDK ingestion data
 * plane, hold no comment permission, and so can never author or moderate.
 */
export function resolveCommentActor(auth: AuthContext): CommentActor | null {
  if (auth.type === "user") return { authorType: "user", authorId: auth.user_id };
  if (auth.key_type === "agent") return { authorType: "agent", authorId: auth.key_id };
  return null;
}

/**
 * Resolve the author fields for a comment insert from the authenticated caller.
 * User JWT → user's display name (falls back to their email).
 * Agent key → the key's label (falls back to "Agent").
 */
export async function resolveCommentAuthor(
  db: Db,
  auth: AuthContext,
): Promise<CommentAuthor> {
  if (auth.type === "user") {
    const [user] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, auth.user_id))
      .limit(1);
    return {
      authorType: "user",
      authorId: auth.user_id,
      authorName: user?.name ?? auth.email,
    };
  }
  const [key] = await db
    .select({ name: apiKeys.name })
    .from(apiKeys)
    .where(eq(apiKeys.id, auth.key_id))
    .limit(1);
  return {
    authorType: "agent",
    authorId: auth.key_id,
    authorName: key?.name ?? "Agent",
  };
}
