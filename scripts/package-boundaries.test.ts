import { describe, expect, test } from "bun:test";
import { join, resolve, relative } from "path";
import { readFileSync } from "fs";
import ts from "typescript";

const root = resolve(import.meta.dir, "..");

describe("shared package boundaries", () => {
  for (const name of ["annotations", "daemon-kit", "canvas-kernel"]) {
    test(`${name} keeps relative imports inside its published package`, async () => {
      const directory = join(root, "packages", name);
      const files = ["index.ts"];
      const glob = new Bun.Glob("**/*.{ts,tsx}");
      for await (const file of glob.scan({ cwd: join(directory, "src") })) files.push(join("src", file));
      expect(files.length).toBeGreaterThan(1);
      let checkedImports = 0;
      for (const file of files) {
        if (/\.test\.tsx?$/.test(file)) continue;
        const path = join(directory, file);
        const imports = ts.preProcessFile(readFileSync(path, "utf8")).importedFiles;
        for (const imported of imports) {
          checkedImports++;
          const specifier = imported.fileName;
          if (specifier.startsWith(".")) {
            const destination = resolve(path, "..", specifier);
            expect(relative(directory, destination).startsWith("..")).toBe(false);
          }
          if (name !== "canvas-kernel") {
            expect(specifier.startsWith("#canvas/")).toBe(false);
            expect(specifier.startsWith("@fabrika/canvas-kernel")).toBe(false);
          }
          if (name === "annotations") expect(specifier.startsWith("@fabrika/daemon-kit")).toBe(false);
          if (name === "daemon-kit") {
            expect(specifier.startsWith("@fabrika/annotations")).toBe(false);
            expect(specifier.startsWith("react")).toBe(false);
          }
        }
      }
      expect(checkedImports).toBeGreaterThan(0);
    });
  }
});
