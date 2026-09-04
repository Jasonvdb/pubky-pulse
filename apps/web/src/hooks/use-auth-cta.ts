"use client";

import { useUser } from "@/hooks/use-user";

/**
 * Where the marketing call-to-action points, and what it says.
 *
 * Auth state comes from `/v1/auth/me`, never from `document.cookie`: the session
 * cookie is set `httpOnly` (see `COOKIE_OPTIONS` in the server's auth routes), so
 * script can never read it. A cookie check here reported "signed out" for every
 * visitor forever, which sent freshly signed-in users to `/login` — where the
 * proxy's server-side redirect only kicked in on a full page load, because a
 * client-side `<Link>` navigation is served from Next's prefetch cache.
 *
 * `useUser` shares its SWR key with the landing page's sign-in card, so this adds
 * no request, and that card's `mutate()` after a verified code flips the CTA to
 * "Dashboard" immediately, with no reload.
 */
export function useAuthCta() {
  const { user } = useUser();
  const isAuthenticated = !!user;

  return {
    href: isAuthenticated ? "/dashboard" : "/login",
    label: isAuthenticated ? "Dashboard" : "Get Started",
  };
}
