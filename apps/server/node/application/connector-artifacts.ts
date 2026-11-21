import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorHost } from '../deployment/connector-contract.ts'
import type { ArtifactEvent, RunArtifacts } from './run-artifacts.ts'

export interface ConnectorArtifactPort {
  readonly handle: string
  readonly jsonSchema: unknown
}

export interface ArtifactRefValue {
  readonly kind: 'artifact'
  readonly id: string
  readonly name: string
  readonly mediaType?: string
  readonly size: number
  readonly digest: string
}

interface TransitFileDescriptor {
  readonly downloadUrl: string
  readonly name: string
  readonly mimeType?: string
}

function isPlainObject(value: unknown): value is Record<string, JsonValue> {
  return value != null && typeof value == 'object' && !Array.isArray(value)
}

export function isArtifactRef(value: unknown): value is ArtifactRefValue {
  if (!isPlainObject(value)) return false
  return (
    value.kind === 'artifact' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.size === 'number' &&
    typeof value.digest === 'string' &&
    (value.mediaType === undefined || typeof value.mediaType === 'string')
  )
}

function extractTransitFile(value: Record<string, JsonValue>): TransitFileDescriptor | undefined {
  // OpenConnector style: { fileId, downloadUrl, sizeBytes, name, mimeType }
  if (
    typeof value.fileId == 'string' &&
    typeof value.downloadUrl == 'string' &&
    typeof value.sizeBytes == 'number' &&
    typeof value.name == 'string' &&
    typeof value.mimeType == 'string'
  ) {
    return { downloadUrl: value.downloadUrl, name: value.name, mimeType: value.mimeType }
  }
  // Hosted Connector style A: { transitUrl, filename, mimeType, sizeBytes }
  if (typeof value.transitUrl == 'string' && typeof value.filename == 'string' && typeof value.sizeBytes == 'number') {
    return {
      downloadUrl: value.transitUrl,
      name: value.filename,
      mimeType: typeof value.mimeType == 'string' ? value.mimeType : undefined,
    }
  }
  // Hosted Connector style B: { s3url, name, mimetype, sizeBytes }
  if (typeof value.s3url == 'string' && typeof value.name == 'string' && typeof value.sizeBytes == 'number') {
    return {
      downloadUrl: value.s3url,
      name: value.name,
      mimeType: typeof value.mimetype == 'string' ? value.mimetype : undefined,
    }
  }
  return undefined
}

function schemaExpectsString(schema: unknown): boolean {
  if (!isPlainObject(schema)) return false
  if (schema.type === 'string') return true
  if (Array.isArray(schema.type) && schema.type.includes('string') && !schema.type.includes('object')) return true
  return false
}

function childPropertySchema(schema: unknown, key: string): unknown {
  if (!isPlainObject(schema)) return undefined
  const properties = isPlainObject(schema.properties) ? schema.properties : undefined
  if (properties && Object.hasOwn(properties, key)) return properties[key]
  return isPlainObject(schema.additionalProperties) ? schema.additionalProperties : undefined
}

function childArrayItemSchema(schema: unknown): unknown {
  if (!isPlainObject(schema)) return undefined
  return schema.items
}

function allowsArtifactAttachment(schema: unknown): boolean {
  if (!isPlainObject(schema)) return true
  if (schema.additionalProperties === false) {
    const properties = isPlainObject(schema.properties) ? schema.properties : undefined
    return properties != null && Object.hasOwn(properties, 'artifact')
  }
  return true
}

/**
 * Converts Open Flow `ArtifactRef` values inside Connector Action inputs into
 * Connector Transit File references (`{ fileId, name, mimeType }`) or download URLs
 * depending on the target field's JSON Schema (including nested object/array schemas).
 */
export async function prepareConnectorInputsWithArtifacts(
  ports: readonly ConnectorArtifactPort[],
  inputs: Readonly<Record<string, JsonValue>>,
  context: {
    readonly runId: string
    readonly artifacts: RunArtifacts
    readonly connector: ConnectorHost
    readonly signal: AbortSignal
  },
): Promise<Readonly<Record<string, JsonValue>>> {
  if (!context.connector.uploadTransitFile) return inputs
  const portByHandle = new Map(ports.map((port) => [port.handle, port]))
  let changed = false
  const next: Record<string, JsonValue> = {}

  const convertValue = async (value: JsonValue, schema: unknown): Promise<JsonValue> => {
    if (isArtifactRef(value)) {
      const { content } = context.artifacts.readAllBytes(context.runId, value.id)
      const uploaded = await context.connector.uploadTransitFile!({ name: value.name, mediaType: value.mediaType, content }, context.signal)
      changed = true
      if (schemaExpectsString(schema)) return uploaded.downloadUrl
      return {
        fileId: uploaded.fileId,
        name: uploaded.name,
        mimeType: uploaded.mimeType,
      }
    }
    if (Array.isArray(value)) {
      const itemSchema = childArrayItemSchema(schema)
      const items: JsonValue[] = []
      for (const item of value) items.push(await convertValue(item, itemSchema))
      return items
    }
    if (isPlainObject(value)) {
      const out: Record<string, JsonValue> = {}
      for (const [k, v] of Object.entries(value)) {
        out[k] = await convertValue(v, childPropertySchema(schema, k))
      }
      return out
    }
    return value
  }

  for (const [handle, value] of Object.entries(inputs)) {
    const port = portByHandle.get(handle)
    next[handle] = await convertValue(value, port?.jsonSchema)
  }
  return changed ? next : inputs
}

interface PendingDownload {
  readonly target: Record<string, JsonValue>
  readonly transit: TransitFileDescriptor
  readonly canAttachProperty: boolean
  downloaded?: { readonly content: Uint8Array; readonly mediaType?: string }
}

/**
 * Detects Connector Transit File objects in an Action output, downloads all bytes
 * first (so a partial failure never consumes Run Artifact quota), stores them in
 * RunArtifacts, and attaches `artifact: ArtifactRef` when the output schema allows it.
 */
export async function bridgeConnectorOutputArtifacts(
  output: JsonValue,
  context: {
    readonly runId: string
    readonly nodeId: string
    readonly jobId: string
    readonly artifacts: RunArtifacts
    readonly connector: ConnectorHost
    readonly signal: AbortSignal
    readonly outputPorts?: readonly ConnectorArtifactPort[]
    readonly emit: (event: ArtifactEvent) => Promise<void>
  },
): Promise<JsonValue> {
  if (!context.connector.downloadTransitFile) return output

  const pending: PendingDownload[] = []
  const rootSchema =
    context.outputPorts == null
      ? undefined
      : context.outputPorts.length === 1 && context.outputPorts[0]?.handle === 'output'
        ? context.outputPorts[0].jsonSchema
        : {
            type: 'object',
            properties: Object.fromEntries(context.outputPorts.map((port) => [port.handle, port.jsonSchema])),
          }

  const collect = (value: JsonValue, schema: unknown): void => {
    if (Array.isArray(value)) {
      const itemSchema = childArrayItemSchema(schema)
      for (const item of value) collect(item, itemSchema)
      return
    }
    if (!isPlainObject(value)) return
    const transit = extractTransitFile(value)
    if (transit && value.artifact === undefined) {
      pending.push({ target: value, transit, canAttachProperty: allowsArtifactAttachment(schema) })
      return
    }
    for (const [k, v] of Object.entries(value)) {
      collect(v, childPropertySchema(schema, k))
    }
  }

  collect(output, rootSchema)
  if (pending.length === 0) return output

  // Phase 1: download all bytes before persisting any Run Artifacts.
  for (const item of pending) {
    item.downloaded = await context.connector.downloadTransitFile!(item.transit.downloadUrl, context.signal)
  }

  // Phase 2: store all downloaded artifacts and map targets to refs.
  const refsByTarget = new Map<Record<string, JsonValue>, { readonly ref: JsonValue; readonly attach: boolean }>()
  for (const item of pending) {
    const ref = await context.artifacts.storeBytes(
      context.runId,
      context.nodeId,
      context.jobId,
      {
        name: item.transit.name,
        mediaType: item.transit.mimeType ?? item.downloaded!.mediaType,
        content: item.downloaded!.content,
      },
      context.emit,
    )
    refsByTarget.set(item.target, { ref: ref as unknown as JsonValue, attach: item.canAttachProperty })
  }

  const rewrite = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(rewrite)
    if (!isPlainObject(value)) return value
    const match = refsByTarget.get(value)
    if (match) return match.attach ? { ...value, artifact: match.ref } : value
    let mutated = false
    const copy: Record<string, JsonValue> = {}
    for (const [k, v] of Object.entries(value)) {
      const nextValue = rewrite(v)
      if (nextValue !== v) mutated = true
      copy[k] = nextValue
    }
    return mutated ? copy : value
  }

  return rewrite(output)
}
