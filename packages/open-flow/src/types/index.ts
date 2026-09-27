export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface PortDefinition {
  readonly description?: string
  readonly jsonSchema: JsonValue
  readonly nullable: boolean
}

export interface Port extends PortDefinition {
  readonly handle: string
}

export interface PreviousNode {
  readonly id: string
  readonly name: string
  readonly outputs: Readonly<Record<string, JsonValue>>
  readonly outputDefs: readonly Port[]
}

export interface ArtifactRef {
  readonly kind: 'artifact'
  readonly id: string
  readonly name: string
  readonly mediaType: string | undefined
  readonly size: number
  readonly digest: string
}

export interface ArtifactPutOptions {
  readonly name: string
  readonly mediaType?: string | undefined
}

export type ArtifactData = Uint8Array | Blob | ReadableStream<Uint8Array>

export interface ArtifactCapability {
  put(data: ArtifactData, options: ArtifactPutOptions): Promise<ArtifactRef>
  open(ref: ArtifactRef): Promise<ReadableStream<Uint8Array>>
}

export interface MediaPreviewPayload {
  readonly type: 'video' | 'audio' | 'markdown' | 'iframe' | 'html'
  readonly data: string
}

export interface TextPreviewPayload {
  readonly type: 'json' | 'text' | `text/${string}`
  readonly data: unknown
}

export interface ImagePreviewPayload {
  readonly type: 'image'
  readonly data: string | readonly string[]
}

export interface TablePreviewData {
  readonly columns: readonly (string | number)[]
  readonly rows: readonly (readonly (string | number | boolean)[])[]
  readonly row_count?: number
}

export interface TablePreviewPayload {
  readonly type: 'table'
  readonly data: TablePreviewData | string
}

export interface CsvPreviewPayload {
  readonly type: 'csv'
  readonly data: string
}

export type PreviewPayload = MediaPreviewPayload | TextPreviewPayload | ImagePreviewPayload | TablePreviewPayload | CsvPreviewPayload
export type PreviewType = PreviewPayload['type']

export interface TaskLogger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

export interface TaskContext<Actions extends object = Record<string, never>> {
  readonly actions: Actions
  readonly signal: AbortSignal
  readonly flowId: string
  readonly inputs: Readonly<Record<string, unknown>>
  readonly runId: string
  readonly blockId: string
  readonly artifact: ArtifactCapability
  readonly fetch: typeof fetch
  readonly logger: TaskLogger
  /** Reads the node that triggered this invocation, or null for a graph root. */
  getPrevious(): Promise<PreviousNode | null>
  preview(payload: PreviewPayload, id?: string): Promise<void>
  reportProgress(progress: number): Promise<void>
}

export type TaskResult<Outputs extends object> = keyof Outputs extends never ? Outputs | void : Outputs

export interface Task<
  Inputs extends object = Record<string, unknown>,
  Outputs extends object = Record<string, unknown>,
  Actions extends object = Record<string, never>,
> {
  (inputs: Inputs, context: TaskContext<Actions>): TaskResult<Outputs> | Promise<TaskResult<Outputs>>
}
