export type IssueStatus = "new" | "in_progress" | "resolved" | "silenced" | "regressed" | "snoozed";
export type IssueAlertFrequency = "none" | "hourly" | "6_hourly" | "daily" | "weekly";

export const ISSUE_STATUSES = ["new", "in_progress", "resolved", "silenced", "regressed", "snoozed"] as const;
// The statuses that count as "open" — i.e. needing attention. Single source of
// truth for the "Open Issues" tile + count endpoint's `open` total.
export const OPEN_ISSUE_STATUSES = ["new", "in_progress", "regressed"] as const;
export const ISSUE_ALERT_FREQUENCIES = [
  "none", "hourly", "6_hourly", "daily", "weekly",
] as const;

// --- API Response Types ---

export interface IssueResponse {
  id: string;
  app_id: string;
  project_id: string;
  status: IssueStatus;
  title: string;
  source_module: string | null;
  is_dev: boolean;
  occurrence_count: number;
  unique_user_count: number;
  resolved_at_version: string | null;
  first_seen_app_version: string | null;
  last_seen_app_version: string | null;
  first_seen_sdk_version: string | null;
  last_seen_sdk_version: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_notified_at: string | null;
  snoozed_at: string | null;
  created_at: string;
  updated_at: string;
  fingerprints: string[];
  app_name?: string;
  project_name?: string;
}

export interface IssueOccurrenceResponse {
  id: string;
  issue_id: string;
  session_id: string;
  user_id: string | null;
  app_user_id: string | null;
  app_version: string | null;
  sdk_name: string | null;
  sdk_version: string | null;
  environment: string | null;
  /** Device model on native apps; the browser and its major version on web. */
  device_model: string | null;
  /** OS version on native apps; the OS name and version on web. */
  os_version: string | null;
  event_id: string | null;
  country_code: string | null;
  timestamp: string;
  created_at: string;
}

export type IssueCommentAuthorType = "user" | "agent";

export interface IssueCommentResponse {
  id: string;
  issue_id: string;
  author_type: IssueCommentAuthorType;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface IssueAttachmentSummary {
  id: string;
  event_id: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string | null;
  created_at: string;
}

export interface IssueDetailResponse extends IssueResponse {
  occurrences: IssueOccurrenceResponse[];
  occurrence_cursor: string | null;
  occurrence_has_more: boolean;
  comments: IssueCommentResponse[];
  attachments: IssueAttachmentSummary[];
}

// --- API Request Types ---

export interface IssuesQueryParams {
  team_id?: string;
  project_id?: string;
  status?: string;
  app_id?: string;
  is_dev?: string;
  data_mode?: string;
  cursor?: string;
  limit?: string;
}

export interface IssuesResponse {
  issues: IssueResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface IssueCountsResponse {
  new: number;
  in_progress: number;
  regressed: number;
  resolved: number;
  silenced: number;
  snoozed: number;
  /** Sum of OPEN_ISSUE_STATUSES (new + in_progress + regressed). */
  open: number;
}

export interface UpdateIssueRequest {
  status?: IssueStatus;
  resolved_at_version?: string;
}

export interface MergeIssuesRequest {
  source_issue_id: string;
}

export interface CreateIssueCommentRequest {
  body: string;
}

export interface UpdateIssueCommentRequest {
  body: string;
}

// --- Fingerprint Utilities ---

/**
 * Normalizes an error message for fingerprinting.
 * Strips variable parts: UUIDs, numbers, quoted strings.
 * Lowercases and collapses whitespace.
 */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
    .replace(/\b\d+(\.\d+)*\b/g, "<N>")
    .replace(/"[^"]*"/g, '"<S>"')
    .replace(/'[^']*'/g, "'<S>'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Browser wordings of the same JavaScript fault, mapped to one canonical form.
 *
 * Chrome, Firefox and Safari each phrase the same `TypeError` differently, so
 * without this one bug in one line of code becomes three issues. Each entry's
 * `canonical` is a template whose `$1` is replaced with the property, function
 * or variable name taken from the pattern's capture group (reduced to its last
 * dotted segment, so `cart.total` and `total` agree). The canonical forms quote
 * nothing: `normalizeErrorMessage` runs afterwards and would replace a quoted
 * name with `'<s>'`, collapsing every fault in a file onto one fingerprint.
 *
 * Order matters: the broad "<expr> is undefined" and "<expr> is not a function"
 * shapes come last so the more specific browser phrasings win.
 */
export const BROWSER_ERROR_PATTERNS: ReadonlyArray<{ pattern: RegExp; canonical: string }> = [
  // Chrome: Cannot read properties of undefined (reading 'total')
  { pattern: /^cannot read properties of (?:undefined|null) \(reading '([^']+)'\)$/i, canonical: "<undefined-property> $1" },
  // Chrome (legacy): Cannot read property 'total' of undefined
  { pattern: /^cannot read property '([^']+)' of (?:undefined|null)$/i, canonical: "<undefined-property> $1" },
  // Firefox: can't access property "total", cart is undefined
  { pattern: /^can't access property "([^"]+)", .+ is (?:undefined|null)$/i, canonical: "<undefined-property> $1" },
  // Safari: undefined is not an object (evaluating 'cart.total')
  { pattern: /^(?:undefined|null) is not an object \(evaluating '([^']+)'\)$/i, canonical: "<undefined-property> $1" },
  // Safari: Can't find variable: cart
  { pattern: /^can't find variable: (\S+)$/i, canonical: "<not-defined> $1" },
  // Chrome/Firefox: cart is not defined
  { pattern: /^(\S+) is not defined$/i, canonical: "<not-defined> $1" },
  // Chrome/Firefox: cart.total is not a function
  // Safari:         cart.total is not a function. (In 'cart.total()', 'cart.total' is undefined)
  { pattern: /^(\S+) is not a function(?:\.\s*\(in\b[\s\S]*\))?$/i, canonical: "<not-a-function> $1" },
  // Firefox: cart.total is undefined
  { pattern: /^(\S+) is (?:undefined|null)$/i, canonical: "<undefined-property> $1" },
  // Every browser, for an error thrown by a script served cross-origin.
  { pattern: /^script error\.?$/i, canonical: "<cross-origin-script-error>" },
];

/** `cart.items.total` → `total`; anything without a dot is returned as-is. */
function lastPropertySegment(expression: string): string {
  const segments = expression.split(".").filter((s) => s.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : expression;
}

/**
 * Rewrites a browser error message into a browser-independent canonical form,
 * keeping the property/function/variable name so distinct faults stay distinct.
 * Messages that match no pattern are returned unchanged.
 *
 * Only meaningful for `environment === "web"` — see generateIssueFingerprint.
 */
export function canonicalizeBrowserErrorMessage(message: string): string {
  const trimmed = message.trim();
  for (const { pattern, canonical } of BROWSER_ERROR_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const name = lastPropertySegment(match[1] ?? "");
    // Function replacement so a name containing "$" is inserted literally.
    return canonical.replace("$1", () => name);
  }
  return message;
}

/**
 * Generates a SHA-256 fingerprint for an error.
 * Based on normalized message + source_module, optionally augmented by a
 * per-event discriminator (e.g. `${method} ${host}${path}` for sdk:network_request).
 *
 * When `discriminator` is null/undefined the hash input is byte-identical to
 * the legacy 2-arg form, so existing fingerprints for non-network events
 * remain stable. Likewise `environment`: only `"web"` canonicalizes the
 * message, so fingerprints for every other environment are untouched.
 */
export async function generateIssueFingerprint(
  message: string,
  sourceModule: string | null,
  discriminator?: string | null,
  environment?: string | null,
): Promise<string> {
  const normalized = normalizeErrorMessage(
    environment === "web" ? canonicalizeBrowserErrorMessage(message) : message,
  );
  const base = `${sourceModule ?? ""}:${normalized}`;
  const input = discriminator == null
    ? base
    : `${base}|${normalizeErrorMessage(discriminator)}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
