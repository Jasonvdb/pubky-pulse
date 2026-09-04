import type { FastifyReply } from "fastify";
import { resolveCommentActor } from "./comment-author.js";
import type { AccessDenial, ProjectAccessFacts } from "./project-access.js";
import type { AuthContext } from "../types.js";

/**
 * The one comment policy, for issue, feedback and questionnaire-response
 * comments alike. Each route previously compared authorship inline as
 * `auth.type === "user" ? auth.user_id : auth.key_id`, three times over, with
 * three subtly different moderation rules.
 *
 * The policy is a narrow *exception* to the project-owner predicate, and only
 * to that predicate: authentication, team membership, resource containment and
 * the route's explicit API-key permission still apply on top of it, exactly as
 * they do for an ordinary project write.
 *
 *   - a read-only team member may create comments, and may edit or delete only
 *     comments they authored;
 *   - a human project owner may delete any comment in the project for
 *     moderation — but editing someone else's comment is never allowed, to
 *     anyone;
 *   - an agent may create comments and edit or delete comments authored by
 *     that exact key. It never moderates, even when its creator owns the
 *     project: moderation is a human judgement.
 */

/** The authorship columns every comment table shares. */
export interface CommentRecord {
  author_type: string;
  author_id: string;
}

export type CommentOperation =
  | { action: "create" }
  | { action: "edit"; comment: CommentRecord }
  | { action: "delete"; comment: CommentRecord };

const NO_ACTOR: AccessDenial = {
  status: 403,
  error: "This operation requires a user session or an agent key",
};

const NOT_AUTHOR_EDIT: AccessDenial = {
  status: 403,
  error: "Only the original author can edit this comment",
};

const NOT_AUTHOR_DELETE: AccessDenial = {
  status: 403,
  error: "Only the original author or a project owner can delete this comment",
};

/** Whether this caller is the exact author of the stored comment. */
export function isCommentAuthor(auth: AuthContext, comment: CommentRecord): boolean {
  const actor = resolveCommentActor(auth);
  if (!actor) return false;
  // Author type is compared as well as id: user ids and key ids come from
  // different tables, so an id collision must not read as authorship.
  return comment.author_type === actor.authorType && comment.author_id === actor.authorId;
}

/**
 * Decide a comment operation. Returns null when allowed, mirroring
 * `evaluateProjectWrite`. Every refusal is a 403: the caller is authenticated
 * and can see the project and the comment, they simply lack the authority.
 */
export function evaluateCommentPolicy(
  auth: AuthContext,
  access: ProjectAccessFacts,
  operation: CommentOperation,
): AccessDenial | null {
  // Client and import keys have no comment identity at all.
  if (access.actor_user_id === null || resolveCommentActor(auth) === null) return NO_ACTOR;

  if (operation.action === "create") return null;

  if (isCommentAuthor(auth, operation.comment)) return null;

  if (operation.action === "edit") return NOT_AUTHOR_EDIT;

  // Moderation: a human project owner may delete another author's comment.
  // Team ownership alone does not qualify, and an agent never does — its
  // creator's project ownership is not the agent's moderation authority.
  if (auth.type === "user" && access.is_project_owner) return null;

  return NOT_AUTHOR_DELETE;
}

/**
 * Enforce the comment policy, sending the refusal itself. Returns true when the
 * operation may proceed, so handlers read
 * `if (!enforceCommentPolicy(...)) return;`.
 */
export function enforceCommentPolicy(
  auth: AuthContext,
  access: ProjectAccessFacts,
  reply: FastifyReply,
  operation: CommentOperation,
): boolean {
  const denial = evaluateCommentPolicy(auth, access, operation);
  if (denial) {
    reply.code(denial.status).send({ error: denial.error });
    return false;
  }
  return true;
}
