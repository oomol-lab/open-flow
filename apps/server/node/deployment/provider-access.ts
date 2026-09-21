import type { ConnectorActionMetadata, ConnectorConnection } from '@oomol-lab/open-flow/control-api'
import type { JsonValue } from '@oomol-lab/open-flow/flow-change'

import { canonicalJsonBytes, digestBytes } from '@oomol-lab/open-flow/flow-encoding'

const appRolePrefix = 'role::connector-app:'
const userPrefix = 'user::'

export interface ProviderAccessGrant {
  readonly actions?: readonly string[]
  readonly appAccessConfig?: Readonly<Record<string, JsonValue>>
}

interface PermissionRule extends ProviderAccessGrant {
  readonly id: string
  readonly name: string
}

interface PermissionRules {
  readonly assignments: Readonly<Record<string, string>>
  readonly rules: readonly PermissionRule[]
  readonly teamDefault: ProviderAccessGrant
}

interface AppAccess {
  readonly appId: string
  readonly permissionRules: PermissionRules
  readonly providerId: string
}

export interface TeamAppAccess {
  readonly policy: unknown
  readonly policyRevision?: string
}

export interface ResolvedProviderAccessBinding {
  readonly accessBindingId: string
  readonly accessGrant: ProviderAccessGrant
  readonly appId: string
  readonly connection: ConnectorConnection
  readonly policyRevision?: string
  readonly providerId: string
}

export function providerAccessAllowsAction(
  binding: { readonly accessGrant: ProviderAccessGrant; readonly providerId: string },
  action: Pick<ConnectorActionMetadata, 'actionId' | 'serviceId'>,
): boolean {
  if (action.serviceId != binding.providerId) return false
  const prefix = `${binding.providerId}.`
  const actions = binding.accessGrant.actions
  return actions == null || (action.actionId.startsWith(prefix) && actions.includes(action.actionId.slice(prefix.length)))
}

export function providerAccessAllowsProxy(binding: { readonly accessGrant: ProviderAccessGrant }): boolean {
  return binding.accessGrant.actions == null && binding.accessGrant.appAccessConfig == null
}

export async function resolveProviderAccessBinding(input: {
  readonly accessBindingId: string
  readonly connections: readonly ConnectorConnection[]
  readonly policy: unknown
  readonly policyRevision?: string
  readonly providerId: string
  readonly teamId: string
}): Promise<ResolvedProviderAccessBinding | undefined> {
  if (!isObject(input.policy)) throw new TypeError('Connector access must be an object.')
  const connections = input.connections.filter((connection) => connection.serviceId == input.providerId && connection.status == 'active')
  for (const app of parseAppAccess(input.policy, connections)) {
    const connection = connections.find((item) => item.connectionId == app.appId)!
    const grants: readonly { readonly grant: ProviderAccessGrant; readonly key: string }[] = [
      { grant: app.permissionRules.teamDefault, key: 'team-default' },
      ...app.permissionRules.rules.map((rule) => ({ grant: rule, key: rule.id })),
    ]
    for (const { grant: selected, key } of grants) {
      if ((await bindingId(input.teamId, app.appId, app.providerId, key)) != input.accessBindingId) continue
      return {
        accessBindingId: input.accessBindingId,
        accessGrant: {
          ...(selected.actions == null ? {} : { actions: selected.actions }),
          ...(selected.appAccessConfig == null ? {} : { appAccessConfig: selected.appAccessConfig }),
        },
        appId: app.appId,
        connection,
        ...(input.policyRevision == null ? {} : { policyRevision: input.policyRevision }),
        providerId: app.providerId,
      }
    }
  }
}

export async function providerAccessBindingCandidates(input: {
  readonly actorId: string
  readonly connections: readonly ConnectorConnection[]
  readonly policy: unknown
  readonly policyRevision?: string
  readonly providerId: string
  readonly teamId: string
}): Promise<
  readonly {
    readonly accessBindingId: string
    readonly connectionDisplayName: string
    readonly isDefault: boolean
    readonly permissions: {
      readonly actionIds: readonly string[]
      readonly allActions: boolean
      readonly configured: boolean
      readonly proxy: boolean
    }
    readonly permissionGroupName: string | null
    readonly policyRevision?: string
    readonly providerId: string
  }[]
> {
  if (!isObject(input.policy)) throw new TypeError('Connector access must be an object.')
  const connections = input.connections.filter((connection) => connection.serviceId == input.providerId)
  const candidates = await Promise.all(
    parseAppAccess(input.policy, connections)
      .flatMap((app) => {
        const connection = connections.find((item) => item.connectionId == app.appId)
        if (connection == null || connection.status != 'active') return []
        const assigned = app.permissionRules.assignments[input.actorId]
        const rule = assigned == null ? undefined : app.permissionRules.rules.find((item) => item.id == assigned)
        const selected = rule ?? app.permissionRules.teamDefault
        if (selected.actions?.length == 0) return []
        return [{ app, connection, grantKey: rule == null ? 'team-default' : rule.id, rule, selected }]
      })
      .map(async ({ app, connection, grantKey, rule, selected }) => {
        const candidate = {
          accessBindingId: await bindingId(input.teamId, app.appId, app.providerId, grantKey),
          connectionDisplayName: connection.displayName,
          isDefault: connection.isDefault,
          permissions: {
            actionIds: selected.actions?.map((action) => `${app.providerId}.${action}`) ?? [],
            allActions: selected.actions == null,
            configured: selected.appAccessConfig != null,
            proxy: providerAccessAllowsProxy({ accessGrant: selected }),
          },
          permissionGroupName: rule?.name ?? null,
          providerId: app.providerId,
        }
        return input.policyRevision == null ? candidate : Object.assign(candidate, { policyRevision: input.policyRevision })
      }),
  )
  return candidates.toSorted(
    (left, right) =>
      left.connectionDisplayName.localeCompare(right.connectionDisplayName) ||
      (left.permissionGroupName ?? '').localeCompare(right.permissionGroupName ?? '') ||
      left.accessBindingId.localeCompare(right.accessBindingId),
  )
}

async function bindingId(teamId: string, appId: string, providerId: string, grantKey: string): Promise<string> {
  return await digestBytes(canonicalJsonBytes(['provider-access', 1, teamId, appId, providerId, grantKey]))
}

function parseAppAccess(policy: Record<string, unknown>, connections: readonly ConnectorConnection[]): readonly AppAccess[] {
  const configured = new Map<string, unknown>()
  for (const [subject, value] of Object.entries(policy)) {
    if (subject.startsWith(appRolePrefix) && subject.length > appRolePrefix.length) configured.set(subject.slice(appRolePrefix.length), value)
  }
  return connections.map((connection) => ({
    appId: connection.connectionId,
    permissionRules: configured.has(connection.connectionId)
      ? parseRole(policy, configured.get(connection.connectionId), connection.connectionId, connection.serviceId)
      : { assignments: {}, rules: [], teamDefault: {} },
    providerId: connection.serviceId,
  }))
}

function parseRole(policy: Record<string, unknown>, value: unknown, appId: string, providerId: string): PermissionRules {
  const config = object(value, 'Connector App role')
  if (!Array.isArray(config.connector) || config.connector.length == 0) throw new TypeError('Connector App role must contain a Connector rule.')
  const rule = object(config.connector[0], 'Connector App rule')
  if ('effect' in rule) throw new TypeError('Connector App rule must not contain an effect.')
  return 'permissionRules' in rule ? parsePermissionRules(rule, providerId) : parseLegacyPermissionRules(policy, rule, appId, providerId)
}

function parsePermissionRules(rule: Record<string, unknown>, providerId: string): PermissionRules {
  onlyKeys(rule, ['app', 'method', 'permissionRules', 'provider'], 'Connector App rule')
  if (rule.method != 'POST' || rule.provider != providerId) throw new TypeError('Connector App rule does not match its Provider.')
  const value = object(rule.permissionRules, 'Connector permission rules')
  if (!('teamDefault' in value) || !Array.isArray(value.rules)) throw new TypeError('Connector permission rules are invalid.')
  onlyKeys(value, ['assignments', 'rules', 'teamDefault'], 'Connector permission rules')
  const teamDefault = grant(value.teamDefault, 'Connector team default')
  const ids = new Set<string>()
  const rules = value.rules.map((item) => {
    const source = object(item, 'Connector permission rule')
    onlyKeys(source, ['actions', 'appAccessConfig', 'id', 'name'], 'Connector permission rule')
    const id = nonEmptyString(source.id, 'Connector permission rule ID')
    const name = nonEmptyString(source.name, 'Connector permission rule name')
    if (ids.has(id)) throw new TypeError('Connector permission rule IDs must be unique.')
    ids.add(id)
    return { id, name, ...grant(source, 'Connector permission rule', ['id', 'name']) }
  })
  const assignments: Record<string, string> = {}
  if (isObject(value.assignments)) {
    for (const [actorId, ruleId] of Object.entries(value.assignments)) {
      if (actorId.trim().length > 0 && typeof ruleId == 'string' && ruleId.trim().length > 0 && ids.has(ruleId)) assignments[actorId] = ruleId
    }
  }
  return { assignments, rules, teamDefault }
}

function parseLegacyPermissionRules(policy: Record<string, unknown>, rule: Record<string, unknown>, appId: string, providerId: string): PermissionRules {
  if (!includesLegacy(rule.method, 'POST') || !includesLegacy(rule.provider, providerId)) {
    throw new TypeError('Legacy Connector App rule does not match its Provider.')
  }
  if ('requireRole' in rule && typeof rule.requireRole != 'boolean') throw new TypeError('Legacy Connector role requirement must be a boolean.')
  const parsed = grant(rule, 'Legacy Connector permission rule', ['app', 'method', 'provider', 'requireRole'])
  if (rule.requireRole !== true) return { assignments: {}, rules: [], teamDefault: parsed }
  const id = `legacy:${appId}`
  const role = `connector-app:${appId}`
  const assignments: Record<string, string> = {}
  for (const [subject, value] of Object.entries(policy)) {
    if (!subject.startsWith(userPrefix) || subject.length == userPrefix.length || !isObject(value) || !Array.isArray(value.roles)) continue
    if (value.roles.includes(role)) assignments[subject.slice(userPrefix.length)] = id
  }
  return { assignments, rules: [{ id, name: 'Selected members', ...parsed }], teamDefault: { actions: [] } }
}

function grant(value: unknown, description: string, extraKeys: readonly string[] = []): ProviderAccessGrant {
  const source = object(value, description)
  onlyKeys(source, ['actions', 'appAccessConfig', ...extraKeys], description)
  let actions: readonly string[] | undefined
  if ('actions' in source) {
    if (!Array.isArray(source.actions)) throw new TypeError(`${description} actions must be an array.`)
    const seen = new Set<string>()
    actions = source.actions
      .map((item) => {
        const action = nonEmptyString(item, `${description} action`)
        if (action == '*' || seen.has(action)) throw new TypeError(`${description} actions are invalid.`)
        seen.add(action)
        return action
      })
      .toSorted()
  }
  let appAccessConfig: Readonly<Record<string, JsonValue>> | undefined
  if ('appAccessConfig' in source) {
    if (!isJsonObject(source.appAccessConfig)) throw new TypeError(`${description} App access configuration must be a JSON object.`)
    appAccessConfig = source.appAccessConfig
  }
  return {
    ...(actions == null ? {} : { actions }),
    ...(appAccessConfig == null ? {} : { appAccessConfig }),
  }
}

function includesLegacy(value: unknown, expected: string): boolean {
  return value == expected || (Array.isArray(value) && value.includes(expected))
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], description: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new TypeError(`${description} contains unexpected fields.`)
}

function object(value: unknown, description: string): Record<string, unknown> {
  if (!isObject(value)) throw new TypeError(`${description} must be an object.`)
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value == 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown, description: string): string {
  if (typeof value != 'string' || value.trim().length == 0) throw new TypeError(`${description} must be a non-empty string.`)
  return value
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  if (!isObject(value)) return false
  return Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): value is JsonValue {
  return (
    value == null ||
    typeof value == 'boolean' ||
    typeof value == 'number' ||
    typeof value == 'string' ||
    (Array.isArray(value) ? value.every(isJsonValue) : isJsonObject(value))
  )
}
