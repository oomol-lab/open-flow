export type ProjectedRunEvent =
  | {
      readonly kind: 'node.output'
      readonly payload: Readonly<Record<string, unknown>>
      readonly value: unknown
    }
  | {
      readonly kind: 'node.artifact' | 'node.completed' | 'node.failed' | 'node.log' | 'node.progress' | 'node.started' | 'run.progress' | 'run.started'
      readonly payload: Readonly<Record<string, unknown>>
    }

const encoder = new TextEncoder()
const nodeKinds = new Set(['condition', 'connector', 'javascript', 'llm', 'subflow', 'value', 'wait'])

function object(value: unknown, description: string): Record<string, unknown> {
  if (value == null || typeof value != 'object' || Array.isArray(value)) throw new TypeError(`${description} must be an object.`)
  return value as Record<string, unknown>
}

function string(value: unknown, description: string): string {
  if (typeof value != 'string' || value.length == 0) throw new TypeError(`${description} must be a non-empty string.`)
  return value
}

function optionalString(value: unknown, description: string): string | undefined {
  return value === undefined ? undefined : string(value, description)
}

function nodeKind(value: unknown): 'condition' | 'connector' | 'javascript' | 'llm' | 'subflow' | 'value' | 'wait' | undefined {
  if (value === undefined) return
  if (!nodeKinds.has(value as string)) {
    throw new TypeError('Runtime node.started nodeKind is invalid.')
  }
  return value as 'condition' | 'connector' | 'javascript' | 'llm' | 'subflow' | 'value' | 'wait'
}

function runId(event: Record<string, unknown>): string {
  return string(event.runId, 'Runtime event runId')
}

function nodeContext(
  event: Record<string, unknown>,
  flows: ReadonlyMap<string, string>,
  platformRunId: string,
): {
  readonly executionId: Promise<string>
  readonly flowId: string
  readonly nodeId: string
  readonly rawRunId: string
} {
  const rawRunId = runId(event)
  const flowId = flows.get(rawRunId)
  if (flowId == null) throw new TypeError('Runtime node event preceded its run.started event.')
  return {
    executionId: opaqueId('execution', platformRunId, rawRunId, string(event.jobId, 'Runtime node event jobId')),
    flowId,
    nodeId: string(event.nodeId, 'Runtime node event nodeId'),
    rawRunId,
  }
}

async function opaqueId(prefix: 'execution' | 'scope', ...parts: readonly string[]): Promise<string> {
  const bytes = encoder.encode(JSON.stringify([1, prefix, ...parts]))
  const input = new Uint8Array(bytes.byteLength)
  input.set(bytes)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return `${prefix}_${[...digest]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`
}

function message(value: unknown): string {
  return string(value, 'Runtime event message')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[-_ ]?key|authorization|password|secret|token)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
}

function nodeFailureCode(value: unknown, allowed: ReadonlySet<string>): string {
  const code = string(value, 'Runtime node.failed code')
  if (!allowed.has(code)) throw new TypeError('Runtime node.failed code is invalid.')
  return code
}

function artifact(value: unknown): {
  readonly digest: string
  readonly id: string
  readonly kind: 'artifact'
  readonly mediaType?: string
  readonly name: string
  readonly size: number
} {
  const ref = object(value, 'Runtime ArtifactRef')
  const keys = Object.keys(ref)
  if (
    keys.some((key) => !['kind', 'id', 'name', 'mediaType', 'size', 'digest'].includes(key)) ||
    ref.kind != 'artifact' ||
    typeof ref.id != 'string' ||
    ref.id.length == 0 ||
    typeof ref.name != 'string' ||
    ref.name.length == 0 ||
    (ref.mediaType !== undefined && (typeof ref.mediaType != 'string' || ref.mediaType.length == 0)) ||
    typeof ref.size != 'number' ||
    !Number.isSafeInteger(ref.size) ||
    ref.size < 0 ||
    typeof ref.digest != 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(ref.digest)
  ) {
    throw new TypeError('Runtime ArtifactRef is invalid.')
  }
  return {
    digest: ref.digest,
    id: ref.id,
    kind: 'artifact',
    ...(ref.mediaType === undefined ? {} : { mediaType: ref.mediaType as string }),
    name: ref.name,
    size: ref.size,
  }
}

export function createEventProjector(platformRunId: string, nodeFailureCodes: ReadonlySet<string>): (event: unknown) => Promise<ProjectedRunEvent | undefined> {
  const flows = new Map<string, string>()
  const nodeProgressBuckets = new Map<string, number>()
  const runProgressBuckets = new Map<string, number>()
  return async (value) => {
    const event = object(value, 'Runtime event')
    const type = string(event.type, 'Runtime event type')

    if (type == 'run.started') {
      const rawRunId = runId(event)
      const flowId = string(event.flowId, 'Runtime run.started flowId')
      const knownFlow = flows.get(rawRunId)
      if (knownFlow != null && knownFlow != flowId) throw new TypeError('Runtime run identity changed its flowId.')
      flows.set(rawRunId, flowId)
      const parentRunId = event.parentRunId
      if (parentRunId !== undefined && (typeof parentRunId != 'string' || parentRunId.length == 0)) {
        throw new TypeError('Runtime run.started parentRunId must be a non-empty string when present.')
      }
      return {
        kind: 'run.started',
        payload: {
          flowId,
          ...(parentRunId === undefined ? {} : { parentScopeId: await opaqueId('scope', platformRunId, parentRunId) }),
          scopeId: await opaqueId('scope', platformRunId, rawRunId),
        },
      }
    }

    if (type == 'run.progress') {
      const rawRunId = runId(event)
      const flowId = flows.get(rawRunId)
      if (flowId == null) throw new TypeError('Runtime run.progress event preceded its run.started event.')
      if (typeof event.progress != 'number' || !Number.isFinite(event.progress) || event.progress < 0 || event.progress > 100) {
        throw new TypeError('Runtime run.progress value must be between 0 and 100.')
      }
      const bucket = Math.floor(event.progress)
      if ((runProgressBuckets.get(rawRunId) ?? -1) >= bucket) return
      runProgressBuckets.set(rawRunId, bucket)
      return {
        kind: 'run.progress',
        payload: {
          flowId,
          progress: event.progress,
          scopeId: await opaqueId('scope', platformRunId, rawRunId),
        },
      }
    }

    if (type == 'node.cache-hit' || type == 'node.preview' || type == 'run.completed' || type == 'run.failed' || type == 'run.output') {
      runId(event)
      return
    }

    if (
      type == 'node.started' ||
      type == 'node.output' ||
      type == 'node.progress' ||
      type == 'node.artifact' ||
      type == 'node.log' ||
      type == 'node.completed' ||
      type == 'node.failed'
    ) {
      const context = nodeContext(event, flows, platformRunId)
      const executionId = await context.executionId
      const payload = {
        executionId,
        flowId: context.flowId,
        nodeId: context.nodeId,
        scopeId: await opaqueId('scope', platformRunId, context.rawRunId),
      }
      switch (type) {
        case 'node.output':
          return {
            kind: type,
            payload: {
              ...payload,
              handle: string(event.handle, 'Runtime node.output handle'),
            },
            value: event.value,
          }
        case 'node.started': {
          const kind = nodeKind(event.nodeKind)
          const nodeTitle = optionalString(event.nodeTitle, 'Runtime node.started nodeTitle')
          const operation = optionalString(event.operation, 'Runtime node.started operation')
          return {
            kind: type,
            payload: {
              ...payload,
              ...(kind === undefined ? {} : { nodeKind: kind }),
              ...(nodeTitle === undefined ? {} : { nodeTitle }),
              ...(operation === undefined ? {} : { operation }),
            },
          }
        }
        case 'node.progress':
          if (typeof event.progress != 'number' || !Number.isFinite(event.progress) || event.progress < 0 || event.progress > 100) {
            throw new TypeError('Runtime node.progress value must be between 0 and 100.')
          }
          const bucket = Math.floor(event.progress)
          if ((nodeProgressBuckets.get(executionId) ?? -1) >= bucket) return
          nodeProgressBuckets.set(executionId, bucket)
          return { kind: type, payload: { ...payload, progress: event.progress } }
        case 'node.artifact':
          return { kind: type, payload: { ...payload, artifact: artifact(event.artifact) } }
        case 'node.log':
          if (!['debug', 'info', 'warn', 'error'].includes(event.level as string)) throw new TypeError('Runtime node.log level is invalid.')
          return { kind: type, payload: { ...payload, level: event.level, message: message(event.message) } }
        case 'node.completed':
          return { kind: type, payload }
        case 'node.failed':
          return { kind: type, payload: { ...payload, error: { code: nodeFailureCode(event.code, nodeFailureCodes), message: message(event.message) } } }
      }
    }

    throw new TypeError(`Runtime event type ${JSON.stringify(type)} is not supported.`)
  }
}
