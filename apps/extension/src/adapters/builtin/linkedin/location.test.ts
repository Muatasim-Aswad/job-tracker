import { describe, expect, it } from "vitest";

import { cardLocationMeta, parseWorkplace, subtitlePlace } from "./location";

describe("cardLocationMeta", () => {
  it("splits the workplace off a card's location", () => {
    expect(cardLocationMeta(" Delft, South Holland, Netherlands (Hybrid) ")).toEqual({
      card_location: "Delft, South Holland, Netherlands",
      workplace: "Hybrid",
    });
  });

  it("omits the workplace a card does not state, so a patch cannot clear it", () => {
    expect(cardLocationMeta("Amsterdam")).toEqual({ card_location: "Amsterdam" });
  });

  it("keeps a parenthesised part that is not a workplace", () => {
    expect(cardLocationMeta("Den Bosch (NL)")).toEqual({ card_location: "Den Bosch (NL)" });
  });

  it("returns nothing for empty text", () => {
    expect(cardLocationMeta("  ")).toBeNull();
    expect(cardLocationMeta(undefined)).toBeNull();
  });
});

describe("parseWorkplace", () => {
  it("matches LinkedIn's three workplace types exactly, ignoring case", () => {
    expect(parseWorkplace(" on-site ")).toBe("On-site");
    expect(parseWorkplace("Remote")).toBe("Remote");
    expect(parseWorkplace("Remote job")).toBeNull();
  });
});

describe("subtitlePlace", () => {
  it("returns the text after the company", () => {
    expect(subtitlePlace("Quatt · Amsterdam (Hybrid)")).toBe(" Amsterdam (Hybrid)");
  });

  it("returns nothing without a separator", () => {
    expect(subtitlePlace("Quatt")).toBeNull();
    expect(subtitlePlace(undefined)).toBeNull();
  });
});
