const templatePattern = /{{\s*([^}]+?)\s*}}/g

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function highlightTemplateText(content: string, handleNames: readonly string[]): string {
  const names = new Set(handleNames)
  let result = ''
  let offset = 0
  for (const match of content.matchAll(templatePattern)) {
    const index = match.index
    result += escapeHtml(content.slice(offset, index))
    const token = escapeHtml(match[0])
    result += names.has(match[1]) ? `<mark>${token}</mark>` : token
    offset = index + match[0].length
  }
  return result + escapeHtml(content.slice(offset))
}
