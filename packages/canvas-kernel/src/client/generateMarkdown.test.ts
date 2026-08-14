import { describe, expect, test } from "bun:test";
import type { PlanResponse } from "./runtime";
import { canPruneResponses, pruneStaleResponses } from "./generateMarkdown";

function response(id: string, label: string): PlanResponse {
  return { id, type: "text", label, value: `${id}-answer`, required: true };
}

describe("canPruneResponses", () => {
  test("holds off until every canvas of the revision has rendered", () => {
    expect(canPruneResponses(["plan.jsx", "notes.jsx"], new Set(["plan.jsx"]))).toBe(false);
    expect(canPruneResponses(["plan.jsx", "notes.jsx"], new Set(["plan.jsx", "notes.jsx"]))).toBe(true);
  });

  test("never prunes before a canvas has rendered — the overview mounts none", () => {
    expect(canPruneResponses(["plan.jsx"], new Set())).toBe(false);
  });

  test("a host that does not declare its canvases never prunes", () => {
    expect(canPruneResponses(undefined, new Set(["plan.jsx"]))).toBe(false);
    expect(canPruneResponses([], new Set(["plan.jsx"]))).toBe(false);
  });

  test("ignores canvases left over from another revision", () => {
    expect(canPruneResponses(["plan.jsx"], new Set(["plan.jsx", "dropped.jsx"]))).toBe(true);
  });
});

describe("pruneStaleResponses", () => {
  test("keeps seen controls by id and drops answers from a prior revision", () => {
    const responses = new Map<string, PlanResponse>([
      ["project-shape", response("project-shape", "Same label")],
      ["vision-note", response("vision-note", "Same label")],
      ["audiences", { ...response("audiences", "Audience"), type: "checkbox", value: ["teams"] }],
    ]);

    const visible = new Set(["vision-note", "audiences"]);
    expect([...pruneStaleResponses(responses, visible).keys()]).toEqual([
      "vision-note",
      "audiences",
    ]);
  });

  test("a rendered canvas with no controls submits no persisted answers", () => {
    const responses = new Map([["old", response("old", "Old question")]]);
    expect(pruneStaleResponses(responses, new Set()).size).toBe(0);
  });

  test("leaves the map untouched when every control has been seen", () => {
    const responses = new Map([
      ["a", response("a", "A")],
      ["b", response("b", "B")],
    ]);
    expect([...pruneStaleResponses(responses, new Set(["a", "b"])).keys()]).toEqual(["a", "b"]);
  });
});
