import type { ProjectAccessLevel } from "@pubky-pulse/shared";
import { Badge } from "@/components/ui/badge";

/**
 * What the signed-in person may do with one project.
 *
 * Deliberately plainer than `RoleBadge`: team role and project access are
 * different questions, and reusing the crown would invite people to read one
 * as the other. Everyone on the team can read every project, so the badge only
 * ever answers "can I change this".
 */
const ACCESS_META: Record<
  ProjectAccessLevel,
  { label: string; tone: "green" | "gray" }
> = {
  owner: { label: "Owner", tone: "green" },
  viewer: { label: "Read only", tone: "gray" },
};

interface AccessLevelBadgeProps {
  level: ProjectAccessLevel;
  size?: "xs" | "sm" | "md";
}

export function AccessLevelBadge({ level, size = "sm" }: AccessLevelBadgeProps) {
  const meta = ACCESS_META[level];
  return (
    <Badge variant="outline" tone={meta.tone} size={size}>
      {meta.label}
    </Badge>
  );
}
