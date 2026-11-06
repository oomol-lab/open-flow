# Dependency patches

`html-to-image@1.11.13.patch` keeps SVG descendants in the normal computed-style
cloning path. The published version copies SVG subtrees directly, losing external
styles and resolved theme variables on paths, gradients and arrow markers. This
preserves the behavior of 1.11.11 while enabling computed-property selection.
It also keeps explicit property selections local to each capture instead of caching
the first selection globally across subsequent exports.

The upstream [clone implementation](https://github.com/bubkoo/html-to-image/blob/master/src/clone-node.ts)
also walks SVG descendants. Remove the patch when a published version includes that
behavior and passes the SVG capture regression and package rendering checks.
