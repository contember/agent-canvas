import { describe, expect, test } from "bun:test";
import type { Annotation, PlanResponse } from "./runtime";
import { canPruneResponses, generateMarkdown, pruneStaleResponses } from "./generateMarkdown";

function response(id: string, label: string): PlanResponse {
  return { id, type: "text", label, value: `${id}-answer`, required: true };
}

function annotation(snippet: string, note: string): Annotation {
  return { id: "ann-1", snippet, note, createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("generateMarkdown", () => {
  test("a region annotation says which part of the image it marks", () => {
    const md = generateMarkdown(
      [annotation("[Region:rect] /img/graph.png @1234,500,900,4000", "this axis label is wrong")],
      "",
    );
    expect(md).toContain("> [Region] /img/graph.png — rect x 12.3%-21.3%, y 5%-45% of the image");
    expect(md).toContain("this axis label is wrong");
    // The encoding is for the DOM lookup; an agent has no use for it.
    expect(md).not.toContain("@1234,500,900,4000");
  });

  test("every other annotation is still quoted exactly as it was", () => {
    const md = generateMarkdown(
      [annotation("[Item] Ship the beta", "too early"), annotation("selected wording", "reword this")],
      "",
    );
    expect(md).toContain("> [Item] Ship the beta");
    expect(md).toContain("> selected wording");
  });
});

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
