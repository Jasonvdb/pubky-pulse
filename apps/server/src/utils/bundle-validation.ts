/** The key selects the app; native identifiers only catch configuration mistakes. */
export function hasNativeBundleMismatch(
  app: { platform: string; bundle_id: string | null },
  bundleId: unknown,
): boolean {
  if (app.platform !== "apple" && app.platform !== "android") return false;
  if (bundleId === undefined) return false;
  return typeof bundleId !== "string" || bundleId.length === 0 || bundleId !== app.bundle_id;
}
