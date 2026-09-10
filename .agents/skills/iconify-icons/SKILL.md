---
name: iconify-icons
description: Search local Iconify JSON and use UnoCSS icon classes in the Open Flow repository. Use when adding, replacing, or choosing UI icons in this project.
---

# Iconify icons for Open Flow

This project installs the full `@iconify/json` package and uses UnoCSS for UI icons.
Search the installed JSON files and use an existing icon. Do not draw custom SVGs,
write SVG paths, construct CSS icons, or generate icon images. Existing custom icons
are not a precedent for adding new ones.

## Search local data

Paths below are relative to the repository root. The full collection data lives in
`packages/open-flow/node_modules/@iconify/json/json/<collection>.json`, with collection
information in `packages/open-flow/node_modules/@iconify/json/collections.json`.
Use the installed data as the source of truth; no HTTP API or browser is needed.

Search JSON keys in `icons` and `aliases`, rather than dumping SVG bodies into context.
For example, run from `packages/open-flow`:

```sh
bun -e '
const data = await Bun.file("node_modules/@iconify/json/json/lucide.json").json();
for (const name of [...Object.keys(data.icons), ...Object.keys(data.aliases ?? {})]) {
  if (/flow|connection|minimap/i.test(name)) console.log(`i-${data.prefix}:${name}`);
}
'
```

Prefer Lucide for new or replaced UI icons, using its rounded outlines and consistent
stroke weight. Search other installed collections only when Lucide has no suitable
icon or the user specifies another collection. Keep icons within the same control
group visually consistent in stroke weight, proportions, and apparent size; nearby
legacy icons do not override the Lucide preference. Try related English keywords
when an exact search is sparse.
Read only the selected candidates and their alias parents for SVG inspection; use
`@iconify/utils` to resolve aliases when rendering previews locally. Compare stroke
weight, proportions, and appearance at the intended size, not just icon names.
Choose verification using the [repository verification principles](../../../AGENTS.md#verification).

## Use through UnoCSS

Use the collection prefix and exact icon key to form a complete class:

```tsx
<i aria-hidden="true" className="i-lucide:workflow" />
```

Write the complete class literally in source so UnoCSS can discover it. Do not
assemble it from fragments at runtime. Keep accessible names on icon-only buttons.

`packages/open-flow/src/build/node/designerUnoConfig.ts` configures UnoCSS to resolve
collections from the owning workspace. The full package supports other collections
without adding individual `@iconify-json/*` packages or registering each collection.
Check the source scanning configuration when using icons in a new source location.
Do not import the full icon catalog into browser code or add runtime network loading
for these static UI icons; UnoCSS emits CSS for the icons used by the source.

If dependencies are missing, install the repository dependencies. If no suitable icon
exists after related searches, explain the gap rather than silently drawing one.
Follow the repository checks when changing UI or build code.
