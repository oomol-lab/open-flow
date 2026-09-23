import type { ConnectorAccessCapability, ConnectorCapability } from '../../../../flow/common/change.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { TaskPorts } from './flowChanges.ts'

import { generateTyping, typescriptOf } from '../../../../manifest/common/meta/block/generateTyping.ts'

export function codeTyping(
  ports: TaskPorts,
  capabilities: readonly ConnectorCapability[] = [],
  catalog: Readonly<Record<string, ConnectorActionView>> = {},
  providerIds: readonly string[] = [],
): string {
  const typing = generateTyping(
    'javascript',
    ports.inputs.flatMap((port) => ('handle' in port ? [{ handle: port.handle, json_schema: port.jsonSchema, nullable: port.nullable }] : [])),
    ports.outputs.flatMap((port) => ('handle' in port ? [{ handle: port.handle, json_schema: port.jsonSchema, nullable: port.nullable }] : [])),
  )
  const dynamicOptions = '{ connectionId?: string; connectionAlias?: string }'
  const permissions = capabilities.find((capability) => 'mode' in capability)
  const access = capabilities.find((capability): capability is ConnectorAccessCapability => !('action' in capability) && !('mode' in capability))
  const legacy = capabilities.filter((capability) => 'action' in capability)
  const connectionHints = [
    ...(access?.connectionHints ?? []),
    ...legacy.flatMap((declaration) => declaration.connections.map((connection) => ({ action: declaration.action, ...connection }))),
  ]
  const hintedActions =
    permissions?.mode != 'independent'
      ? [
          ...new Set([
            ...Object.keys(catalog),
            ...(access?.actionHints ?? []),
            ...connectionHints.map((hint) => hint.action),
            ...legacy.map((entry) => entry.action),
          ]),
        ]
      : permissions.actions.map((entry) => entry.action)
  const allowedProviders = new Set(providerIds)
  const declarations = hintedActions
    .filter((action) => permissions?.mode == 'independent' || allowedProviders.has(action.slice(0, action.indexOf('.'))))
    .map((action) => ({
      action,
      connectionId:
        (permissions?.mode == 'independent' ? permissions.actions.find((entry) => entry.action == action)?.connectionId : undefined) ??
        access?.connectionHints?.find((hint) => hint.action == action && hint.alias == null)?.connectionId ??
        legacy.find((declaration) => declaration.action == action)?.connectionId,
      connections: connectionHints.filter((hint) => hint.action == action),
    }))
  const fields: string[] = []
  const calls: string[] = []
  const providers = new Map<string, string[]>()
  for (const providerId of providerIds) providers.set(providerId, [])
  for (const declaration of declarations) {
    const definition = catalog[declaration.action]
    const input = definition?.inputSchema == null ? 'Record<string, unknown>' : typescriptOf(definition.inputSchema, false)
    const output = definition?.outputSchema == null ? 'unknown' : typescriptOf(definition.outputSchema, false)
    const ids = declaration.connections.map((connection) => JSON.stringify(connection.connectionId)).join(' | ') || 'never'
    const aliases = declaration.connections.flatMap((connection) => (connection.alias == null ? [] : [JSON.stringify(connection.alias)])).join(' | ') || 'never'
    const options =
      permissions?.mode == 'independent'
        ? declaration.connectionId == null
          ? '{ connectionId?: never }'
          : `{ connectionId?: ${JSON.stringify(declaration.connectionId)} }`
        : permissions?.mode == 'shared'
          ? '{ connectionId?: string }'
          : declaration.connections.length == 0
            ? dynamicOptions
            : `{ connectionId: ${ids}; connectionAlias?: never } | { connectionAlias: ${aliases}; connectionId?: never }`
    const required = declaration.connections.length > 0 && declaration.connectionId == null
    const args = required
      ? `[input: {} extends ${input} ? ${input} | undefined : ${input}, options: ${options}]`
      : `{} extends ${input} ? [input?: ${input}, options?: ${options}] : [input: ${input}, options?: ${options}]`
    const signature = `(...args: ${args}) => Promise<${output}>`
    calls.push(`(...args: [actionId: ${JSON.stringify(declaration.action)}, ...args: ${args}]): Promise<${output}>`)
    fields.push(`${JSON.stringify(declaration.action)}: ${signature}`)
    const separator = declaration.action.indexOf('.')
    const provider = declaration.action.slice(0, separator)
    const methods = providers.get(provider) ?? []
    methods.push(`${JSON.stringify(declaration.action.slice(separator + 1))}: ${signature}`)
    providers.set(provider, methods)
  }
  for (const [provider, methods] of providers)
    if (permissions == null || methods.length > 0)
      fields.push(`${JSON.stringify(provider)}: { ${[...methods, ...(permissions == null ? ['[key: string]: any'] : [])].join('; ')} }`)
  const hinted = declarations.map((declaration) => JSON.stringify(declaration.action)).join(' | ')
  const fallback =
    hinted == ''
      ? `(actionId: string, input?: Record<string, unknown>, options?: ${dynamicOptions}): Promise<unknown>`
      : `<Action extends string>(actionId: Action extends ${hinted} ? never : Action, input?: Record<string, unknown>, options?: ${dynamicOptions}): Promise<unknown>`
  fields.push(`call: { ${calls.join('; ')}${calls.length == 0 ? '' : '; '}${permissions == null ? fallback : ''} }`)
  if (permissions == null) fields.push('[key: string]: any')
  return `${typing}/** @typedef {import("@oomol-lab/open-flow").TaskContext<{ ${fields.join('; ').replaceAll('*/', '*\\/')} }>} TaskContext */\n`
}
