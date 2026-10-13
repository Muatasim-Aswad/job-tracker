export type Workspace = "jobs" | "form-fill";

export function initialWorkspace(params: URLSearchParams, preferred: Workspace): Workspace {
  const view = params.get("view");
  if (view === "form-fill") return "form-fill";
  if (view === "jobs" || params.has("job") || (params.has("platform") && params.has("platform_id")))
    return "jobs";
  return preferred;
}
