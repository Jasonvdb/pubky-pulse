/**
 * The Pubky Pulse mark: a single-stroke ECG pulse line.
 *
 * Rendered inline (not via `next/image`) so it inherits `currentColor` and can
 * be tinted per placement — brand lime in the marketing chrome, muted grey in
 * dense app chrome — and so it stays crisp at any size without a raster asset.
 *
 * Server-compatible: no hooks, no client-only APIs.
 */
export function PulseLogo({ className, alt = "" }: { className?: string; alt?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role={alt ? "img" : "presentation"}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    >
      <path
        d="M2 16H9.5L13 6L17.5 26L21 16H30"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
