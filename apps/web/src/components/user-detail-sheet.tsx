"use client";

import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { AppBadge } from "@/components/badges/app-badge";
import { UserTypeBadge } from "@/components/badges/user-type-badge";
import { Badge } from "@/components/ui/badge";
import { DetailRow } from "@/components/detail-row";
import { VersionRow, pickLatestForUser } from "@/components/version-badge";
import { ArrowRight } from "lucide-react";
import { formatDateTime } from "@/lib/format-date";
import { ProjectDot } from "@/lib/project-color";
import { countryFlag } from "@/lib/country-flag";
import type { AppUserResponse } from "@pubky-pulse/shared";

interface UserDetailSheetProps {
  user: AppUserResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilter?: (key: string, value: string) => void;
  projectColorMap?: Map<string, string>;
  appColorMap?: Map<string, string>;
  appLatestVersionMap?: Map<string, string | null>;
}

function PropertiesPanel({ properties }: { properties: Record<string, string> }) {
  const diagnostics: Array<[string, string]> = [];
  const other: Array<[string, string]> = [];

  for (const [k, v] of Object.entries(properties)) {
    // Underscore-prefixed keys are server-stamped diagnostics. Hide them from
    // the main properties list and render in a separate, collapsed-feel
    // Diagnostics section.
    if (k.startsWith("_")) diagnostics.push([k, v]);
    else other.push([k, v]);
  }

  return (
    <>
      {other.length > 0 && (
        <>
          <Separator className="my-4" />
          <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Properties
          </h3>
          <div className="space-y-1">
            {other.map(([k, v]) => (
              <DetailRow key={k} label={k} value={v} />
            ))}
          </div>
        </>
      )}
      {diagnostics.length > 0 && (
        <>
          <Separator className="my-4" />
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 list-none flex items-center gap-1">
              <span>Diagnostics ({diagnostics.length})</span>
              <span className="text-[10px] opacity-60">(click to expand)</span>
            </summary>
            <div className="space-y-1">
              {diagnostics.map(([k, v]) => (
                <DetailRow key={k} label={k.replace(/^_/, "")} value={v || "—"} />
              ))}
            </div>
          </details>
        </>
      )}
    </>
  );
}

export function UserDetailSheet({ user, open, onOpenChange, onFilter, projectColorMap, appColorMap, appLatestVersionMap }: UserDetailSheetProps) {
  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[500px] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2">
            <ProjectDot color={projectColorMap?.get(user.project_id)} />
            <UserTypeBadge isAnonymous={user.is_anonymous} size="md" />
            {user.is_dev && (
              <Badge variant="outline" className="text-xs font-normal">
                🛠️ Dev
              </Badge>
            )}
          </div>
          <SheetTitle className="text-base font-medium mt-1 break-words font-mono">
            {user.user_id}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0 px-6 pb-6">
          <div className="space-y-1">
            <DetailRow label="User ID" value={user.user_id} onFilter={onFilter ? () => onFilter("search", user.user_id) : undefined} filterKey="user" />
            <DetailRow label="Internal ID" value={user.id} />
            <DetailRow
              label="Project ID"
              value={user.project_id}
              onFilter={onFilter ? () => onFilter("project_id", user.project_id) : undefined}
              filterKey="project"
            />
            <DetailRow label="First Seen" value={formatDateTime(user.first_seen_at)} />
            <DetailRow label="Last Seen" value={formatDateTime(user.last_seen_at)} />
            <VersionRow
              label="Last App Version"
              version={user.last_app_version}
              latestVersion={appLatestVersionMap ? pickLatestForUser(user.apps, appLatestVersionMap) : null}
            />
            {(() => {
              const f = countryFlag(user.last_country_code);
              return f.emoji ? (
                <DetailRow label="Last Country" value={`${f.emoji} ${f.name} (${f.code})`} />
              ) : null;
            })()}
          </div>

          {user.claimed_from && user.claimed_from.length > 0 && (
            <>
              <Separator className="my-4" />
              <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Claims ({user.claimed_from.length})
              </h3>
              <div className="space-y-1">
                {user.claimed_from.map((id) => (
                  <div key={id} className="font-mono text-xs break-all py-1.5">
                    {id}
                  </div>
                ))}
              </div>
            </>
          )}

          {user.apps && user.apps.length > 0 && (
            <>
              <Separator className="my-4" />
              <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Apps
              </h3>
              <div className="space-y-3">
                {user.apps.map((app) => (
                  <div key={app.app_id} className="space-y-1">
                    <AppBadge
                      name={app.app_name}
                      color={appColorMap?.get(app.app_id) ?? projectColorMap?.get(user.project_id)}
                      size="md"
                      onClick={onFilter ? () => onFilter("app_id", app.app_id) : undefined}
                    />
                    <DetailRow label="First Seen" value={formatDateTime(app.first_seen_at)} />
                    <DetailRow label="Last Seen" value={formatDateTime(app.last_seen_at)} />
                  </div>
                ))}
              </div>
            </>
          )}

          {user.properties && Object.keys(user.properties).length > 0 && (
            <PropertiesPanel properties={user.properties} />
          )}

          <Separator className="my-4" />

          <Button variant="outline" size="sm" className="w-full" asChild>
            <Link href={`/dashboard/events?project_id=${user.project_id}&user_id=${user.user_id}`}>
              <ArrowRight className="h-3.5 w-3.5 mr-2" />
              View Events
            </Link>
          </Button>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
