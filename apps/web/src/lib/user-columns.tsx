"use client";

import type { ReactNode } from "react";
import type { AppUserResponse } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VersionBadge, pickLatestForUser } from "@/components/version-badge";
import { CountryCell } from "@/components/country-flag";
import { AppBadge } from "@/components/badges/app-badge";
import { UserTypeBadge } from "@/components/badges/user-type-badge";
import { formatDateTime } from "@/lib/format-date";
import { formatSdkLabel } from "@/lib/format-sdk";
import { timeAgoOrDate } from "@/app/dashboard/_components/time-ago";

export interface UserColumnHelpers {
  appColorMap: Map<string, string>;
  appLatestVersionMap: Map<string, string | null>;
  projectInfoMap: Map<string, { name: string; color: string }>;
  /** Called when a user clicks into a cell to filter the list. */
  onFilterClick?: (key: string, value: string) => void;
}

export interface UserColumnDef {
  id: string;
  label: string;
  /** Optional grouping shown in the column picker. Omit for built-ins. */
  group?: string;
  headerClassName?: string;
  cellClassName?: string;
  render: (user: AppUserResponse, helpers: UserColumnHelpers) => ReactNode;
}

const BUILTIN_COLUMNS: Record<string, UserColumnDef> = {
  user_id: {
    id: "user_id",
    label: "User ID",
    cellClassName: "font-mono text-xs py-1.5",
    render: (user) => user.user_id,
  },
  type: {
    id: "type",
    label: "Type",
    headerClassName: "w-[100px]",
    cellClassName: "py-1.5",
    render: (user) => <UserTypeBadge isAnonymous={user.is_anonymous} />,
  },
  apps: {
    id: "apps",
    label: "Apps",
    headerClassName: "w-[180px]",
    cellClassName: "text-xs py-1.5 max-w-[180px]",
    render: (user, { appColorMap, projectInfoMap, onFilterClick }) => {
      const userProject = !user.apps?.length ? projectInfoMap.get(user.project_id) : null;
      return (
        <div className="flex flex-wrap gap-1">
          {user.apps && user.apps.length > 0 ? (
            user.apps.map((a) => (
              <AppBadge
                key={a.app_id}
                name={a.app_name}
                color={appColorMap.get(a.app_id)}
                onClick={onFilterClick ? () => onFilterClick("app_id", a.app_id) : undefined}
              />
            ))
          ) : userProject ? (
            <AppBadge
              name={userProject.name}
              color={userProject.color}
              onClick={onFilterClick ? () => onFilterClick("project_id", user.project_id) : undefined}
            />
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </div>
      );
    },
  },
  version: {
    id: "version",
    label: "Version",
    headerClassName: "w-[90px]",
    cellClassName: "text-xs py-1.5 truncate max-w-[110px]",
    render: (user, { appLatestVersionMap }) => (
      <VersionBadge
        version={user.last_app_version}
        latestVersion={pickLatestForUser(user.apps, appLatestVersionMap)}
      />
    ),
  },
  properties: {
    id: "properties",
    label: "Properties",
    headerClassName: "w-[200px]",
    cellClassName: "py-1.5",
    render: (user) => {
      if (!user.properties) return <span className="text-xs text-muted-foreground">-</span>;
      // `_`-prefixed keys are internal bookkeeping, not user-authored data.
      const otherEntries = Object.entries(user.properties).filter(
        ([k]) => !k.startsWith("_"),
      );
      return (
        <div className="flex flex-wrap items-center gap-1">
          {otherEntries.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" size="sm">🏷️ +{otherEntries.length}</Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <div className="space-y-0.5 text-xs">
                  {otherEntries.map(([k, v]) => (
                    <div key={k}>
                      <span className="text-muted-foreground">{k}:</span> {v}
                    </div>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      );
    },
  },
  first_seen: {
    id: "first_seen",
    label: "First Seen",
    headerClassName: "w-[160px]",
    cellClassName: "text-xs py-1.5",
    render: (user) => (
      <span title={formatDateTime(user.first_seen_at)}>
        {timeAgoOrDate(user.first_seen_at, formatDateTime)}
      </span>
    ),
  },
  last_seen: {
    id: "last_seen",
    label: "Last Seen",
    headerClassName: "w-[160px]",
    cellClassName: "text-xs py-1.5",
    render: (user) => (
      <span title={formatDateTime(user.last_seen_at)}>
        {timeAgoOrDate(user.last_seen_at, formatDateTime)}
      </span>
    ),
  },
  country: {
    id: "country",
    label: "Country",
    headerClassName: "w-[80px]",
    cellClassName: "text-xs py-1.5",
    render: (user) => <CountryCell code={user.last_country_code} />,
  },
  language: {
    id: "language",
    label: "Language",
    headerClassName: "w-[90px]",
    cellClassName: "font-mono text-xs py-1.5",
    // Wanted language (Locale.preferredLanguages.first) — the localization-demand signal.
    render: (user) =>
      user.last_preferred_language || <span className="text-muted-foreground font-sans">—</span>,
  },
  locale: {
    id: "locale",
    label: "Locale",
    headerClassName: "w-[90px]",
    cellClassName: "font-mono text-xs py-1.5",
    // Shown locale (Locale.current) — what the app is actually displaying.
    render: (user) =>
      user.last_locale || <span className="text-muted-foreground font-sans">—</span>,
  },
  sdk: {
    id: "sdk",
    label: "SDK",
    headerClassName: "w-[140px]",
    cellClassName: "font-mono text-xs py-1.5 truncate max-w-[160px]",
    render: (user) => {
      const label = formatSdkLabel(user.last_sdk_name, user.last_sdk_version);
      return label || <span className="text-muted-foreground">—</span>;
    },
  },
};

export const USER_COLUMN_REGISTRY: Record<string, UserColumnDef> = {
  ...BUILTIN_COLUMNS,
};

export const DEFAULT_USER_COLUMN_ORDER: string[] = [
  "user_id",
  "type",
  "apps",
  "version",
  "properties",
  "first_seen",
  "last_seen",
  "country",
];
