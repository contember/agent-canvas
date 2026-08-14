import { describe, expect, test } from "bun:test";
import type { PlanResponse } from "./runtime";
import { pruneStaleResponses } from "./generateMarkdown";

function response(id: string, label: string): PlanResponse {
  return { id, type: "text", label, value: `${id}-answer`, required: true };
}

describe("pruneStaleResponses", () => {
  test("keeps mounted controls by id and drops answers from a prior revision", () => {
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

  test("a canvas with no controls submits no persisted answers", () => {
    const responses = new Map([["old", response("old", "Old question")]]);
    expect(pruneStaleResponses(responses, new Set()).size).toBe(0);
  });

  test("leaves the map untouched when every control is mounted", () => {
    const responses = new Map([
      ["a", response("a", "A")],
      ["b", response("b", "B")],
    ]);
    expect([...pruneStaleResponses(responses, new Set(["a", "b"])).keys()]).toEqual(["a", "b"]);
  });
});
