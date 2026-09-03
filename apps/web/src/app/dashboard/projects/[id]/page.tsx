"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus, Pencil, Trash2, ScrollText, Users } from "lucide-react";
import Link from "next/link";
import { useBreadcrumbs } from "@/contexts/breadcrumb-context";
import { useTeam } from "@/contexts/team-context";
import { useUser } from "@/hooks/use-user";
import {
  useProject,
  useRevalidateProjectAccess,
  useWriteFailureHandler,
} from "@/hooks/use-project";
import { AccessLevelBadge } from "@/components/badges/access-level-badge";
import { CountBadge } from "@/components/badges/count-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AnimatedPage } from "@/components/ui/animated-page";
import { DetailSkeleton } from "@/components/ui/skeletons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CopyButton } from "@/components/copy-button";
import { api } from "@/lib/api";
import { ProjectDot } from "@/lib/project-color";
import type {
  AppResponse,
  ProjectDetailResponse,
  TeamDetailResponse,
} from "@pubky-pulse/shared";
import { PROJECT_COLORS, isValidProjectColor } from "@pubky-pulse/shared/project-colors";

// Inline to avoid pulling node:crypto via the @pubky-pulse/shared barrel
const DEFAULT_RETENTION_DAYS_EVENTS = 120;
const DEFAULT_RETENTION_DAYS_METRICS = 365;
const DEFAULT_RETENTION_DAYS_FUNNELS = 365;

const PLATFORM_OPTIONS = [
  { value: "apple", label: "🍎 Apple" },
  { value: "android", label: "🤖 Android" },
  { value: "web", label: "🌐 Web" },
  { value: "backend", label: "☁️ Backend" },
];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { setBreadcrumbs } = useBreadcrumbs();
  // `access_level` is resolved by the server for this caller. Every control on
  // this page reads it; nothing here works ownership out for itself.
  const { project, accessLevel, canWrite, mutate } = useProject(id);
  const handleWriteFailure = useWriteFailureHandler();

  useEffect(() => {
    if (project?.name) {
      setBreadcrumbs(
        [{ label: "Projects", href: "/dashboard/projects" }, { label: project.name }],
        pathname,
      );
    }
  }, [project?.name, pathname, setBreadcrumbs]);

  // Edit project
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState("");

  // Create app
  const [appDialogOpen, setAppDialogOpen] = useState(false);
  const [appName, setAppName] = useState("");
  const [appPlatform, setAppPlatform] = useState("apple");
  const [appBundleId, setAppBundleId] = useState("");
  const [appError, setAppError] = useState("");
  const [appLoading, setAppLoading] = useState(false);
  const [newClientSecret, setNewClientSecret] = useState<string | null>(null);

  // Delete
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  if (!project) {
    return (
      <AnimatedPage className="space-y-6">
        <DetailSkeleton />
      </AnimatedPage>
    );
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    setEditError("");
    try {
      await api.patch(`/v1/projects/${id}`, { name: editName });
      setEditing(false);
      mutate();
    } catch (err) {
      setEditError(await handleWriteFailure(err, "Failed to rename", mutate));
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this project and all its apps?")) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.delete(`/v1/projects/${id}`);
      router.push("/dashboard/projects");
    } catch (err) {
      setDeleteError(await handleWriteFailure(err, "Failed to delete", mutate));
      setDeleting(false);
    }
  }

  async function handleCreateApp(e: React.FormEvent) {
    e.preventDefault();
    setAppError("");
    setAppLoading(true);

    try {
      const res = await api.post<{ app: AppResponse }>("/v1/apps", {
        name: appName,
        platform: appPlatform,
        ...(appPlatform !== "backend" ? { bundle_id: appBundleId } : {}),
        project_id: id,
      });
      setNewClientSecret(res.app.client_secret);
      setAppName("");
      setAppBundleId("");
      setAppPlatform("apple");
      setAppDialogOpen(false);
      mutate();
    } catch (err) {
      setAppError(await handleWriteFailure(err, "Failed to create app", mutate));
    } finally {
      setAppLoading(false);
    }
  }

  function resetAppDialog() {
    setAppName("");
    setAppBundleId("");
    setAppPlatform("apple");
    setAppError("");
  }

  return (
    <AnimatedPage className="space-y-6">
      <div className="flex items-center gap-4">
        {editing ? (
          <form onSubmit={handleRename} className="flex items-center gap-2">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-64"
              autoFocus
            />
            <Button type="submit" size="sm">Save</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {editError && <span className="text-sm text-destructive">{editError}</span>}
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <ProjectDot color={project.color} size={12} />
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            {accessLevel && <AccessLevelBadge level={accessLevel} />}
            {canWrite && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Rename project"
                  onClick={() => { setEditName(project.name); setEditing(true); }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete project"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}

      <div className="flex items-center gap-4">
        <p className="text-sm text-muted-foreground">Slug: {project.slug}</p>
        <Link href={`/dashboard/events?project_id=${id}`}>
          <Button variant="outline" size="sm">
            <ScrollText className="h-3.5 w-3.5 mr-1.5" />
            View All Events
          </Button>
        </Link>
      </div>

      {!canWrite && (
        <p className="max-w-prose text-sm text-muted-foreground">
          You can read everything in this project. Changing its settings, apps and
          keys needs project ownership — ask one of the owners below to add you.
        </p>
      )}

      <ProjectOwnersCard project={project} canWrite={canWrite} />

      <ColorSettings project={project} canWrite={canWrite} onSaved={mutate} />
      <RetentionSettings project={project} canWrite={canWrite} onSaved={mutate} />
      <IssueAlertSettings project={project} canWrite={canWrite} onSaved={mutate} />

      {newClientSecret && (
        <Card className="ring-2 ring-brand">
          <CardContent className="flex items-center gap-3 pt-6">
            <p className="text-sm">
              <span className="font-medium">New app client secret:</span>{" "}
              <code className="bg-muted px-1.5 py-0.5 text-xs">{newClientSecret}</code>
            </p>
            <CopyButton text={newClientSecret} />
            <Button variant="ghost" size="sm" onClick={() => setNewClientSecret(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Apps</h2>
        {canWrite && (
        <Dialog open={appDialogOpen} onOpenChange={(v) => { setAppDialogOpen(v); if (!v) resetAppDialog(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              New App
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New App</DialogTitle>
              <DialogDescription>
                Add an app to {project.name}.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateApp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="app-name">Name</Label>
                <Input
                  id="app-name"
                  placeholder="My App"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="app-platform">Platform</Label>
                <select
                  id="app-platform"
                  value={appPlatform}
                  onChange={(e) => setAppPlatform(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {PLATFORM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {appPlatform !== "backend" && (
                <div className="space-y-2">
                  <Label htmlFor="app-bundle-id">Bundle ID</Label>
                  <Input
                    id="app-bundle-id"
                    placeholder="com.example.myapp"
                    value={appBundleId}
                    onChange={(e) => setAppBundleId(e.target.value)}
                    required
                  />
                </div>
              )}
              {appError && <p className="text-sm text-destructive">{appError}</p>}
              <DialogFooter>
                <Button type="submit" disabled={appLoading}>
                  {appLoading ? "Creating..." : "Create App"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {project.apps.length === 0 ? (
        <p className="text-muted-foreground">No apps yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {project.apps.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              projectColor={project.color}
              canWrite={canWrite}
              onChanged={mutate}
            />
          ))}
        </div>
      )}

    </AnimatedPage>
  );
}

function RetentionSettings({
  project,
  canWrite,
  onSaved,
}: {
  project: ProjectDetailResponse;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const handleWriteFailure = useWriteFailureHandler();
  const [retentionEvents, setRetentionEvents] = useState(project.retention_days_events?.toString() ?? "");
  const [retentionMetrics, setRetentionMetrics] = useState(project.retention_days_metrics?.toString() ?? "");
  const [retentionFunnels, setRetentionFunnels] = useState(project.retention_days_funnels?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setRetentionEvents(project.retention_days_events?.toString() ?? "");
    setRetentionMetrics(project.retention_days_metrics?.toString() ?? "");
    setRetentionFunnels(project.retention_days_funnels?.toString() ?? "");
  }, [project.retention_days_events, project.retention_days_metrics, project.retention_days_funnels]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const body: Record<string, number | null> = {};
      const newEvents = retentionEvents ? parseInt(retentionEvents, 10) : null;
      const newMetrics = retentionMetrics ? parseInt(retentionMetrics, 10) : null;
      const newFunnels = retentionFunnels ? parseInt(retentionFunnels, 10) : null;
      if (newEvents !== project.retention_days_events) body.retention_days_events = newEvents;
      if (newMetrics !== project.retention_days_metrics) body.retention_days_metrics = newMetrics;
      if (newFunnels !== project.retention_days_funnels) body.retention_days_funnels = newFunnels;
      if (Object.keys(body).length === 0) { setSaving(false); setSuccess(true); setTimeout(() => setSuccess(false), 2000); return; }
      await api.patch(`/v1/projects/${project.id}`, body);
      setSuccess(true);
      onSaved();
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(await handleWriteFailure(err, "Failed to save", onSaved));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Data Retention</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="retention-events">Events (days)</Label>
              <Input
                id="retention-events"
                type="number"
                min={1}
                max={3650}
                placeholder={`${DEFAULT_RETENTION_DAYS_EVENTS} (default)`}
                value={retentionEvents}
                onChange={(e) => setRetentionEvents(e.target.value)}
                disabled={!canWrite}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retention-metrics">Metrics (days)</Label>
              <Input
                id="retention-metrics"
                type="number"
                min={1}
                max={3650}
                placeholder={`${DEFAULT_RETENTION_DAYS_METRICS} (default)`}
                value={retentionMetrics}
                onChange={(e) => setRetentionMetrics(e.target.value)}
                disabled={!canWrite}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retention-funnels">Funnels (days)</Label>
              <Input
                id="retention-funnels"
                type="number"
                min={1}
                max={3650}
                placeholder={`${DEFAULT_RETENTION_DAYS_FUNNELS} (default)`}
                value={retentionFunnels}
                onChange={(e) => setRetentionFunnels(e.target.value)}
                disabled={!canWrite}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Clear a field to reset to the default. Data older than the retention period is permanently deleted daily.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {canWrite && (
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "Saving..." : "Save Retention"}
              </Button>
              {success && <span className="text-sm text-chart-2">Saved</span>}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

const ALERT_FREQUENCY_OPTIONS = [
  { value: "none", label: "None" },
  { value: "hourly", label: "Hourly" },
  { value: "6_hourly", label: "Every 6 hours" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

function IssueAlertSettings({
  project,
  canWrite,
  onSaved,
}: {
  project: ProjectDetailResponse;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const handleWriteFailure = useWriteFailureHandler();
  const [frequency, setFrequency] = useState<string>(project.effective_issue_alert_frequency ?? "daily");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setFrequency(project.effective_issue_alert_frequency ?? "daily");
  }, [project.effective_issue_alert_frequency]);

  async function handleSave() {
    if (frequency === project.effective_issue_alert_frequency) return;
    setSaving(true);
    setError("");
    try {
      await api.patch(`/v1/projects/${project.id}`, { issue_alert_frequency: frequency });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
      onSaved();
    } catch (err) {
      setError(await handleWriteFailure(err, "Failed to save", onSaved));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Issue Alert Frequency</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Label htmlFor="alert-frequency" className="whitespace-nowrap">Digest frequency</Label>
          <select
            id="alert-frequency"
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            disabled={!canWrite}
          >
            {ALERT_FREQUENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {canWrite && (
            <>
              <Button size="sm" onClick={handleSave} disabled={saving || frequency === project.effective_issue_alert_frequency}>
                {saving ? "Saving..." : "Save"}
              </Button>
              {success && <span className="text-sm text-chart-2">Saved</span>}
            </>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Controls how often new or regressed issues batch into a notification for this project.
          Per-channel toggles (in-app, email) live on your{" "}
          <Link href="/dashboard/profile/notifications" className="underline">
            notification preferences
          </Link>{" "}
          page.
        </p>
      </CardContent>
    </Card>
  );
}

function ColorSettings({
  project,
  canWrite,
  onSaved,
}: {
  project: ProjectDetailResponse;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const handleWriteFailure = useWriteFailureHandler();
  const [color, setColor] = useState(project.color);
  const [customInput, setCustomInput] = useState(project.color);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setColor(project.color);
    setCustomInput(project.color);
  }, [project.color]);

  async function save(next: string) {
    if (!canWrite) return;
    if (!isValidProjectColor(next)) {
      setError("Enter a valid #RRGGBB hex color");
      return;
    }
    if (next.toLowerCase() === project.color.toLowerCase()) return;
    setSaving(true);
    setError("");
    try {
      await api.patch(`/v1/projects/${project.id}`, { color: next });
      setColor(next);
      setCustomInput(next);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
      onSaved();
    } catch (err) {
      setError(await handleWriteFailure(err, "Failed to save", onSaved));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Color</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {PROJECT_COLORS.map((c) => {
            const isActive = c.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={c}
                type="button"
                aria-label={c}
                disabled={saving || !canWrite}
                onClick={() => save(c)}
                className={`h-7 w-7 rounded-full border-2 transition-transform disabled:cursor-default enabled:hover:scale-110 ${
                  isActive ? "border-foreground scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor="custom-color" className="whitespace-nowrap text-xs text-muted-foreground">
            Custom hex
          </Label>
          <Input
            id="custom-color"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onBlur={() => save(customInput)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save(customInput);
              }
            }}
            placeholder="#RRGGBB"
            className="h-8 w-32 font-mono text-xs"
            disabled={saving || !canWrite}
          />
          <ProjectDot color={color} size={20} />
          {success && <span className="text-xs text-chart-2">Saved</span>}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function AppCard({
  app,
  projectColor,
  canWrite,
  onChanged,
}: {
  app: AppResponse;
  projectColor: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const handleWriteFailure = useWriteFailureHandler();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(app.name);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.patch(`/v1/apps/${app.id}`, { name });
      setEditingName(false);
      onChanged();
    } catch (err) {
      setError(await handleWriteFailure(err, "Failed to rename", onChanged));
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete app "${app.name}"?`)) return;
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/v1/apps/${app.id}`);
      onChanged();
    } catch (err) {
      setError(await handleWriteFailure(err, "Failed to delete", onChanged));
      setDeleting(false);
    }
  }

  return (
    <Card
      className="border-l-4"
      style={{ borderLeftColor: projectColor }}
    >
      <CardHeader>
        {editingName ? (
          <form onSubmit={handleRename} className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 text-sm"
              autoFocus
            />
            <Button type="submit" size="sm" variant="ghost">Save</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingName(false); setName(app.name); }}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{app.name}</CardTitle>
            {canWrite && (
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" title="Rename app" onClick={() => setEditingName(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" title="Delete app" onClick={handleDelete} disabled={deleting}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {error && <p className="text-destructive">{error}</p>}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Platform</span>
          <span>{PLATFORM_OPTIONS.find((p) => p.value === app.platform)?.label ?? app.platform}</span>
        </div>
        {app.bundle_id && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bundle ID</span>
            <span className="font-mono text-xs">{app.bundle_id}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Client Secret</span>
          {app.client_secret ? (
            <div className="flex items-center gap-1">
              <code className="bg-muted px-1.5 py-0.5 text-xs">
                {app.client_secret.slice(0, 20)}...
              </code>
              <CopyButton text={app.client_secret} />
            </div>
          ) : (
            // The API redacts a client secret the caller may not read to null.
            // Say which of the two nulls this is rather than showing an empty
            // credential: an owner is looking at an app with no client key, a
            // viewer is looking at one they are not entitled to see.
            <span className="text-xs text-muted-foreground">
              {canWrite ? "No client key" : "\u2014 not available"}
            </span>
          )}
        </div>
        <div className="flex gap-3 pt-1">
          <Link
            href={`/dashboard/users?app_id=${app.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Users className="h-3 w-3" />
            Users
          </Link>
          <Link
            href={`/dashboard/events?app_id=${app.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ScrollText className="h-3 w-3" />
            Events
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Who can change this project.
 *
 * Everyone on the team can read a project, so this card answers the question a
 * viewer actually has — "who do I ask?" — by naming the owners and their email
 * addresses for all readers. Managing the list is narrower: any owner may add
 * or remove any other, including themselves, and the team owner can step in to
 * re-own a project whose owners have all left. That recovery authority is
 * scoped to this list and confers no other write.
 *
 * The last owner is never removable. The button says so before it is pressed,
 * and the server still answers 409 if two people race each other to it.
 */
function ProjectOwnersCard({
  project,
  canWrite,
}: {
  project: ProjectDetailResponse;
  canWrite: boolean;
}) {
  const { user } = useUser();
  const { isTeamOwner } = useTeam();
  const revalidateProjectAccess = useRevalidateProjectAccess();
  const handleWriteFailure = useWriteFailureHandler();

  const canManageOwners = canWrite || isTeamOwner;

  // The roster is only needed to pick a new owner from, so viewers never fetch it.
  const { data: team } = useSWR<TeamDetailResponse>(
    canManageOwners ? `/v1/teams/${project.team_id}` : null,
  );

  const [selectedUserId, setSelectedUserId] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const owners = project.owners;
  const ownerIds = new Set(owners.map((owner) => owner.user_id));
  const candidates = (team?.members ?? []).filter((m) => !ownerIds.has(m.user_id));
  const isLastOwner = owners.length <= 1;

  async function handleAdd() {
    if (!selectedUserId) return;
    setAdding(true);
    setError("");
    try {
      await api.put(`/v1/projects/${project.id}/owners/${selectedUserId}`);
      setSelectedUserId("");
      await revalidateProjectAccess();
    } catch (err) {
      setError(await handleWriteFailure(err, "Failed to add owner"));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle className="text-base">Owners</CardTitle>
        {owners.length > 0 && <CountBadge>{owners.length}</CountBadge>}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="max-w-prose text-sm text-muted-foreground">
          Owners change this project — its settings, apps, definitions, triage and
          keys. Everyone else on the team can read it and leave comments.
        </p>

        {owners.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This project has no owners. Add one to make it editable again.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                {canManageOwners && <TableHead className="w-[100px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((owner) => (
                <TableRow key={owner.user_id}>
                  <TableCell>
                    {owner.name}
                    {owner.user_id === user?.id && (
                      <span className="ml-1 text-muted-foreground">(you)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{owner.email}</TableCell>
                  {canManageOwners && (
                    <TableCell className="text-right">
                      <RemoveOwnerButton
                        project={project}
                        ownerName={owner.name}
                        ownerUserId={owner.user_id}
                        isSelf={owner.user_id === user?.id}
                        isLastOwner={isLastOwner}
                        onRemoved={revalidateProjectAccess}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {canManageOwners && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1 space-y-1">
              <Label htmlFor="add-owner">Add an owner</Label>
              <Select
                value={selectedUserId}
                onValueChange={setSelectedUserId}
                disabled={candidates.length === 0}
              >
                <SelectTrigger id="add-owner" className="w-full">
                  <SelectValue
                    placeholder={
                      candidates.length === 0
                        ? "Everyone on the team already owns this project"
                        : "Pick a teammate"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.name} — {member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAdd} disabled={adding || !selectedUserId}>
              {adding ? "Adding..." : "Add owner"}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Removing an owner is confirmed in a dialog rather than a browser prompt, so
 * the consequence can be spelled out — including the one that catches people
 * out, that removing yourself is not something you can undo on your own.
 */
function RemoveOwnerButton({
  project,
  ownerName,
  ownerUserId,
  isSelf,
  isLastOwner,
  onRemoved,
}: {
  project: ProjectDetailResponse;
  ownerName: string;
  ownerUserId: string;
  isSelf: boolean;
  isLastOwner: boolean;
  onRemoved: () => Promise<unknown>;
}) {
  const handleWriteFailure = useWriteFailureHandler();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");

  if (isLastOwner) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        title="A project must keep at least one owner. Add someone else first."
      >
        Remove
      </Button>
    );
  }

  async function handleRemove() {
    setRemoving(true);
    setError("");
    try {
      await api.delete(`/v1/projects/${project.id}/owners/${ownerUserId}`);
      setOpen(false);
      await onRemoved();
    } catch (err) {
      // A 409 means someone else removed an owner first and this one is now the
      // last. The message is the server's; the refresh makes the card agree.
      setError(await handleWriteFailure(err, "Failed to remove owner", onRemoved));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(""); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">Remove</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isSelf ? "Remove yourself as an owner" : "Remove owner"}</DialogTitle>
          <DialogDescription>
            {isSelf
              ? `You will keep read access to ${project.name} and can still comment, but you won't be able to change anything — including adding yourself back.`
              : `${ownerName} will keep read access to ${project.name} and can still comment, but won't be able to change anything.`}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleRemove} disabled={removing}>
            {removing ? "Removing..." : "Remove owner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
