import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { STATUS_ACCENT, STATUS_LABEL } from "@job-tracker/shared/funnel";
import type { Status } from "@job-tracker/shared/funnel";
import { StatusBadge } from "./StatusBadge";

afterEach(cleanup);

describe("StatusBadge", () => {
  it("renders the human label, not the raw status", () => {
    render(<StatusBadge status="in_process" />);
    expect(screen.getByText("In process")).toBeTruthy();
  });

  it("tints every status from its own accent — no status is white-on-white", () => {
    for (const status of Object.keys(STATUS_LABEL) as Status[]) {
      const { container } = render(<StatusBadge status={status} />);
      const cls = container.querySelector("span")!.className;
      expect(cls).toContain(STATUS_ACCENT[status].bg);
      expect(cls).toContain(STATUS_ACCENT[status].text);
      cleanup();
    }
  });

  it("gives terminal statuses distinct fills instead of one hardcoded red", () => {
    const fills = ["withdrawn", "closed", "rejected", "ghosted"].map(
      (s) => STATUS_ACCENT[s as Status].bg,
    );
    expect(new Set(fills).size).toBeGreaterThan(1);
    render(<StatusBadge status="withdrawn" />);
    expect(screen.getByText("Withdrawn").className).not.toContain("bg-red-");
  });

  it("falls back to a neutral badge for a status outside the funnel", () => {
    render(<StatusBadge status="untracked" />);
    const el = screen.getByText("untracked");
    expect(el.className).toContain("bg-slate-500/15");
  });

  it("changes only density between sizes", () => {
    const { container: sm } = render(<StatusBadge status="applied" size="sm" />);
    const smCls = sm.querySelector("span")!.className;
    cleanup();
    const { container: md } = render(<StatusBadge status="applied" size="md" />);
    const mdCls = md.querySelector("span")!.className;
    expect(smCls).toContain("text-micro");
    expect(mdCls).toContain("text-xs");
    expect(mdCls).toContain(STATUS_ACCENT.applied.bg);
  });
});
