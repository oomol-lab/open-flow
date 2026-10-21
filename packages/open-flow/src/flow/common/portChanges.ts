import type { InputMapping } from './change.ts'

export function renamedPort(
  previous: readonly ({ readonly handle: string } | { readonly group: string })[],
  next: readonly ({ readonly handle: string } | { readonly group: string })[],
): readonly [oldName: string, newName: string] | undefined {
  const previousNames = new Set(previous.flatMap((port) => ('handle' in port ? [port.handle] : [])))
  const nextNames = new Set(next.flatMap((port) => ('handle' in port ? [port.handle] : [])))
  const removed = [...previousNames].filter((name) => !nextNames.has(name))
  const added = [...nextNames].filter((name) => !previousNames.has(name))
  return removed.length == 1 && added.length == 1 ? [removed[0]!, added[0]!] : undefined
}

export function renameOutputMapping(mapping: InputMapping, nodeIds: ReadonlySet<string>, rename: readonly [string, string] | undefined): InputMapping {
  if (rename == null || mapping.kind != 'sources') return mapping
  const sources = mapping.sources.map((source) =>
    source.kind == 'node' && !source.system && nodeIds.has(source.nodeId) && source.output == rename[0] ? { ...source, output: rename[1] } : source,
  )
  return sources.every((source, index) => source === mapping.sources[index]) ? mapping : { kind: 'sources', sources }
}

/** Carry saved mappings through a field rename and remove only fields absent from the new contract. */
export function remapInputMappings(
  mappings: Readonly<Record<string, InputMapping>>,
  ports: readonly ({ readonly handle: string } | { readonly group: string })[],
  rename: readonly [string, string] | undefined,
): Record<string, InputMapping> {
  const inputs = { ...mappings }
  if (rename != null && Object.hasOwn(inputs, rename[0])) {
    Object.defineProperty(inputs, rename[1], { value: inputs[rename[0]], enumerable: true, configurable: true, writable: true })
    delete inputs[rename[0]]
  }
  const names = new Set(ports.flatMap((port) => ('handle' in port ? [port.handle] : [])))
  for (const name of Object.keys(inputs)) if (!names.has(name)) delete inputs[name]
  return inputs
}
