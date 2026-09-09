export function compactResults<Value>(value: Value, ids: ReadonlySet<string>): Value {
  let budget = 128 * 1024
  const visit = (item: unknown): unknown => {
    if (item == null || typeof item != 'object' || item instanceof Date) return item
    if (Array.isArray(item)) return item.toReversed().map(visit).toReversed()
    const object = item as Record<string, unknown>
    if (object.role == 'user' || object.role == 'system') return item
    const result = object.result as Record<string, unknown> | undefined
    if (object.kind == 'stored-result' && result != null && typeof result.resultId == 'string' && ids.has(result.resultId)) {
      const size = Buffer.byteLength(JSON.stringify(object))
      if (size <= budget) {
        budget -= size
        return object
      }
      const { page: _page, ...reference } = object
      return { ...reference, previewOmitted: true }
    }
    return Object.fromEntries(
      Object.entries(object)
        .toReversed()
        .map(([key, child]) => [key, key == 'args' || key == 'input' || key == 'instructions' ? child : visit(child)])
        .toReversed(),
    )
  }
  return visit(value) as Value
}
