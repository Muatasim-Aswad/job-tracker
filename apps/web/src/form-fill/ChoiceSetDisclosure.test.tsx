import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChoiceSetDisclosure } from "./ChoiceSetDisclosure";

afterEach(cleanup);

describe("ChoiceSetDisclosure", () => {
  it("keeps five choices inline", () => {
    const { container } = render(
      <ChoiceSetDisclosure count={5} summary="Five choices">
        <button>Choice control</button>
      </ChoiceSetDisclosure>,
    );

    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByRole("button", { name: "Choice control" })).toBeTruthy();
  });

  it("collapses more than five choices and mounts them only when expanded", async () => {
    const { container } = render(
      <ChoiceSetDisclosure count={6} summary="Six choices">
        <button>Choice control</button>
      </ChoiceSetDisclosure>,
    );

    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(screen.queryByRole("button", { name: "Choice control" })).toBeNull();

    fireEvent.click(screen.getByText("Six choices"));
    await waitFor(() => {
      expect(details.open).toBe(true);
      expect(screen.getByRole("button", { name: "Choice control" })).toBeTruthy();
    });
  });

  it("stays open when a sixth choice is added inline", async () => {
    const { container, rerender } = render(
      <ChoiceSetDisclosure count={5} summary="Five choices">
        <button>Choice control</button>
      </ChoiceSetDisclosure>,
    );

    rerender(
      <ChoiceSetDisclosure count={6} summary="Six choices">
        <button>Choice control</button>
      </ChoiceSetDisclosure>,
    );

    await waitFor(() => {
      expect(container.querySelector("details")?.open).toBe(true);
      expect(screen.getByRole("button", { name: "Choice control" })).toBeTruthy();
    });
  });
});
