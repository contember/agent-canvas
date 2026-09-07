import { describe, expect, test } from "bun:test";
import { renderAnnotation, type RenderableAnnotation } from "./annotationMarkdown";

function ann(over: Partial<RenderableAnnotation>): RenderableAnnotation {
  return { snippet: "snippet", note: "note", ...over };
}

describe("renderAnnotation", () => {
  test("quotes the snippet, then the note, and ends on a blank line so entries stack", () => {
    expect(renderAnnotation(ann({ snippet: "  the beta  ", note: "  too early  " })))
      .toBe("> the beta\n\ntoo early\n");
  });

  test("omits the note when there is none", () => {
    expect(renderAnnotation(ann({ snippet: "the beta", note: "   " }))).toBe("> the beta\n");
  });

  test("expands a short snippet with the words around it", () => {
    const md = renderAnnotation(ann({
      snippet: "the beta",
      context: { before: "we ship", after: "next week", hierarchy: [] },
    }));
    expect(md).toBe("> ...we ship **the beta** next week...\n\nnote\n");
  });

  test("quotes a snippet of up to three lines in full", () => {
    expect(renderAnnotation(ann({ snippet: "one\ntwo\nthree" })))
      .toBe("> one\n> two\n> three\n\nnote\n");
  });

  test("elides a longer snippet down to its first and last line", () => {
    expect(renderAnnotation(ann({ snippet: "alpha\nbeta\ngamma\ndelta" })))
      .toBe("> alpha\n> ... (4 lines)\n> delta\n\nnote\n");
  });

  test("a snippet that is an encoding says what it points at in words", () => {
    const md = renderAnnotation(ann({ snippet: "[Region:rect] /img/graph.png @1234,500,900,4000" }));
    expect(md).toContain("> [Region] /img/graph.png — rect x 12.3%-21.3%, y 5%-45% of the image");
    // The encoding is for the DOM lookup; an agent has no use for it.
    expect(md).not.toContain("@1234,500,900,4000");
  });

  test("a described snippet wins over line numbers — a region is not a run of source", () => {
    const md = renderAnnotation(ann({
      snippet: "[Region:rect] /img/g.png @1,2,3,4",
      filePath: "src/a.ts",
      context: { before: "", after: "", hierarchy: [], lineStart: 5, lineEnd: 9 },
    }));
    expect(md).toContain("> [Region] /img/g.png —");
    expect(md).not.toContain("5 |");
  });

  test("names the line a short file snippet sits on", () => {
    const md = renderAnnotation(ann({
      snippet: "foo",
      filePath: "src/a.ts",
      context: { before: "const ", after: " = 1", hierarchy: [], lineStart: 12 },
    }));
    expect(md).toBe("> L12: ...const  **foo**  = 1...\n\nnote\n");
  });

  test("numbers the lines of a file snippet of up to six lines", () => {
    const md = renderAnnotation(ann({
      snippet: "alpha\nbeta\ngamma",
      filePath: "src/a.ts",
      context: { before: "", after: "", hierarchy: [], lineStart: 3, lineEnd: 5 },
    }));
    expect(md).toBe("> 3 | alpha\n> 4 | beta\n> 5 | gamma\n\nnote\n");
  });

  test("keeps head and tail of a longer file snippet, with the real line numbers", () => {
    const snippet = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join("\n");
    const md = renderAnnotation(ann({
      snippet,
      filePath: "src/a.ts",
      context: { before: "", after: "", hierarchy: [], lineStart: 100, lineEnd: 108 },
    }));
    expect(md).toBe(
      "> 100 | line 1\n> 101 | line 2\n> 102 | line 3\n> ... (9 lines)\n"
        + "> 106 | line 7\n> 107 | line 8\n> 108 | line 9\n\nnote\n",
    );
  });

  test("a file annotation without line numbers is quoted like any other", () => {
    expect(renderAnnotation(ann({ snippet: "foo", filePath: "src/a.ts" })))
      .toBe("> foo\n\nnote\n");
  });

  test("attachments follow the note", () => {
    expect(renderAnnotation(ann({ snippet: "thing", note: "look", images: ["/u/1.png", "/u/2.png"] })))
      .toBe("> thing\n\nlook\n\n![screenshot](/u/1.png)\n![screenshot](/u/2.png)\n");
  });

  // A reviewer on a shared canvas comes back with `attachments`, not `images`.
  // Reading only one of the two fields drops their screenshot silently.
  test("renders an attachment the wire carried, not just a local image", () => {
    expect(renderAnnotation(ann({
      snippet: "thing",
      note: "look",
      attachments: [{ url: "https://share.example/blob/a", mime: "image/png" }],
    }))).toBe("> thing\n\nlook\n\n![screenshot](https://share.example/blob/a)\n");
  });

  test("renders both fields, local images first", () => {
    expect(renderAnnotation(ann({
      snippet: "thing",
      note: "look",
      images: ["/u/1.png"],
      attachments: [{ url: "https://share.example/blob/a" }],
    }))).toBe("> thing\n\nlook\n\n![screenshot](/u/1.png)\n![screenshot](https://share.example/blob/a)\n");
  });

  test("an image in both fields is emitted once", () => {
    expect(renderAnnotation(ann({
      snippet: "thing",
      note: "look",
      images: ["/u/1.png"],
      attachments: [{ url: "/u/1.png", mime: "image/png" }, { url: "/u/2.png" }],
    }))).toBe("> thing\n\nlook\n\n![screenshot](/u/1.png)\n![screenshot](/u/2.png)\n");
  });

  test("an attachment with no note or image still gets its own block", () => {
    expect(renderAnnotation(ann({
      snippet: "thing",
      note: "  ",
      attachments: [{ url: "/u/1.png" }],
    }))).toBe("> thing\n\n![screenshot](/u/1.png)\n");
  });

  // `images` is what every existing local annotation carries, so its output is
  // the byte-for-byte baseline the attachment support must not disturb.
  test("an images-only annotation renders exactly as it did before attachments", () => {
    const withImages = ann({ snippet: "thing", note: "look", images: ["/u/1.png", "/u/1.png", "/u/2.png"] });
    // Duplicates within `images` are passed through, not collapsed.
    expect(renderAnnotation(withImages))
      .toBe("> thing\n\nlook\n\n![screenshot](/u/1.png)\n![screenshot](/u/1.png)\n![screenshot](/u/2.png)\n");
    expect(renderAnnotation({ ...withImages, attachments: [] })).toBe(renderAnnotation(withImages));
    expect(renderAnnotation({ ...withImages, attachments: undefined })).toBe(renderAnnotation(withImages));
  });

  test("renders a record that is not the kernel's Annotation", () => {
    // The seam a host with its own annotation store reuses.
    expect(renderAnnotation({ snippet: "whatever it points at", note: "fix this" }))
      .toBe("> whatever it points at\n\nfix this\n");
  });
});
