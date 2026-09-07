import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { FlowRunInputEditorStore } from '../../flowRunInputEditorStore.ts'
import type { WorkbenchClient, Draft, Flow, InputPortDefinition, JsonValue, Run } from '../api.ts'
import type { ResolvedNode } from '../revisionView.ts'
import type { Current } from '../stores/latest.ts'
import type { SetNotice } from '../stores/workbenchNotice.ts'
import type { RunStore } from './runStore.ts'

import { compute, derive, val } from 'value-enhancer'
import { randomId } from '../../../../control/common/random.ts'
import { portsByHandle } from '../../../../flow/common/change.ts'
import { triggerPayloadSchema } from '../../../../flow/common/semantics.ts'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { Latest } from '../stores/latest.ts'
import { errorNotice } from '../stores/workbenchNotice.ts'

interface RequestState {
  readonly inputRequest?: RunInputRequest
  readonly starting: boolean
  readonly submitting?: RunSource
}

type Client = Pick<WorkbenchClient, 'createDraftRun' | 'createLiveRun' | 'getLive' | 'getRevision'>

export interface RunRequest$ {
  readonly inputRequest: ReadonlyVal<RunInputRequest | undefined>
  readonly starting: ReadonlyVal<boolean>
  readonly submitting: ReadonlyVal<RunSource | undefined>
}

export interface RunInputGroup {
  readonly editor: FlowRunInputEditorStore
  readonly nodeId: string
  readonly title: string
}

export interface RunInputRequest {
  readonly revision: Draft
  readonly triggers: readonly { readonly nodeId: string; readonly title: string }[]
  readonly triggerId?: string
  readonly attempted: boolean
  readonly flow: Flow
  readonly groups: readonly RunInputGroup[]
  readonly publicationId?: string
  readonly revisionId: string
  readonly source: RunSource
  readonly valid: ReadonlyVal<boolean>
}

export type RunRequestOutcome = 'input' | 'started' | 'unavailable'
export type RunSource = Run['source']

const initialState: RequestState = {
  starting: false,
}

function inputPorts(node: ResolvedNode): Readonly<Record<string, InputPortDefinition>> {
  switch (node.kind) {
    case 'condition':
      return { [node.node.input.handle]: node.node.input }
    case 'subflow':
      return portsByHandle(node.definition?.inputs ?? [])
    case 'task':
      return portsByHandle(node.definition?.inputs ?? [])
    case 'value':
      return {}
    case 'wait':
      return { [node.node.input.handle]: node.node.input }
  }
}

function nodeTitle(node: ResolvedNode): string {
  if (node.node.name != null) return node.node.name
  if (node.kind == 'task' || node.kind == 'subflow') return node.definition?.name ?? node.id
  return node.id
}

async function inputGroups(draft: Draft, language: ReadonlyVal<string>, triggerId: string): Promise<readonly RunInputGroup[]> {
  const { FlowRunInputEditorStore } = await import('../../flowRunInputEditorStore.ts')
  const revision = revisionView(draft)
  const graph = revision.graph({ kind: 'flow' })
  if (graph == null) return []
  const reachable = new Set([triggerId])
  const pending = [triggerId]
  while (pending.length > 0) {
    const source = pending.pop()
    for (const edge of graph.edges) {
      if (edge.source != source || reachable.has(edge.target)) continue
      reachable.add(edge.target)
      pending.push(edge.target)
    }
  }
  return Object.entries(graph.nodes)
    .filter(([id]) => reachable.has(id))
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([nodeId, node]) => {
      const resolved = revision.resolveNode(nodeId, node)
      if (resolved.kind == 'trigger') {
        if (resolved.trigger.kind == 'manual') return []
        const editor = new FlowRunInputEditorStore([{ handle: 'payload', jsonSchema: triggerPayloadSchema(resolved.trigger), nullable: false }], language)
        editor.replaceValues({ payload: {} })
        return [{ editor, nodeId, title: resolved.trigger.name }]
      }
      const definitions = Object.entries(inputPorts(resolved))
        .filter(([handle, port]) => resolved.node.inputs[handle] == null && !Object.hasOwn(port, 'value'))
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([handle, port]) =>
          Object.assign({ handle, jsonSchema: port.jsonSchema, nullable: port.nullable }, port.description == null ? {} : { description: port.description }),
        )
      return definitions.length == 0 ? [] : [{ editor: new FlowRunInputEditorStore(definitions, language), nodeId, title: nodeTitle(resolved) }]
    })
}

export class RunRequestStore {
  readonly #client: Client
  readonly #identity: () => string
  readonly #i18n: I18n
  readonly #lifetime = new Latest()
  readonly #requests = new Latest()
  readonly #runs: Pick<RunStore, 'follow' | 'prepareStart'>
  readonly #setNotice: SetNotice
  readonly #state: Val<RequestState> = val(initialState)
  #attempt?: { readonly key: string; readonly signature: string }

  public readonly $: RunRequest$

  public constructor(
    client: Client,
    runs: Pick<RunStore, 'follow' | 'prepareStart'>,
    setNotice: SetNotice,
    i18n: I18n = createI18n(),
    identity: () => string = randomId,
  ) {
    this.#client = client
    this.#runs = runs
    this.#setNotice = setNotice
    this.#i18n = i18n
    this.#identity = identity
    this.$ = {
      inputRequest: derive(this.#state, (state) => state.inputRequest),
      starting: derive(this.#state, (state) => state.starting),
      submitting: derive(this.#state, (state) => state.submitting),
    }
  }

  public dispose(): void {
    this.#lifetime.invalidate()
    this.#requests.invalidate()
    this.#disposeInputRequest()
    for (const value of Object.values(this.$)) value.dispose()
    this.#state.dispose()
  }

  public reset(): void {
    this.#lifetime.invalidate()
    this.#requests.invalidate()
    this.#attempt = undefined
    const request = this.#state.value.inputRequest
    this.#state.set(initialState)
    this.#disposeInputRequest(request)
  }

  public async requestDraft(flow: Flow, draft: Draft, triggerId?: string): Promise<RunRequestOutcome> {
    const current = this.#requests.begin()
    try {
      return await this.#request('draft', flow, draft, draft.revisionId, current, undefined, triggerId)
    } catch (error) {
      if (current()) this.#setNotice(errorNotice(error, this.#i18n.t))
      return 'unavailable'
    } finally {
      if (current()) this.#set({ starting: false })
    }
  }

  public async requestLive(flow: Flow): Promise<RunRequestOutcome> {
    const current = this.#requests.begin()
    this.#setNotice(undefined)
    this.#set({ starting: true })
    try {
      const live = await this.#client.getLive(flow.flowId)
      const publication = live.publication
      if (publication == null) return 'unavailable'
      const revision = await this.#client.getRevision(flow.flowId, publication.revisionId)
      if (!current()) return 'unavailable'
      return await this.#request('live', flow, revision, publication.revisionId, current, publication.publicationId)
    } catch (error) {
      if (current()) this.#setNotice(errorNotice(error, this.#i18n.t))
      return 'unavailable'
    } finally {
      if (current()) this.#set({ starting: false })
    }
  }

  public dismissInputs(): void {
    const request = this.#state.value.inputRequest
    this.#set({ inputRequest: undefined })
    this.#disposeInputRequest(request)
  }

  public async confirmInputs(): Promise<boolean> {
    const request = this.#state.value.inputRequest
    if (request == null || request.triggerId == null) return false
    if (!request.valid.value) {
      this.#set({ inputRequest: { ...request, attempted: true } })
      return false
    }
    const inputs = Object.fromEntries(
      request.groups.filter((group) => group.nodeId != request.triggerId).map((group) => [group.nodeId, group.editor.values()]),
    ) as Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
    const payload = (request.groups.find((group) => group.nodeId == request.triggerId)?.editor.values().payload ?? {}) as JsonValue
    const started = await this.#start(request.source, request.flow, request.revisionId, { nodeId: request.triggerId, payload }, inputs, request.publicationId)
    if (started && this.#state.value.inputRequest === request) this.dismissInputs()
    return started
  }

  public async selectTrigger(triggerId: string): Promise<void> {
    const request = this.#state.value.inputRequest
    if (request == null || !request.triggers.some((trigger) => trigger.nodeId == triggerId)) return
    const current = this.#requests.begin()
    this.#set({ starting: true })
    try {
      const groups = await inputGroups(request.revision, this.#i18n.lang$, triggerId)
      if (!current() || this.#state.value.inputRequest !== request) {
        for (const group of groups) group.editor.dispose()
        return
      }
      const valid = compute((get) => groups.every((group) => get(group.editor.valid$)))
      this.#set({ inputRequest: { ...request, attempted: false, groups, triggerId, valid } })
      this.#disposeInputRequest(request)
    } catch (error) {
      if (current()) this.#setNotice(errorNotice(error, this.#i18n.t))
    } finally {
      if (current()) this.#set({ starting: false })
    }
  }

  async #request(
    source: RunSource,
    flow: Flow,
    revision: Draft,
    revisionId: string,
    current: Current,
    publicationId?: string,
    triggerId?: string,
  ): Promise<RunRequestOutcome> {
    const previous = this.#state.value.inputRequest
    this.#set({ inputRequest: undefined, starting: true, submitting: undefined })
    this.#disposeInputRequest(previous)
    const graph = revisionView(revision).graph({ kind: 'flow' })
    const triggers = Object.entries(graph?.nodes ?? {}).flatMap(([nodeId, node]) => ('inputs' in node ? [] : [{ nodeId, title: node.name }]))
    if (triggers.length == 0) {
      this.#set({ starting: false })
      this.#setNotice({ kind: 'error', message: this.#i18n.t('runInput.noTrigger') })
      return 'unavailable'
    }
    const only = triggerId == null ? (triggers.length == 1 ? triggers[0] : undefined) : triggers.find((trigger) => trigger.nodeId == triggerId)
    if (triggerId != null && only == null) {
      this.#set({ starting: false })
      this.#setNotice({ kind: 'error', message: this.#i18n.t('runInput.selectTrigger') })
      return 'unavailable'
    }
    const groups = only == null ? [] : await inputGroups(revision, this.#i18n.lang$, only.nodeId)
    if (!current()) {
      for (const group of groups) group.editor.dispose()
      return 'unavailable'
    }
    if (only != null && graph?.nodes[only.nodeId]?.kind == 'manual' && groups.length == 0) {
      return (await this.#start(source, flow, revisionId, { nodeId: only.nodeId, payload: {} }, {}, publicationId)) ? 'started' : 'unavailable'
    }
    const valid = compute((get) => only != null && groups.every((group) => get(group.editor.valid$)))
    this.#set({
      inputRequest: {
        attempted: false,
        flow,
        groups,
        revision,
        triggers,
        triggerId: only?.nodeId,
        ...(publicationId == null ? {} : { publicationId }),
        revisionId,
        source,
        valid,
      },
      starting: false,
      submitting: undefined,
    })
    return 'input'
  }

  async #start(
    source: RunSource,
    flow: Flow,
    revisionId: string,
    trigger: { readonly nodeId: string; readonly payload: JsonValue },
    inputs: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = {},
    publicationId?: string,
  ): Promise<boolean> {
    if (source == 'live' && publicationId == null) return false
    const alive = this.#lifetime.capture()
    const current = this.#runs.prepareStart()
    this.#setNotice(undefined)
    this.#set({ starting: true, submitting: source })
    const target = source == 'draft' ? { flowId: flow.flowId, revisionId } : { publicationId: publicationId! }
    const signature = JSON.stringify({ inputs, trigger, source, ...target })
    const attempt = this.#attempt?.signature == signature ? this.#attempt : { key: this.#identity(), signature }
    this.#attempt = attempt
    try {
      const run =
        source == 'draft'
          ? await this.#client.createDraftRun(flow.flowId, revisionId, { idempotencyKey: attempt.key, inputs, trigger })
          : await this.#client.createLiveRun(publicationId!, { idempotencyKey: attempt.key, inputs, trigger })
      if (!alive() || !current()) return false
      this.#attempt = undefined
      return this.#runs.follow(run, current)
    } catch (error) {
      if (alive() && current()) this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    } finally {
      if (alive()) this.#set({ starting: false, submitting: undefined })
    }
  }

  #disposeInputRequest(request: RunInputRequest | undefined = this.#state.value.inputRequest): void {
    if (request == null) return
    request.valid.dispose()
    for (const group of request.groups) group.editor.dispose()
  }

  #set(patch: Partial<RequestState>): void {
    this.#state.set({ ...this.#state.value, ...patch })
  }
}
