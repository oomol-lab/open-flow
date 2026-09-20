import type { TriggerDisplay } from '../../../../control/common/triggerCatalog.ts'
import type { GraphNode, Group, InputPort, Port, TriggerNode } from '../../../../flow/common/change.ts'
import type { InputSourceCandidate } from '../../../../flow/common/graph.ts'

function withDescriptions<Value extends InputPort | Port>(
  fields: readonly (Value | Group)[],
  descriptions: Readonly<Record<string, string>> | undefined,
): readonly (Value | Group)[] {
  if (descriptions == null) return fields
  return fields.map((field) => {
    if (!('handle' in field)) return field
    const description = descriptions[field.handle]
    return description == null || description == field.description ? field : Object.assign({}, field, { description })
  })
}

/** Adds localized Provider configuration copy without changing graph-owned definitions. */
export function presentProviderTriggerConfig(inputs: readonly (InputPort | Group)[], display?: TriggerDisplay): readonly (InputPort | Group)[] {
  return withDescriptions(inputs, display?.configInputs)
}

/** Adds localized Provider output copy without changing graph-owned definitions. */
export function presentProviderTriggerOutputs(trigger: TriggerNode, display?: TriggerDisplay): readonly Port[] {
  if (trigger.kind != 'integration' && trigger.kind != 'poll') return []
  return withDescriptions(trigger.definition.outputs, display?.outputs) as readonly Port[]
}

/** Applies localized Provider output copy to source candidates without changing graph-owned data. */
export function presentProviderSourceCandidates(
  node: GraphNode,
  candidates: readonly InputSourceCandidate[],
  display?: TriggerDisplay,
): readonly InputSourceCandidate[] {
  if ((node.kind != 'integration' && node.kind != 'poll') || display == null) return candidates
  return candidates.map((candidate) => {
    const description = display.outputs[candidate.output]
    return description == null || description == candidate.description ? candidate : Object.assign({}, candidate, { description })
  })
}

/** Returns localized Provider output copy when available, otherwise preserving graph-owned copy. */
export function presentProviderOutputDescription(
  node: GraphNode,
  output: string,
  description: string | undefined,
  display?: TriggerDisplay,
): string | undefined {
  if (node.kind != 'integration' && node.kind != 'poll') return description
  return display?.outputs[output] ?? description
}
