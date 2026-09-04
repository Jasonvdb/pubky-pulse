"use client";

import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ApiError } from "@/lib/api";
import type {
  ProjectAccessLevel,
  ProjectDetailResponse,
  ProjectOwnerResponse,
  ProjectResponse,
} from "@pubky-pulse/shared";

/**
 * Project access for the dashboard.
 *
 * Every project the API serialises carries an `access_level` the server
 * resolved for the caller. That value is the only thing this file reads: the
 * dashboard never works out who owns a project from a team role, and it never
 * keeps an access list of its own that could drift from the server's. When
 * ownership changes, the answer changes because the project was refetched.
 *
 * Hiding a control is a courtesy, not a defence — the API refuses the write
 * either way. `useWriteFailureHandler` is the other half of that contract: when
 * a page has been open long enough to go stale and the server answers 403, the
 * page says so plainly and reloads the affected resource instead of pretending
 * the change stuck.
 */

/** The team project list, the same key every page already uses. */
export function projectListKey(teamId: string | null | undefined): string | null {
  return teamId ? `/v1/projects?team_id=${teamId}` : null;
}

/**
 * The team's projects, plus the subset the signed-in person may write to.
 *
 * Read filters and dropdowns offer `projects` — everyone can read everything on
 * the team. Anything that picks a *target* to create in offers `ownedProjects`.
 */
export function useProjects(teamId: string | null | undefined) {
  const { data, isLoading, error, mutate } = useSWR<{ projects: ProjectResponse[] }>(
    projectListKey(teamId),
  );

  const projects = useMemo(() => data?.projects ?? [], [data]);

  const accessByProjectId = useMemo(() => {
    const map = new Map<string, ProjectAccessLevel>();
    for (const project of projects) map.set(project.id, project.access_level);
    return map;
  }, [projects]);

  const ownedProjects = useMemo(
    () => projects.filter((project) => project.access_level === "owner"),
    [projects],
  );

  /** False until the list has loaded, so controls never flash open then close. */
  const canWriteProject = useCallback(
    (projectId: string | null | undefined) =>
      !!projectId && accessByProjectId.get(projectId) === "owner",
    [accessByProjectId],
  );

  return {
    projects,
    ownedProjects,
    accessByProjectId,
    canWriteProject,
    isLoading,
    error,
    mutate,
  };
}

/** One project with its apps, its owners, and this person's access to it. */
export function useProject(projectId: string | null | undefined) {
  const { data, isLoading, error, mutate } = useSWR<ProjectDetailResponse>(
    projectId ? `/v1/projects/${projectId}` : null,
  );

  const owners: ProjectOwnerResponse[] = useMemo(() => data?.owners ?? [], [data]);

  return {
    project: data,
    owners,
    accessLevel: data?.access_level ?? null,
    canWrite: data?.access_level === "owner",
    isLoading,
    error,
    mutate,
  };
}

/**
 * The project list and project detail caches — everything whose payload carries
 * an `access_level`. Nested collections (`/v1/projects/:id/metrics` and the
 * like) are deliberately excluded: an ownership change does not alter them.
 */
const PROJECT_ACCESS_KEY = /^\/v1\/projects(\?.*)?$|^\/v1\/projects\/[^/?]+$/;

/**
 * Refetch every cached project list and detail response.
 *
 * Owner changes and refused writes both land here, so a page that gains or
 * loses ownership updates its controls in place rather than waiting for a
 * reload.
 */
export function useRevalidateProjectAccess() {
  const { mutate } = useSWRConfig();
  return useCallback(
    () => mutate((key) => typeof key === "string" && PROJECT_ACCESS_KEY.test(key)),
    [mutate],
  );
}

/** A refusal from the server: visible resource, insufficient rights. */
export function isForbidden(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403;
}

export const READ_ONLY_MESSAGE =
  "You are not an owner of this project, so nothing was changed. The page now shows the current state.";

/**
 * Turn a failed write into something worth reading, and refresh what the
 * failure implies.
 *
 * A 403 means this page's idea of who owns the project is out of date, so the
 * project caches are refetched (which re-hides the controls) along with the
 * resource the write targeted. Everything else keeps the server's own message.
 */
export function useWriteFailureHandler() {
  const revalidateProjectAccess = useRevalidateProjectAccess();

  return useCallback(
    async (
      error: unknown,
      fallback: string,
      refreshResource?: () => void | Promise<unknown>,
    ): Promise<string> => {
      if (isForbidden(error)) {
        await revalidateProjectAccess();
        await refreshResource?.();
        return READ_ONLY_MESSAGE;
      }
      if (error instanceof ApiError) return error.message;
      return error instanceof Error ? error.message : fallback;
    },
    [revalidateProjectAccess],
  );
}
