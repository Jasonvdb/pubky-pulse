import type { TeamRole } from "@pubky-pulse/shared";
import { Badge } from "@/components/ui/badge";

const ROLE_META: Record<TeamRole, { emoji: string; label: string; variant: "default" | "outline" }> = {
  owner: { emoji: "👑", label: "owner", variant: "default" },
  member: { emoji: "👤", label: "member", variant: "outline" },
};

interface RoleBadgeProps {
  role: TeamRole;
  size?: "sm" | "md";
}

export function RoleBadge({ role, size = "sm" }: RoleBadgeProps) {
  const meta = ROLE_META[role];
  return (
    <Badge variant={meta.variant} size={size}>
      {meta.emoji} {meta.label}
    </Badge>
  );
}
