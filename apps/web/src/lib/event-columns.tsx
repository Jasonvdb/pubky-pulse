"use client";

import type { ReactNode } from "react";
import type { LogLevel, StoredEventResponse } from "@pubky-pulse/shared";
import { EventLevelBadge } from "@/components/event-level-badge";
import { VersionBadge } from "@/components/version-badge";
import { CountryCell } from "@/components/country-flag";
import { ProjectDot } from "@/lib/project-color";
import { formatShortDate, formatTime, formatDateTime } from "@/lib/format-date";
import { formatSdkLabel } from "@/lib/format-sdk";
import { environmentLabel } from "@/lib/platforms";

/**
 * A cell whose column truncates: the full value stays reachable as a tooltip.
 * Web paths and browser strings are the ones that actually overflow.
 */
function TruncatedCell({ value }: { value: string | null }) {
  if (!value) return <>—</>;
  return <span title={value}>{value}</span>;
}

export interface EventColumnHelpers {
  appNameMap: Map<string, string>;
  appColorMap: Map<string, string | undefined>;
  appLatestVersionMap: Map<string, string | null>;
}

export interface EventColumnDef {
  id: string;
  label: string;
  /** Optional grouping shown in the column picker. Omit for built-ins. */
  group?: string;
  headerClassName?: string;
  cellClassName?: string;
  render: (event: StoredEventResponse, helpers: EventColumnHelpers) => ReactNode;
}

export const EVENT_COLUMN_REGISTRY: Record<string, EventColumnDef> = {
  timestamp: {
    id: "timestamp",
    label: "Time",
    headerClassName: "w-[100px]",
    cellClassName: "font-mono text-xs py-1.5",
    render: (event) => {
      const ts = new Date(event.timestamp);
      return (
        <span title={formatDateTime(ts)}>
          {formatTime(ts)} {formatShortDate(ts)}
        </span>
      );
    },
  },
  level: {
    id: "level",
    label: "Level",
    headerClassName: "w-[90px]",
    cellClassName: "py-1.5",
    render: (event) => <EventLevelBadge level={event.level as LogLevel} />,
  },
  message: {
    id: "message",
    label: "Message",
    cellClassName: "font-mono text-xs py-1.5 truncate",
    render: (event) => event.message,
  },
  app: {
    id: "app",
    label: "App",
    headerClassName: "w-[140px]",
    cellClassName: "text-xs py-1.5 truncate max-w-[140px]",
    render: (event, { appNameMap, appColorMap }) => (
      <span className="flex items-center gap-1.5">
        <ProjectDot color={appColorMap.get(event.app_id)} size={6} />
        <span className="truncate">{appNameMap.get(event.app_id) ?? event.app_id}</span>
      </span>
    ),
  },
  version: {
    id: "version",
    label: "Version",
    headerClassName: "w-[90px]",
    cellClassName: "text-xs py-1.5 truncate max-w-[110px]",
    render: (event, { appLatestVersionMap }) => (
      <VersionBadge
        version={event.app_version}
        latestVersion={appLatestVersionMap.get(event.app_id) ?? undefined}
      />
    ),
  },
  environment: {
    id: "environment",
    label: "Environment",
    headerClassName: "w-[110px]",
    cellClassName: "text-xs py-1.5 truncate max-w-[110px]",
    render: (event) => environmentLabel(event.environment) || "—",
  },
  country: {
    id: "country",
    label: "Country",
    headerClassName: "w-[80px]",
    cellClassName: "text-xs py-1.5",
    render: (event) => <CountryCell code={event.country_code} />,
  },
  user_id: {
    id: "user_id",
    label: "User ID",
    headerClassName: "w-[140px]",
    cellClassName: "font-mono text-xs py-1.5 truncate max-w-[140px]",
    render: (event) => event.user_id ?? "—",
  },
  screen: {
    // Wide enough for a URL path, which is what a web event puts here, and the
    // title attribute carries the rest when the path still overflows.
    id: "screen",
    label: "Screen / Path",
    headerClassName: "w-[180px]",
    cellClassName: "text-xs py-1.5 truncate max-w-[180px]",
    render: (event) => <TruncatedCell value={event.screen_name} />,
  },
  // Off by default: only web and cross-device investigations need these, and
  // the table is already dense. Both hold browser facts on a web event.
  device: {
    id: "device",
    label: "Device / Browser",
    headerClassName: "w-[120px]",
    cellClassName: "text-xs py-1.5 truncate max-w-[120px]",
    render: (event) => <TruncatedCell value={event.device_model} />,
  },
  os: {
    id: "os",
    label: "OS",
    headerClassName: "w-[110px]",
    cellClassName: "text-xs py-1.5 truncate max-w-[110px]",
    render: (event) => <TruncatedCell value={event.os_version} />,
  },
  sdk: {
    id: "sdk",
    label: "SDK",
    headerClassName: "w-[140px]",
    cellClassName: "font-mono text-xs py-1.5 truncate max-w-[160px]",
    render: (event) => formatSdkLabel(event.sdk_name, event.sdk_version) || "—",
  },
};

export const DEFAULT_EVENT_COLUMN_ORDER: string[] = [
  "timestamp",
  "level",
  "message",
  "app",
  "version",
  "environment",
  "country",
  "user_id",
  "screen",
];
