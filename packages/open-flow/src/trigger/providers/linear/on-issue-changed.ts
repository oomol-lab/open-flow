import type { JsonValue, TriggerKeySnapshot } from '../../../flow/common/change.ts'
import type { TriggerConfigOption, TriggerConfigOptionsContext } from '../../common/configOptions.ts'
import type { PollContext, PollDefinition } from '../../common/poll.ts'

import { isJsonObject } from '../../../base/common/json.ts'
import { PermanentPollError, PollConnectionError, TransientPollError } from '../../common/poll.ts'

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
const uuid = new RegExp(uuidPattern)
const overlapMs = 60_000
const pageSize = 50
const issueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    identifier: { type: 'string' },
    title: { type: 'string' },
    url: { type: 'string' },
    teamId: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    state: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' } },
      required: ['id', 'name', 'type'],
    },
  },
  required: ['id', 'identifier', 'title', 'url', 'teamId', 'createdAt', 'updatedAt', 'state'],
} as const

const snapshot = {
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      teamId: { title: 'Team ID', description: 'Linear Team UUID. Use Copy model UUID in Linear to find it.', type: 'string', pattern: uuidPattern },
      stateIds: {
        title: 'Issue statuses',
        description: 'Choose statuses from the selected Team. Empty means all statuses. Matches the current status, not every transition into it.',
        type: 'array',
        items: { type: 'string', pattern: uuidPattern },
        uniqueItems: true,
        maxItems: 50,
        default: [],
      },
    },
    required: ['teamId'],
    title: 'Linear Issue Changes',
  },
  definitionVersion: 1,
  description:
    'Watches new and updated issues in a Linear team with periodic checks. Starts from now without running existing issues. Reports observed current states, not deletions or every intermediate status change.',
  displayName: 'Issue Created or Updated',
  key: 'linear.on_issue_changed',
  name: 'on_issue_changed',
  payloadSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { events: { type: 'array', items: issueSchema } },
    required: ['events'],
  },
  provider: 'linear',
  type: 'poll',
} as const satisfies TriggerKeySnapshot & { readonly type: 'poll' }

interface Checkpoint {
  readonly startedAt: string
  readonly since: string
  readonly until?: string
  readonly after?: string
}

export const linearIssueChanged: PollDefinition = {
  snapshot,
  configOptions: options,
  async poll(context) {
    const teamId = typeof context.config.teamId == 'string' ? context.config.teamId.toLowerCase() : context.config.teamId
    const stateIds = context.config.stateIds ?? []
    if (
      typeof teamId != 'string' ||
      !uuid.test(teamId) ||
      !Array.isArray(stateIds) ||
      stateIds.length > 50 ||
      stateIds.some((name) => typeof name != 'string' || !uuid.test(name))
    )
      throw new PermanentPollError('Linear Issue configuration is invalid.')
    if (context.checkpoint == null) {
      const data = await query(context, 'query LinearTeam($teamId: String!) { team(id: $teamId) { id } }', { teamId })
      requireTeam(data.team, teamId)
      const startedAt = context.now.toISOString()
      return { checkpoint: { startedAt, since: startedAt }, events: [] }
    }
    const checkpoint = readCheckpoint(context.checkpoint)
    const until = checkpoint.until ?? new Date(Math.max(context.now.getTime(), Date.parse(checkpoint.since))).toISOString()
    const since = new Date(Math.max(Date.parse(checkpoint.startedAt), Date.parse(checkpoint.since) - overlapMs)).toISOString()
    const data = await query(
      context,
      `query LinearIssueChanges($teamId: String!, $filter: IssueFilter!, $after: String) {
      team(id: $teamId) {
        id
        issues(first: ${pageSize}, after: $after, orderBy: updatedAt, includeArchived: true, filter: $filter) {
          nodes { id identifier title url createdAt updatedAt state { id name type } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
      {
        teamId,
        after: checkpoint.after ?? null,
        filter: { updatedAt: { gte: since, lte: until }, ...(stateIds.length == 0 ? {} : { state: { id: { in: stateIds } } }) },
      },
    )
    const team = requireTeam(data.team, teamId)
    const page = team.issues
    if (
      !isJsonObject(page) ||
      !Array.isArray(page.nodes) ||
      page.nodes.length > pageSize ||
      !isJsonObject(page.pageInfo) ||
      typeof page.pageInfo.hasNextPage != 'boolean'
    ) {
      throw new TransientPollError('Linear returned an invalid Issue page.')
    }
    const { hasNextPage, endCursor } = page.pageInfo
    if (
      hasNextPage &&
      (typeof endCursor != 'string' || endCursor.length == 0 || endCursor.length > 4096 || endCursor == checkpoint.after || page.nodes.length == 0)
    ) {
      throw new TransientPollError('Linear returned an invalid continuation cursor.')
    }
    const events = page.nodes.map((value) => {
      if (
        !isJsonObject(value) ||
        typeof value.id != 'string' ||
        !uuid.test(value.id) ||
        typeof value.identifier != 'string' ||
        value.identifier.length == 0 ||
        typeof value.title != 'string' ||
        typeof value.url != 'string' ||
        !timestamp(value.createdAt) ||
        !timestamp(value.updatedAt) ||
        Date.parse(value.createdAt) > Date.parse(value.updatedAt) ||
        Date.parse(value.updatedAt) < Date.parse(since) ||
        Date.parse(value.updatedAt) > Date.parse(until) ||
        !isJsonObject(value.state) ||
        typeof value.state.id != 'string' ||
        !uuid.test(value.state.id) ||
        typeof value.state.name != 'string' ||
        typeof value.state.type != 'string' ||
        (stateIds.length > 0 && !stateIds.includes(value.state.id))
      )
        throw new TransientPollError('Linear returned an invalid Issue.')
      return {
        dedupeKey: `${value.id}:${value.updatedAt}`,
        payload: {
          id: value.id,
          identifier: value.identifier,
          title: value.title,
          url: value.url,
          teamId,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
          state: { id: value.state.id, name: value.state.name, type: value.state.type },
        },
      }
    })
    return {
      checkpoint: hasNextPage ? { ...checkpoint, until, after: endCursor as string } : { startedAt: checkpoint.startedAt, since: until },
      events,
      hasMore: hasNextPage,
    }
  },
}

function readCheckpoint(value: JsonValue): Checkpoint {
  if (
    !isJsonObject(value) ||
    !timestamp(value.startedAt) ||
    !timestamp(value.since) ||
    Date.parse(value.since) < Date.parse(value.startedAt) ||
    (value.until != null && (!timestamp(value.until) || Date.parse(value.until) < Date.parse(value.since))) ||
    (value.after != null && (typeof value.after != 'string' || value.after.length == 0 || value.after.length > 4096 || value.until == null))
  )
    throw new PermanentPollError('Linear Issue checkpoint is invalid.')
  return {
    startedAt: value.startedAt,
    since: value.since,
    ...(typeof value.until == 'string' ? { until: value.until } : {}),
    ...(typeof value.after == 'string' ? { after: value.after } : {}),
  }
}

function timestamp(value: unknown): value is string {
  return typeof value == 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
}

function requireTeam(value: unknown, teamId: string) {
  if (value === null) throw new PermanentPollError('The Linear team is unavailable or not accessible to this Connection.')
  if (!isJsonObject(value) || value.id !== teamId) throw new TransientPollError('Linear returned an invalid Team.')
  return value
}

async function query(context: Pick<PollContext, 'connector' | 'signal'>, document: string, variables: Readonly<Record<string, JsonValue>>) {
  context.signal?.throwIfAborted()
  const result = await context.connector.execute({ endpoint: '/graphql', method: 'POST', body: { query: document, variables } }, context.signal)
  context.signal?.throwIfAborted()
  if (result.status == 401 || result.status == 403) throw new PollConnectionError('Linear Issue access requires authorization.')
  if (result.status == 429) throw new TransientPollError('Linear Issue checks were rate limited.')
  const body = result.data
  if (isJsonObject(body) && Array.isArray(body.errors) && body.errors.length > 0) {
    const codes = new Set(body.errors.flatMap((error) => (isJsonObject(error) && isJsonObject(error.extensions) ? [error.extensions.code] : [])))
    if (codes.has('UNAUTHENTICATED') || codes.has('FORBIDDEN') || codes.has('AUTHENTICATION_ERROR')) {
      throw new PollConnectionError('Linear Issue access requires authorization.')
    }
    if (codes.has('RATELIMITED')) throw new TransientPollError('Linear Issue checks were rate limited.')
    if (codes.has('GRAPHQL_VALIDATION_FAILED') || codes.has('BAD_USER_INPUT')) throw new PermanentPollError('Linear rejected the Issue query configuration.')
    throw new TransientPollError('Linear Issue query failed; progress was retained.')
  }
  if (result.status != 200 || !isJsonObject(body) || !isJsonObject(body.data) || (body.errors != null && !Array.isArray(body.errors))) {
    throw new TransientPollError(`Linear returned an invalid query response (HTTP ${result.status}).`)
  }
  return body.data
}

async function options(context: TriggerConfigOptionsContext): Promise<readonly TriggerConfigOption[]> {
  const { field, config } = context
  if (field != 'teamId' && field != 'stateIds') throw new PermanentPollError('Unknown Linear configuration field.')
  if (field == 'stateIds' && (typeof config.teamId != 'string' || !uuid.test(config.teamId))) throw new PermanentPollError('Select a Linear Team first.')
  const choices: TriggerConfigOption[] = []
  const cursors = new Set<string>()
  let after: string | null = null
  for (let page = 0; page < 10; page++) {
    const data = await query(
      context,
      field == 'teamId'
        ? 'query LinearTeams($after: String) { teams(first: 100, after: $after) { nodes { id name key } pageInfo { hasNextPage endCursor } } }'
        : 'query LinearStates($teamId: String!, $after: String) { team(id: $teamId) { id states(first: 100, after: $after) { nodes { id name color position } pageInfo { hasNextPage endCursor } } } }',
      { after, ...(field == 'teamId' ? {} : { teamId: config.teamId! }) },
    )
    const values = field == 'teamId' ? data.teams : requireTeam(data.team, String(config.teamId)).states
    if (
      !isJsonObject(values) ||
      !Array.isArray(values.nodes) ||
      values.nodes.length > 100 ||
      !isJsonObject(values.pageInfo) ||
      typeof values.pageInfo.hasNextPage != 'boolean'
    ) {
      throw new TransientPollError('Linear returned invalid configuration options.')
    }
    for (const item of values.nodes) {
      if (
        !isJsonObject(item) ||
        typeof item.id != 'string' ||
        !uuid.test(item.id) ||
        typeof item.name != 'string' ||
        item.name.length == 0 ||
        (field == 'teamId' ? typeof item.key != 'string' : typeof item.color != 'string' || !/^#[0-9a-fA-F]{6}$/.test(item.color))
      ) {
        throw new TransientPollError('Linear returned an invalid configuration option.')
      }
      choices.push({
        value: item.id,
        label: field == 'teamId' ? `${item.name} (${item.key})` : item.name,
        ...(field == 'stateIds' ? { color: String(item.color) } : {}),
      })
    }
    if (!values.pageInfo.hasNextPage) return choices
    const cursor = values.pageInfo.endCursor
    if (typeof cursor != 'string' || cursor.length == 0 || cursor.length > 4096 || cursors.has(cursor) || values.nodes.length == 0) {
      throw new TransientPollError('Linear returned an invalid options cursor.')
    }
    cursors.add(cursor)
    after = cursor
  }
  throw new PermanentPollError('The Linear options list exceeds the supported limit of 1000 entries.')
}
