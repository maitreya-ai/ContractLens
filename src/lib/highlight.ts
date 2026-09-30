import type { HighlighterGeneric } from "shiki";

type Highlighter = HighlighterGeneric<string, string>;

const globalForShiki = globalThis as unknown as { __contractlensShiki?: Promise<Highlighter> };

function highlighter(): Promise<Highlighter> {
  globalForShiki.__contractlensShiki ??= import("shiki").then(({ createHighlighter }) =>
    createHighlighter({ themes: ["github-light", "github-dark"], langs: ["solidity", "markdown"] }),
  ) as Promise<Highlighter>;
  return globalForShiki.__contractlensShiki;
}

/** Returns HTML where every line is `<span class="line" data-line="N">`. Colours come from CSS variables for light/dark. */
export async function highlightFile(content: string, language: string): Promise<string> {
  const hl = await highlighter();
  const lang = language === "solidity" ? "solidity" : language === "markdown" ? "markdown" : "text";
  return hl.codeToHtml(content, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
    transformers: [
      {
        line(node, line) {
          node.properties["data-line"] = line;
        },
      },
    ],
  });
}
