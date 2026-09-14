import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

/** Quiet syntax colors for code embedded in property forms. */
export function warmCodeTheme(dark: boolean) {
  return [
    EditorView.theme(
      {
        '&': { color: 'var(--ui-foreground)' },
        '.cm-content': { caretColor: 'var(--ui-foreground)' },
        '.cm-cursor': { borderLeftColor: 'var(--ui-foreground)' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
          backgroundColor: dark ? '#37414b' : '#dce5ed',
        },
      },
      { dark },
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: tags.propertyName, color: dark ? '#d4d4d4' : '#434343' },
        { tag: [tags.string, tags.escape], color: dark ? '#ce9178' : '#96502e' },
        { tag: [tags.number, tags.bool, tags.null, tags.keyword], color: dark ? '#91afc5' : '#476b85' },
        { tag: [tags.punctuation, tags.comment], color: dark ? '#a0a0a0' : '#707070' },
      ]),
    ),
  ]
}
