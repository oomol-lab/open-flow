import { feishuApplication } from './feishu.ts'

export type { EventSourceDefinition, SourceConfiguration, SourceEvent, SourceSubscription } from './definition.ts'
export { SourceIdentityError } from './definition.ts'
export { feishuApplication } from './feishu.ts'

const definitions: readonly (typeof feishuApplication)[] = [feishuApplication]

export function eventSourceDefinition(kind: string): (typeof definitions)[number] {
  const definition = definitions.find((item) => item.kind == kind)
  if (definition == null) throw new Error(`Unknown event source kind: ${kind}`)
  return definition
}
