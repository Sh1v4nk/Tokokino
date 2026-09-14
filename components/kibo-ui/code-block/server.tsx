import bash from "@shikijs/langs/bash"
import json from "@shikijs/langs/json"
import gruvboxLightHard from "@shikijs/themes/gruvbox-light-hard"
import vesper from "@shikijs/themes/vesper"
import {
  transformerNotationDiff,
  transformerNotationErrorLevel,
  transformerNotationFocus,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers"
import type { HTMLAttributes } from "react"
import { createHighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

// Shiki's default Oniguruma engine instantiates WASM lazily, which Cloudflare
// Workers reject inside a request handler. The JavaScript RegExp engine is the
// only one that runs there, and it needs a fine-grained bundle: every language
// and theme below has to be imported explicitly.
const LANGS = { bash, json } as const
const THEMES = {
  "gruvbox-light-hard": gruvboxLightHard,
  vesper,
} as const

export type CodeBlockLanguage = keyof typeof LANGS
export type CodeBlockTheme = keyof typeof THEMES

const highlighter = createHighlighterCore({
  langs: Object.values(LANGS),
  themes: Object.values(THEMES),
  engine: createJavaScriptRegexEngine({ forgiving: true }),
})

export type CodeBlockContentProps = HTMLAttributes<HTMLDivElement> & {
  themes?: { light: CodeBlockTheme; dark: CodeBlockTheme }
  language?: CodeBlockLanguage
  children: string
  syntaxHighlighting?: boolean
}

export const CodeBlockContent = async ({
  children,
  themes,
  language,
  syntaxHighlighting = true,
  ...props
}: CodeBlockContentProps) => {
  const html = syntaxHighlighting
    ? (await highlighter).codeToHtml(children, {
        lang: language ?? "bash",
        themes: themes ?? {
          light: "gruvbox-light-hard",
          dark: "vesper",
        },
        transformers: [
          transformerNotationDiff({
            matchAlgorithm: "v3",
          }),
          transformerNotationHighlight({
            matchAlgorithm: "v3",
          }),
          transformerNotationWordHighlight({
            matchAlgorithm: "v3",
          }),
          transformerNotationFocus({
            matchAlgorithm: "v3",
          }),
          transformerNotationErrorLevel({
            matchAlgorithm: "v3",
          }),
        ],
      })
    : children

  return (
    <div
      // biome-ignore lint/security/noDangerouslySetInnerHtml: "Kinda how Shiki works"
      dangerouslySetInnerHTML={{ __html: html }}
      {...props}
    />
  )
}
