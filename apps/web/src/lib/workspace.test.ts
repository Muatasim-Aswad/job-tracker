import { describe, expect, it } from "vitest";
import { initialWorkspace } from "./workspace";

describe("initial workspace", () => {
  it.each(["job=opaque", "platform=linkedin&platform_id=opaque", "view=jobs"])(
    "opens a Jobs link despite the remembered Form Fill workspace: %s",
    (query) => expect(initialWorkspace(new URLSearchParams(query), "form-fill")).toBe("jobs"),
  );

  it("honors an explicit Form Fill link", () => {
    expect(initialWorkspace(new URLSearchParams("view=form-fill&question=opaque"), "jobs")).toBe(
      "form-fill",
    );
  });

  it.each(["jobs", "form-fill"] as const)("restores %s for an unaddressed visit", (view) => {
    expect(initialWorkspace(new URLSearchParams(), view)).toBe(view);
  });
});
