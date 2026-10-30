import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { RuntimeCapabilityCall, RuntimeCapabilityResponse } from '@oomol-lab/open-flow/runtime-contract'
import type { RunStore, StoredArtifact } from '../storage/run-store.ts'

import { createHash, randomUUID } from 'node:crypto'

export interface ArtifactLimits {
  readonly maxArtifactBytes: number
  readonly maxRunBytes: number
}

export const artifactLimits: ArtifactLimits = {
  maxArtifactBytes: 10 * 1024 * 1024,
  maxRunBytes: 100 * 1024 * 1024,
}

const chunkBytes = 512 * 1024
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export class ArtifactHostError extends Error {
  readonly catchable = false
  readonly code: 'capability.denied' | 'capability.invalid' | 'runtime.limit-exceeded'
  readonly retryable = false

  constructor(code: ArtifactHostError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'ArtifactHostError'
  }
}

export type ArtifactEvent = {
  readonly artifact: StoredArtifact & { readonly kind: 'artifact' }
  readonly jobId: string
  readonly nodeId: string
  readonly runId: string
  readonly type: 'node.artifact'
}

interface Upload {
  readonly invocationId: string
  readonly jobId: string
  readonly parts: Buffer[]
  readonly runId: string
  bytes: number
}

/** Owns the `artifact.*` Capability for Code Tasks; uploads are in memory and scoped to one Task invocation. */
export class RunArtifacts {
  readonly #limits: ArtifactLimits
  readonly #runs: RunStore
  readonly #uploads = new Map<string, Upload>()

  constructor(runs: RunStore, limits: ArtifactLimits = artifactLimits) {
    this.#runs = runs
    this.#limits = limits
  }

  invoke(
    runId: string,
    call: RuntimeCapabilityCall,
    emit: (event: ArtifactEvent) => Promise<void>,
  ): Promise<RuntimeCapabilityResponse> | RuntimeCapabilityResponse {
    if (call.nodeId == null || call.jobId == null) throw new ArtifactHostError('capability.denied', 'Artifacts require a Code node invocation.')
    if (call.payload == null || typeof call.payload != 'object' || Array.isArray(call.payload))
      throw new ArtifactHostError('capability.invalid', 'The Artifact request is invalid.')
    const payload = call.payload as Readonly<Record<string, JsonValue>>
    switch (call.kind) {
      case 'artifact.write': {
        const upload = this.#upload(runId, call, payload.upload)
        this.#append(upload, payload.data)
        return { body: { upload: upload.id }, status: 200 }
      }
      case 'artifact.put':
        return this.#put(runId, call, payload, emit)
      case 'artifact.read':
        return this.#read(runId, payload)
      default:
        throw new ArtifactHostError('capability.denied', 'The Runtime Capability is not declared for this Task.')
    }
  }

  /** Discards unfinished uploads of a finished node execution, or of the whole Run when `jobId` is omitted. */
  discard(runId: string, jobId?: string): void {
    for (const [id, upload] of this.#uploads) if (upload.runId == runId && (jobId == null || upload.jobId == jobId)) this.#uploads.delete(id)
  }

  #upload(runId: string, call: RuntimeCapabilityCall, id: JsonValue | undefined): Upload & { readonly id: string } {
    if (id === undefined) {
      const created = { bytes: 0, invocationId: call.invocationId, jobId: call.jobId!, parts: [], runId }
      const uploadId = randomUUID()
      this.#uploads.set(uploadId, created)
      return Object.assign(created, { id: uploadId })
    }
    const upload = typeof id == 'string' ? this.#uploads.get(id) : undefined
    if (upload == null || upload.runId != runId || upload.invocationId != call.invocationId)
      throw new ArtifactHostError('capability.invalid', 'The Artifact upload is unavailable.')
    return Object.assign(upload, { id: id as string })
  }

  #append(upload: Upload, data: JsonValue | undefined): void {
    if (typeof data != 'string' || !base64.test(data)) throw new ArtifactHostError('capability.invalid', 'Artifact content must be base64.')
    const part = Buffer.from(data, 'base64')
    if (part.length > chunkBytes) throw new ArtifactHostError('capability.invalid', 'Artifact chunks must not exceed 512 KiB.')
    upload.bytes += part.length
    if (upload.bytes > this.#limits.maxArtifactBytes) throw new ArtifactHostError('runtime.limit-exceeded', 'Artifact exceeds the configured size limit.')
    // Unfinished uploads are retained in memory, so they count toward the Run limit before they are stored.
    let pending = 0
    for (const other of this.#uploads.values()) if (other.runId == upload.runId && other !== upload) pending += other.bytes
    if (this.#runs.artifactBytes(upload.runId) + pending + upload.bytes > this.#limits.maxRunBytes)
      throw new ArtifactHostError('runtime.limit-exceeded', 'Run Artifacts exceed the configured size limit.')
    upload.parts.push(part)
  }

  async #put(
    runId: string,
    call: RuntimeCapabilityCall,
    payload: Readonly<Record<string, JsonValue>>,
    emit: (event: ArtifactEvent) => Promise<void>,
  ): Promise<RuntimeCapabilityResponse> {
    const { mediaType, name } = payload
    if (
      typeof name != 'string' ||
      name.length == 0 ||
      name.length > 255 ||
      (mediaType !== undefined && (typeof mediaType != 'string' || mediaType.length > 255))
    )
      throw new ArtifactHostError('capability.invalid', 'Artifact name and mediaType are invalid.')
    const upload = this.#upload(runId, call, payload.upload)
    this.#uploads.delete(upload.id)
    this.#append(upload, payload.data)
    const content = Buffer.concat(upload.parts)
    const artifact: StoredArtifact = {
      digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
      id: randomUUID(),
      ...(mediaType === undefined ? {} : { mediaType }),
      name,
      size: content.length,
    }
    this.#runs.putArtifact(runId, artifact, content)
    const ref = { kind: 'artifact' as const, ...artifact }
    await emit({ artifact: ref, jobId: call.jobId!, nodeId: call.nodeId!, runId, type: 'node.artifact' })
    return { body: ref, status: 200 }
  }

  #read(runId: string, payload: Readonly<Record<string, JsonValue>>): RuntimeCapabilityResponse {
    const { id, offset } = payload
    if (typeof id != 'string' || typeof offset != 'number' || !Number.isSafeInteger(offset) || offset < 0)
      throw new ArtifactHostError('capability.invalid', 'The Artifact read request is invalid.')
    const artifact = this.#runs.readArtifact(runId, id, offset, chunkBytes)
    if (artifact == null) throw new ArtifactHostError('capability.denied', 'The Artifact is not available in this Run.')
    if (offset > artifact.size) throw new ArtifactHostError('capability.invalid', 'The Artifact read offset is out of range.')
    return { body: { data: Buffer.from(artifact.content).toString('base64'), size: artifact.size }, status: 200 }
  }
}
