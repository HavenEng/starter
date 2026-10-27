import { describe, it, expect } from "vitest";
import { selectSeeds, type Seed } from "./registry";
describe("seed selection", () => {
  it("orders dependencies once and rejects missing names or cycles before execution", () => {
    const run = async () => {};
    const registry: Seed[] = [
      { name: "child", dependencies: ["parent"], run },
      { name: "parent", run },
    ];
    expect(selectSeeds(registry).map((seed) => seed.name)).toEqual([
      "parent",
      "child",
    ]);
    expect(() => selectSeeds(registry, ["missing"])).toThrow("Unknown seed");
    expect(() =>
      selectSeeds([{ name: "loop", dependencies: ["loop"], run }]),
    ).toThrow("cycle");
  });
});
