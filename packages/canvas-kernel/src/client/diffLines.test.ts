import { describe, expect, test } from "bun:test";
import { buildDiffLines, computeLCS } from "./diffLines";

const render = (before: string, after: string) =>
  buildDiffLines(before, after).map((d) =>
    `${d.type === "removed" ? "-" : d.type === "added" ? "+" : " "}${d.line}`,
  );

describe("computeLCS", () => {
  test("returns the longest common subsequence, not just a common prefix", () => {
    expect(computeLCS(["a", "b", "c", "d"], ["a", "x", "c", "y", "d"])).toEqual(["a", "c", "d"]);
  });

  test("is empty when nothing lines up", () => {
    expect(computeLCS(["a"], ["b"])).toEqual([]);
  });

  test("handles either side being empty", () => {
    expect(computeLCS([], ["a"])).toEqual([]);
    expect(computeLCS(["a"], [])).toEqual([]);
  });
});

describe("buildDiffLines", () => {
  test("marks an edited line as a removal followed by an addition", () => {
    expect(render("one\ntwo\nthree", "one\n2\nthree")).toEqual([
      " one",
      "-two",
      "+2",
      " three",
    ]);
  });

  test("consumes every line of both sides", () => {
    expect(render("a\nb", "a\nb\nc")).toEqual([" a", " b", "+c"]);
    expect(render("a\nb\nc", "a\nc")).toEqual([" a", "-b", " c"]);
  });

  test("identical texts produce no changes", () => {
    expect(render("a\nb", "a\nb")).toEqual([" a", " b"]);
  });

  test("a replaced text reports every old line then every new one", () => {
    expect(render("a\nb", "x\ny")).toEqual(["-a", "-b", "+x", "+y"]);
  });
});
