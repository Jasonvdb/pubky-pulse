"use client";

// Renders email-capable types straight from NOTIFICATION_TYPE_META in
// @pubky-pulse/shared/preferences, so adding one there shows up automatically.
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_META,
  isChannelEnabled,
  type NotificationType,
} from "@pubky-pulse/shared/preferences";
import { useUserPreferences, useUpdateUserPreferences } from "@/hooks/use-user-preferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";

export default function NotificationPreferencesPage() {
  const prefs = useUserPreferences();
  const update = useUpdateUserPreferences();

  const configurableTypes = NOTIFICATION_TYPES.filter(
    (type) => NOTIFICATION_TYPE_META[type].channels.includes("email"),
  );

  async function setEmailEnabled(type: NotificationType, value: boolean) {
    await update({
      notifications: {
        types: {
          [type]: { email: value },
        },
      },
    });
  }

  return (
    <AnimatedPage>
      <StaggerItem index={0}>
        <h1 className="text-2xl font-semibold">Notification preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which notification emails you receive. Notifications always appear in your
          dashboard inbox. Per-project alert frequency for issue digests is configured on each
          project&apos;s settings page — it controls how often digests batch, while these toggles
          control whether they are also emailed to you.
        </p>
      </StaggerItem>

      {configurableTypes.map((type, i) => {
        const meta = NOTIFICATION_TYPE_META[type];
        return (
          <StaggerItem key={type} index={i + 1}>
            <Card>
              <CardHeader>
                <CardTitle>{meta.label}</CardTitle>
                <p className="text-sm text-muted-foreground">{meta.description}</p>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`pref-${type}-email`}
                    checked={isChannelEnabled(prefs, type, "email")}
                    onCheckedChange={(value) => setEmailEnabled(type, value === true)}
                  />
                  <Label htmlFor={`pref-${type}-email`} className="cursor-pointer">
                    Email
                  </Label>
                </div>
              </CardContent>
            </Card>
          </StaggerItem>
        );
      })}
    </AnimatedPage>
  );
}
