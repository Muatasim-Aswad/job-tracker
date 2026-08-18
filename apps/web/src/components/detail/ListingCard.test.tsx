import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Listing } from "@job-tracker/shared/api";
import { registerPlatform } from "@job-tracker/shared/platforms";
import { dismissToast, getToasts } from "../../lib/toast";
import { ListingCard } from "./ListingCard";

// Synthetic private-board stand-ins. Real boards' registry entries live in a
// private overlay the public build/test never loads, so register the shapes this
// suite needs by hand rather than name any real board.
registerPlatform("example-board", { label: "Example Board" });
registerPlatform("untrusted-board", { label: "Untrusted Board", untrustedExactDate: true });

afterEach(() => {
  cleanup();
  // The toast store lives outside React, so it survives unmount.
  for (const t of getToasts()) dismissToast(t.id);
});

// A capture as the tracker stores it. `captured_at` matters: every relative-age
// estimate is anchored to it.
function listing(over: Partial<Listing> = {}): Listing {
  return {
    id: "l1",
    job_id: "j1",
    platform: "linkedin",
    platform_id: "4442715389",
    url: "https://www.linkedin.com/jobs/view/4442715389/",
    title: "Backend Engineer",
    company: "Sample Company",
    apply_type: null,
    closed_at: null,
    captured_at: "2026-07-03T12:00:00Z",
    updated_at: null,
    meta: {},
    ...over,
  } as Listing;
}

function show(over: Partial<Listing> = {}) {
  return render(
    <ListingCard
      listing={listing(over)}
      jobTitle="Backend Engineer"
      jobCompany="Sample Company"
      isOnly={false}
      onDelete={vi.fn()}
      onRelink={vi.fn()}
      onUpdate={vi.fn()}
    />,
  );
}

// The tooltip is portal-rendered on hover/focus/tap; open it the way a keyboard
// user would, through the wrapper that owns the focus handlers.
function tooltipOf(el: HTMLElement): string {
  fireEvent.focus(el.parentElement!);
  return screen.getByRole("tooltip").textContent ?? "";
}

describe("ListingCard — posting date", () => {
  it("renders an exact date plainly, with no approximation mark", () => {
    show({ meta: { posted_at: "2026-05-03T09:30:00Z", posted_precision: "exact" } });
    expect(screen.getByText("Posted 3 May 2026")).toBeTruthy();
  });

  // A coarse estimate must not be displayed as a precise day.
  it("degrades a month-grade estimate to a month, never an invented day", () => {
    show({
      meta: {
        posted_at: "2026-05-03T12:00:00Z",
        posted_precision: "estimated",
        posted_age: "2 months ago",
      },
    });
    expect(screen.getByText("Posted ~May 2026")).toBeTruthy();
    expect(screen.queryByText(/Posted ~3 May/)).toBeNull();
  });

  it("keeps a day for hour- and day-grade evidence", () => {
    show({
      meta: {
        posted_at: "2026-07-01T12:00:00Z",
        posted_precision: "estimated",
        posted_age: "2 days ago",
      },
    });
    expect(screen.getByText("Posted ~1 Jul 2026")).toBeTruthy();
  });

  it("degrades a year-grade estimate to a year", () => {
    show({
      meta: {
        posted_at: "2025-07-03T12:00:00Z",
        posted_precision: "estimated",
        posted_age: "1 year ago",
      },
    });
    expect(screen.getByText("Posted ~2025")).toBeTruthy();
  });

  // Raw capture evidence remains a supported fallback when posted_at is absent.
  it("resolves the date from the raw evidence when no posted_at is stored yet", () => {
    show({ meta: { posted_age: "2 months ago" } });
    expect(screen.getByText("Posted ~May 2026")).toBeTruthy();
  });

  it("says unknown rather than guessing when the page carried no date", () => {
    show({ platform: "example-board", meta: {} });
    expect(screen.getByText("Posting date unknown")).toBeTruthy();
  });

  // On an `untrustedExactDate` board, `posted_date` is the capture date wearing a
  // posting date's name. It must neither be read nor displayed.
  it("never reads or shows an untrusted board's capture-date posted_date", () => {
    show({ platform: "untrusted-board", meta: { posted_date: "2026-07-03" } });
    expect(screen.getByText("Posting date unknown")).toBeTruthy();
    expect(screen.queryByText("Posted Date")).toBeNull();
  });

  it("carries the raw evidence and the capture date in the tooltip", () => {
    show({
      meta: {
        posted_at: "2026-05-03T12:00:00Z",
        posted_precision: "estimated",
        posted_age: "2 months ago",
      },
    });
    const text = tooltipOf(screen.getByText("Posted ~May 2026"));
    expect(text).toContain("2 months ago");
    expect(text).toContain("accurate to the month");
    expect(text).toContain("3 Jul 2026");
  });

  // Relative source text is evidence, not a custom field or current value.
  it("does not render the raw relative string as a detail field", () => {
    show({ meta: { posted_age: "2 months ago" } });
    expect(screen.queryByText("2 months ago")).toBeNull();
  });
});

describe("ListingCard — labels", () => {
  it("spells the platform the way the platform does", () => {
    show();
    expect(screen.getByText("LinkedIn")).toBeTruthy();
    cleanup();
    show({ platform: "example-board" });
    expect(screen.getByText("Example Board")).toBeTruthy();
  });

  it("renders an informative apply type and drops the uninformative one", () => {
    show({ apply_type: "easy_apply" });
    expect(screen.getByText("Easy apply")).toBeTruthy();
    cleanup();
    // The posting-date line owns the only other "unknown" on the card, so pin a
    // date down first — what must vanish is the apply type.
    show({
      apply_type: "unknown",
      meta: { posted_at: "2026-05-03T09:30:00Z", posted_precision: "exact" },
    });
    expect(screen.queryByText(/unknown/i)).toBeNull();
  });

  it("renders a captured external application destination as a link", () => {
    const applyUrl = "https://jobs.example.com/backend?source=linkedin";
    show({ meta: { apply_url: applyUrl } });

    expect(screen.getByText("Apply")).toBeTruthy();
    expect(screen.getByRole("link", { name: /jobs\.example\.com/ }).getAttribute("href")).toBe(
      applyUrl,
    );
  });

  it("dates a closed listing instead of only naming the state", () => {
    show({ closed_at: "2026-07-02T08:00:00Z" });
    expect(screen.getByText("Closed 2 Jul 2026")).toBeTruthy();
  });

  it("puts the full value of a truncated detail behind a tooltip", () => {
    show({ meta: { location: "Amsterdam, North Holland, Netherlands (Hybrid)" } });
    const cell = screen.getByText("Amsterdam, North Holland, Netherlands (Hybrid)");
    expect(tooltipOf(cell)).toContain("Amsterdam, North Holland, Netherlands (Hybrid)");
  });
});

// The copy control's accessible name, and the self-contained block it copies: the
// default fixture's "Title — Company" and canonical link ahead of the given JD.
const COPY_LABEL = "Copy job description";
const copied = (description: string) =>
  `Backend Engineer — Sample Company\nhttps://www.linkedin.com/jobs/view/4442715389/\n\n${description}`;

describe("ListingCard — copy job description", () => {
  it("copies this listing's description, not some other listing's", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    show({ meta: { description: "  We are hiring a backend engineer.  " } });

    fireEvent.click(screen.getByRole("button", { name: COPY_LABEL }));
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(copied("We are hiring a backend engineer.")),
    );
    vi.unstubAllGlobals();
  });

  it("offers no copy control on a listing with no description", () => {
    show();
    expect(screen.queryByRole("button", { name: COPY_LABEL })).toBeNull();
  });

  it("confirms with a toast instead of a self-resetting icon", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    show({ meta: { description: "A description." } });

    fireEvent.click(screen.getByRole("button", { name: COPY_LABEL }));
    await vi.waitFor(() => expect(getToasts()).toHaveLength(1));
    expect(getToasts()[0].kind).toBe("info");
    vi.unstubAllGlobals();
  });

  it("says so when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
    });
    show({ meta: { description: "A description." } });

    fireEvent.click(screen.getByRole("button", { name: COPY_LABEL }));
    await vi.waitFor(() => expect(getToasts()).toHaveLength(1));
    expect(getToasts()[0].kind).toBe("error");
    expect(getToasts()[0].message).toContain("Denied");
    vi.unstubAllGlobals();
  });
});

describe("ListingCard — job description preamble", () => {
  // Scraper chrome must not consume the clamped description preview.
  it("drops the scraped heading and the repeated title from the preview", () => {
    show({
      meta: {
        description: "About the job\n\nBackend Engineer\n\nYou will own our payments platform.",
      },
    });

    expect(screen.queryByText(/About the job/)).toBeNull();
    expect(screen.getByText("You will own our payments platform.")).toBeTruthy();
  });

  it("keeps a description that begins with real prose untouched", () => {
    show({ meta: { description: "We are hiring.\n\nAbout the job\n\nDetails follow." } });
    expect(screen.getByText(/^We are hiring\./)).toBeTruthy();
  });

  // Same text in the card and on the clipboard: a copied JD that still opened with
  // a stray heading would contradict what the card shows.
  it("copies the cleaned description, not the raw one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    show({ meta: { description: "About the job\nBackend Engineer\nReal content." } });

    fireEvent.click(screen.getByRole("button", { name: COPY_LABEL }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(copied("Real content.")));
    vi.unstubAllGlobals();
  });

  // The preview is flattened to buy back the lines a JD's blank lines would eat at
  // a two-line clamp; the copy keeps the author's structure, because a JD pasted
  // elsewhere with its paragraphs run together is worse than one with a stray line.
  it("flattens the preview but never the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { container } = show({
      meta: { description: "We are hiring.\n\nRequirements\n\nFive years." },
    });

    // `textContent`, because the text queries normalise whitespace away — the very
    // difference between the preview and the stored description.
    const preview = [...container.querySelectorAll("p")].at(-1)!;
    expect(preview.textContent).toBe("We are hiring. Requirements Five years.");

    fireEvent.click(screen.getByRole("button", { name: COPY_LABEL }));
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        copied("We are hiring.\n\nRequirements\n\nFive years."),
      ),
    );
    vi.unstubAllGlobals();
  });

  it("restores the real structure behind Show more", () => {
    const { container } = show({
      meta: { description: "We are hiring.\n\nRequirements\n\nFive years." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const shown = [...container.querySelectorAll("p")].at(-1)!;
    expect(shown.textContent).toBe("We are hiring.\n\nRequirements\n\nFive years.");
  });
});
