import type { ConnectorProxyRequest, ConnectorProxyResult } from '../../../connector/common/proxy.ts'
import type { JsonValue, TriggerKeySnapshot } from '../../../flow/common/change.ts'
import type { IntegrationDefinition, IntegrationReconcileContext, IntegrationStateContext } from '../../common/integration.ts'

import { IntegrationConnectionError, PermanentIntegrationError, TransientIntegrationError } from '../../common/integration.ts'
import { sameSecret } from '../signature.ts'

interface Config {
  readonly events: readonly string[]
  readonly insecureSsl: boolean
  readonly project: string
  readonly pushBranchFilter: string
}

const events = [
  'push',
  'tag_push',
  'issues',
  'confidential_issues',
  'note',
  'confidential_note',
  'merge_requests',
  'job',
  'pipeline',
  'wiki_page',
  'deployment',
  'feature_flag',
  'releases',
  'milestone',
  'emoji',
  'resource_access_token',
  'resource_deploy_token',
] as const
const eventNames = new Map([
  ['Push Hook', 'push'],
  ['Tag Push Hook', 'tag_push'],
  ['Issue Hook', 'issues'],
  ['Confidential Issue Hook', 'confidential_issues'],
  ['Note Hook', 'note'],
  ['Confidential Note Hook', 'confidential_note'],
  ['Merge Request Hook', 'merge_requests'],
  ['Job Hook', 'job'],
  ['Pipeline Hook', 'pipeline'],
  ['Wiki Page Hook', 'wiki_page'],
  ['Deployment Hook', 'deployment'],
  ['Feature Flag Hook', 'feature_flag'],
  ['Release Hook', 'releases'],
  ['Milestone Hook', 'milestone'],
  ['Emoji Hook', 'emoji'],
  ['Resource Access Token Hook', 'resource_access_token'],
  ['Resource Deploy Token Hook', 'resource_deploy_token'],
])

const snapshot = {
  configSchema: {
    additionalProperties: false,
    properties: {
      events: { items: { enum: events, type: 'string' }, minItems: 1, type: 'array', uniqueItems: true },
      insecureSsl: { default: false, type: 'boolean' },
      project: {
        maxLength: 255,
        minLength: 1,
        pattern: '^(?:[0-9]+|(?!\\.{1,2}(?:/|$))[A-Za-z0-9_.][A-Za-z0-9_.-]*(?:/(?!\\.{1,2}(?:/|$))[A-Za-z0-9_.][A-Za-z0-9_.-]*)*)$',
        type: 'string',
      },
      pushBranchFilter: { default: '', maxLength: 255, type: 'string' },
    },
    required: ['project', 'events'],
    title: 'GitLab Project Event Config',
    type: 'object',
  },
  definitionVersion: 2,
  description: 'Triggers when selected GitLab webhook events occur in a project.',
  displayName: 'Project Event',
  endpoint: { body: { allowArray: false, allowEmpty: false, formats: ['json'] }, methods: ['POST'], successStatus: 202 },
  key: 'gitlab.on_project_event',
  name: 'on_project_event',
  payloadSchema: {
    additionalProperties: false,
    properties: {
      body: { type: 'object' },
      deliveryId: { type: 'string' },
      event: { type: 'string' },
      gitlabEvent: { type: 'string' },
    },
    required: ['event', 'gitlabEvent', 'deliveryId', 'body'],
    title: 'GitLab Project Event Payload',
    type: 'object',
  },
  provider: 'gitlab',
  type: 'integration',
} as const satisfies TriggerKeySnapshot & { readonly type: 'integration' }

export const gitlabProjectEvent: IntegrationDefinition = {
  initialState: { checkpoint: null, subscription: {} },
  snapshot,
  receive(context) {
    if (!sameSecret(context.header('x-gitlab-token'), context.callbackSecret)) {
      return { body: '', contentType: 'text/plain', outcome: 'respond', status: 404 }
    }
    const gitlabEvent = context.header('x-gitlab-event')?.trim()
    if (!gitlabEvent) return { outcome: 'ignored', reason: 'GitLab event header is missing.' }
    const event = eventNames.get(gitlabEvent)
    if (event == null) return { outcome: 'ignored', reason: 'GitLab event header is unknown.' }
    if (!resolveConfig(context.config).events.includes(event)) return { outcome: 'ignored', reason: 'GitLab event is not subscribed.' }
    const deliveryId = context.header('idempotency-key') ?? ''
    return {
      dedupeKey: deliveryId.length == 0 ? undefined : deliveryId,
      outcome: 'event',
      payload: { body: context.payload as Readonly<Record<string, JsonValue>>, deliveryId, event, gitlabEvent },
    }
  },
  async reconcile(context) {
    const state = requireState(context.state)
    const config = resolveConfig(context.config)
    const known = subscriptionId(state)
    if (!context.active) {
      const ids = known == null ? await findByUrl(context, config) : [known]
      for (const id of ids ?? []) await remove(context, config, id)
      await state.saveSubscription({}, later(context.now))
      return { outcome: 'ready' }
    }

    const matches = await findByUrl(context, config)
    if (matches == null) throw new PermanentIntegrationError('The GitLab project does not exist or is not visible.')
    let hookId = known ?? matches[0]
    if (hookId == null) {
      const created = await request(context, 'hook create', {
        body: desired(context.endpointUrl, context.callbackSecret, config),
        endpoint: endpoint(config),
        method: 'POST',
      })
      success(created, 'hook create')
      hookId = readId(created.data)
    } else {
      const aligned = await request(context, 'hook update', {
        body: desired(context.endpointUrl, context.callbackSecret, config),
        endpoint: `${endpoint(config)}/${hookId}`,
        method: 'PUT',
      })
      if (aligned.status == 404) {
        await state.saveSubscription({}, context.now)
        return { outcome: 'pending' }
      }
      success(aligned, 'hook update')
    }
    for (const duplicate of matches.filter((value) => value != hookId)) await remove(context, config, duplicate)
    await state.saveSubscription({ hookId }, later(context.now))
    return { outcome: 'ready' }
  },
}

function resolveConfig(value: Readonly<Record<string, JsonValue>>): Config {
  return {
    events: value.events as readonly string[],
    insecureSsl: (value.insecureSsl as boolean | undefined) ?? false,
    project: value.project as string,
    pushBranchFilter: (value.pushBranchFilter as string | undefined) ?? '',
  }
}

function endpoint(config: Config): string {
  return `/projects/${encodeURIComponent(config.project)}/hooks`
}

function desired(url: string, token: string, config: Config): Readonly<Record<string, JsonValue>> {
  return {
    branch_filter_strategy: 'wildcard',
    description: 'Managed by Open Flow.',
    enable_ssl_verification: !config.insecureSsl,
    name: `Open Flow ${url.slice(url.lastIndexOf('/') + 1)}`,
    push_events_branch_filter: config.pushBranchFilter,
    url,
    token,
    ...Object.fromEntries(events.map((event) => [`${event}_events`, config.events.includes(event)])),
  }
}

async function findByUrl(context: IntegrationReconcileContext, config: Config): Promise<readonly string[] | null> {
  const matches: string[] = []
  for (let page = 1; page <= 10; page += 1) {
    const result = await request(context, 'hook list', { endpoint: endpoint(config), method: 'GET', query: { page, per_page: 100 } })
    if (result.status == 404) return null
    success(result, 'hook list')
    const hooks = Array.isArray(result.data) ? result.data : []
    for (const hook of hooks) {
      const value = record(hook)
      if (value?.url === context.endpointUrl && (typeof value.id == 'number' || typeof value.id == 'string')) matches.push(String(value.id))
    }
    if (hooks.length < 100) break
  }
  return matches
}

async function remove(context: IntegrationReconcileContext, config: Config, hookId: string): Promise<void> {
  const result = await request(context, 'hook delete', { endpoint: `${endpoint(config)}/${hookId}`, method: 'DELETE' })
  if (result.status != 404) success(result, 'hook delete')
}

async function request(context: IntegrationReconcileContext, operation: string, value: ConnectorProxyRequest): Promise<ConnectorProxyResult> {
  try {
    return await context.connector.execute(value, context.signal)
  } catch (cause) {
    if (cause instanceof IntegrationConnectionError) throw cause
    throw new TransientIntegrationError(`GitLab ${operation} request failed.`, { cause })
  }
}

function success(result: ConnectorProxyResult, operation: string): void {
  if (result.status >= 200 && result.status < 300) return
  if (result.status == 401 || result.status == 403) throw new IntegrationConnectionError(`GitLab ${operation} rejected the Connection.`)
  if ([400, 404, 422].includes(result.status)) throw new PermanentIntegrationError(`GitLab ${operation} rejected the subscription.`)
  throw new TransientIntegrationError(`GitLab ${operation} failed with status ${result.status}.`)
}

function readId(data: unknown): string {
  const value = record(data)?.id
  if (typeof value != 'number' && typeof value != 'string') throw new TransientIntegrationError('GitLab hook response is missing its ID.')
  return String(value)
}

function requireState(value: IntegrationStateContext | undefined): IntegrationStateContext {
  if (value == null) throw new PermanentIntegrationError('GitLab Integration state is missing.')
  return value
}

function subscriptionId(state: IntegrationStateContext): string | null {
  const value = state.subscription.hookId
  return typeof value == 'string' && value.length > 0 ? value : null
}

function later(now: Date): Date {
  return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
