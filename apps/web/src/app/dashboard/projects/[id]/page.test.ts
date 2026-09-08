import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import ProjectDetailPage from "./page";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  post: vi.fn(),
  mutate: vi.fn(),
  handleWriteFailure: vi.fn(async () => "Failed to create app"),
}));

// Shallow rendering keeps this regression dependency-free. Child components
// remain React elements; only the page's own hooks and API boundary are mocked.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; }];
  },
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "project-id" }),
  usePathname: () => "/dashboard/projects/project-id",
  useRouter: () => ({}),
}));
vi.mock("@/contexts/breadcrumb-context", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));
vi.mock("@/hooks/use-project", () => ({
  useProject: () => ({
    project: { id: "project-id", name: "Project", apps: [] },
    canWrite: true,
    accessLevel: "owner",
    mutate: state.mutate,
  }),
  useWriteFailureHandler: () => state.handleWriteFailure,
}));
vi.mock("@/lib/api", () => ({ api: { post: state.post } }));

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

function elements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Element["props"]>(child)) return [];
    return [child, ...elements(child.props.children)];
  });
}

function render() {
  state.cursor = 0;
  const tree = elements(ProjectDetailPage());
  const form = tree.find((element) => element.type === "form")!;
  return { tree, form, fields: elements(form.props.children) };
}

function change(id: string, value: string) {
  const field = render().fields.find((element) => element.props.id === id)!;
  (field.props.onChange as (event: unknown) => void)({ target: { value } });
}

beforeEach(() => {
  state.values = [];
  vi.clearAllMocks();
});

describe("app creation", () => {
  it("displays the flat response key, closes the dialog and refreshes after one submission", async () => {
    let resolve!: (value: unknown) => void;
    state.post.mockReturnValue(new Promise((done) => { resolve = done; }));
    const dialog = render().tree.find((element) => "open" in element.props)!;
    (dialog.props.onOpenChange as (open: boolean) => void)(true);
    expect(render().tree.find((element) => "open" in element.props)?.props.open).toBe(true);
    change("app-name", "Browser app");
    change("app-platform", "web");
    change("app-allowed-origins", "https://app.example.com");
    const preventDefault = vi.fn();
    const pending = (render().form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(state.post).toHaveBeenCalledExactlyOnceWith("/v1/apps", {
      name: "Browser app", platform: "web", project_id: "project-id",
      allowed_origins: ["https://app.example.com"],
    });
    expect(render().fields.find((element) => element.props.type === "submit")?.props.disabled).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();

    resolve({ id: "new-app-id", client_secret: "test-created-client-key" });
    await pending;
    const { tree, fields } = render();
    expect(tree.find((element) => element.type === "code")?.props.children).toBe("test-created-client-key");
    expect(tree.some((element) => element.props.text === "test-created-client-key")).toBe(true);
    expect(tree.find((element) => "open" in element.props)?.props.open).toBe(false);
    expect(fields.find((element) => element.props.id === "app-name")?.props.value).toBe("");
    expect(fields.find((element) => element.props.type === "submit")?.props.disabled).toBe(false);
    expect(state.mutate).toHaveBeenCalledOnce();
    expect(state.post).toHaveBeenCalledOnce();
    expect(state.handleWriteFailure).not.toHaveBeenCalled();
  });

  it("shows a failed request without a success key or refresh and permits retry", async () => {
    const error = new Error("Request failed");
    state.post.mockRejectedValue(error);
    await (render().form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn() });
    const { tree, fields } = render();
    expect(tree.some((element) => element.props.children === "Failed to create app")).toBe(true);
    expect(tree.some((element) => element.type === "code")).toBe(false);
    expect(fields.find((element) => element.props.type === "submit")?.props.disabled).toBe(false);
    expect(state.handleWriteFailure).toHaveBeenCalledWith(error, "Failed to create app", state.mutate);
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
