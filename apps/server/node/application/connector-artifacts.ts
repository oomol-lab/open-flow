import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorHost } from '../deployment/connector-contract.ts'
import type { ArtifactEvent, RunArtifacts } from './run-artifacts.ts'

export interface ConnectorArtifactInputPort {
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

/**
 * Converts Open Flow `ArtifactRef` values inside Connector Action inputs into
 * Connector Transit File references (`{ fileId, name, mimeType }`) or download URLs
 * depending on the target port's JSON Schema.
 */
export async function prepareConnectorInputsWithArtifacts(
  ports: readonly ConnectorArtifactInputPort[],
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

  const convertValue = async (value: JsonValue, expectsString: boolean): Promise<JsonValue> => {
    if (isArtifactRef(value)) {
      const { content } = context.artifacts.readAllBytes(context.runId, value.id)
      const uploaded = await context.connector.uploadTransitFile!({ name: value.name, mediaType: value.mediaType, content }, context.signal)
      changed = true
      if (expectsString) return uploaded.downloadUrl
      return {
        fileId: uploaded.fileId,
        name: uploaded.name,
        mimeType: uploaded.mimeType,
      }
    }
    if (Array.isArray(value)) {
      const items: JsonValue[] = []
      for (const item of value) items.push(await convertValue(item, false))
      return items
    }
    if (isPlainObject(value)) {
      const out: Record<string, JsonValue> = {}
      for (const [k, v] of Object.entries(value)) {
        out[k] = await convertValue(v, false)
      }
      return out
    }
    return value
  }

  for (const [handle, value] of Object.entries(inputs)) {
    const port = portByHandle.get(handle)
    next[handle] = await convertValue(value, schemaExpectsString(port?.jsonSchema))
  }
  return changed ? next : inputs
}

/**
 * Detects Connector Transit File objects in an Action output, downloads their bytes
 * into the current Run's Artifact store, and attaches an `artifact` (`ArtifactRef`)
 * property alongside the original fields for zero-glue downstream consumption.
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
    readonly emit: (event: ArtifactEvent) => Promise<void>
  },
): Promise<JsonValue> {
  if (!context.connector.downloadTransitFile) return output

  const visit = async (value: JsonValue): Promise<JsonValue> => {
    if (Array.isArray(value)) {
      const items: JsonValue[] = []
      for (const item of value) items.push(await visit(item))
      return items
    }
    if (!isPlainObject(value)) return value

    const transit = extractTransitFile(value)
    if (transit && value.artifact === undefined) {
      const downloaded = await context.connector.downloadTransitFile!(transit.downloadUrl, context.signal)
      const ref = await context.artifacts.storeBytes(
        context.runId,
        context.nodeId,
        context.jobId,
        {
          name: transit.name,
          mediaType: transit.mimeType ?? downloaded.mediaType,
          content: downloaded.content,
        },
        context.emit,
      )
      return {
        ...value,
        artifact: ref as unknown as JsonValue,
      }
    }

    let mutated = false
    const copy: Record<string, JsonValue> = {}
    for (const [k, v] of Object.entries(value)) {
      const nextValue = await visit(v)
      if (nextValue !== v) mutated = true
      copy[k] = nextValue
    }
    return mutated ? copy : value
  }

  return visit(output)
}
