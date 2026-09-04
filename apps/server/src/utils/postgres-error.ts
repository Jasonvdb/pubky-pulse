function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

export function hasPostgresErrorCode(error: unknown, code: string): boolean {
  const seen = new Set<object>();
  let current = error;

  while (isObject(current)) {
    if (seen.has(current)) return false;
    seen.add(current);

    if (typeof current.code === "string" && current.code === code) return true;
    current = current.cause;
  }

  return false;
}
