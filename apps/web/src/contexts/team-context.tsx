"use client";

import { createContext, useContext } from "react";
import { useUser } from "@/hooks/use-user";
import type { AuthTeamMembership } from "@pubky-pulse/shared";

interface TeamContextValue {
  /** The one configured team this deployment runs, or null before /auth/me lands. */
  currentTeam: AuthTeamMembership | null;
  /** True when the signed-in user is the configured team owner. */
  isTeamOwner: boolean;
}

const TeamContext = createContext<TeamContextValue>({
  currentTeam: null,
  isTeamOwner: false,
});

/**
 * The deployment runs exactly one team, so there is nothing to switch between
 * and nothing to remember: every signed-in user is revalidated against the
 * configured team on each request and `/auth/me` returns that membership.
 *
 * `isTeamOwner` is a convenience for hiding controls the server will refuse
 * anyway (the team-wide audit trail). The server stays authoritative — this
 * never stands in for a permission check, and project write access comes from
 * each project's own server-provided `access_level`, never from a team role.
 */
export function TeamProvider({ children }: { children: React.ReactNode }) {
  const { teams } = useUser();
  const currentTeam = teams?.[0] ?? null;

  return (
    <TeamContext.Provider
      value={{ currentTeam, isTeamOwner: currentTeam?.role === "owner" }}
    >
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  return useContext(TeamContext);
}
