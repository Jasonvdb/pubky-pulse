"use client";

import useSWR from "swr";
import { formatDate } from "@/lib/format-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RoleBadge } from "@/components/badges/role-badge";
import { CountBadge } from "@/components/badges/count-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUser } from "@/hooks/use-user";
import { useTeam } from "@/contexts/team-context";
import type { TeamDetailResponse } from "@pubky-pulse/shared";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The team roster, read-only.
 *
 * Who is on the team, and who owns it, come from server configuration: people
 * join by signing in with an allowed email domain, and the sole team owner is
 * the configured recovery identity. There is nothing to invite, promote,
 * rename or remove from here, so the page's job is to answer "who are my
 * colleagues, and what is their user id" — the roster the project owners card
 * picks from.
 */
export default function TeamPage() {
  const { currentTeam } = useTeam();
  const { user } = useUser();

  const { data: teamDetail, error } = useSWR<TeamDetailResponse>(
    currentTeam ? `/v1/teams/${currentTeam.id}` : null,
  );

  if (!currentTeam) {
    return <p className="text-muted-foreground">Loading your team…</p>;
  }

  const members = teamDetail?.members ?? [];

  return (
    <AnimatedPage className="space-y-8">
      <StaggerItem index={0}>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{teamDetail?.name ?? currentTeam.name}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Everyone who signs in with an approved company email joins this team and
            can read every project in it. Membership and the team owner come from
            server configuration, so they are not editable here. Who can change a
            project is set per project, on the project itself.
          </p>
        </div>
      </StaggerItem>

      <StaggerItem index={1}>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <CardTitle>Members</CardTitle>
            {members.length > 0 && <CountBadge>{members.length}</CountBadge>}
          </CardHeader>
          <CardContent>
            {error ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                The roster didn&apos;t load. Refresh the page to try again.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.length === 0
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-3 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-3 w-40" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                          <TableCell><Skeleton className="h-3 w-20" /></TableCell>
                        </TableRow>
                      ))
                    : members.map((member) => (
                        <TableRow key={member.user_id}>
                          <TableCell>
                            {member.name}
                            {member.user_id === user?.id && (
                              <span className="ml-1 text-muted-foreground">(you)</span>
                            )}
                          </TableCell>
                          <TableCell>{member.email}</TableCell>
                          <TableCell>
                            <RoleBadge role={member.role} size="md" />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(member.joined_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </StaggerItem>
    </AnimatedPage>
  );
}
