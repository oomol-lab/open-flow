/** Capture authored properties instead of hundreds of unrelated browser defaults. */
export function captureStyleProperties(root: HTMLElement): string[] {
  const complete = () => Array.from(getComputedStyle(root)).filter((name) => !name.startsWith('--'))
  const properties = new Set(['width', 'height'])
  const add = (style: CSSStyleDeclaration): boolean => {
    for (const name of Array.from(style)) {
      if (name === 'all') return false
      if (!name.startsWith('--')) properties.add(name)
    }
    return true
  }
  const collect = (rules: CSSRuleList): boolean => {
    for (const rule of rules) {
      const style = (rule as CSSStyleRule).style
      if (style) {
        const selector = (rule as CSSStyleRule).selectorText?.replace(/::[\w-]+(?:\([^)]*\))?/g, '')
        let matches = true
        if (selector) {
          try {
            matches = root.closest(selector) != null || root.querySelector(selector) != null
          } catch {
            // Nested selectors may be relative. Retain their properties.
          }
        }
        if (matches && !add(style)) return false
      }
      if ('cssRules' in rule && !collect((rule as CSSGroupingRule).cssRules)) return false
      const imported = (rule as CSSImportRule).styleSheet
      if (imported && !collect(imported.cssRules)) return false
    }
    return true
  }
  try {
    const doc = root.ownerDocument
    for (const sheet of [...doc.styleSheets, ...doc.adoptedStyleSheets]) if (!collect(sheet.cssRules)) return complete()
  } catch {
    // Inaccessible cross-origin styles still need their resolved appearance.
    return complete()
  }
  for (let ancestor: HTMLElement | null = root; ancestor; ancestor = ancestor.parentElement) if (!add(ancestor.style)) return complete()
  for (const node of [root, ...root.querySelectorAll<HTMLElement | SVGElement>('*')]) {
    if (node.style && !add(node.style)) return complete()
    // SVG presentation attributes can reference inherited theme variables too.
    for (const attribute of node.attributes) if (CSS.supports(attribute.name, 'initial')) properties.add(attribute.name)
  }
  return [...properties].toSorted()
}
