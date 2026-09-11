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
import { triggerPayloadSchema } from '../../../../flow/common/schema.ts'
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

function inputSpecs(draft: Draft, triggerId: string) {
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
        if (resolved.trigger.kind == 'manual' || resolved.trigger.kind == 'cron') return []
        return [
          {
            definitions: [{ handle: 'payload', jsonSchema: triggerPayloadSchema(resolved.trigger), nullable: false }],
            nodeId,
            title: resolved.trigger.name,
          },
        ]
      }
      const definitions = Object.entries(inputPorts(resolved))
        .filter(([handle, port]) => resolved.node.inputs[handle] == null && !Object.hasOwn(port, 'value'))
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([handle, port]) =>
          Object.assign({ handle, jsonSchema: port.jsonSchema, nullable: port.nullable }, port.description == null ? {} : { description: port.description }),
        )
      return definitions.length == 0 ? [] : [{ definitions, nodeId, title: nodeTitle(resolved) }]
    })
}

function inputSignature(specs: ReturnType<typeof inputSpecs>): string {
  return JSON.stringify(
    specs.map((group) => [group.nodeId, group.definitions.map((definition) => [definition.handle, definition.jsonSchema, definition.nullable])]),
  )
}

async function inputGroups(
  specs: ReturnType<typeof inputSpecs>,
  language: ReadonlyVal<string>,
  values?: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Promise<readonly RunInputGroup[]> {
  const { FlowRunInputEditorStore } = await import('../../flowRunInputEditorStore.ts')
  return specs.map((group) => {
    const editor = new FlowRunInputEditorStore(group.definitions, language)
    if (values?.[group.nodeId] != null) editor.replaceValues(values[group.nodeId])
    return { editor, nodeId: group.nodeId, title: group.title }
  })
}

function groupValues(groups: readonly RunInputGroup[]): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  return Object.fromEntries(groups.map((group) => [group.nodeId, group.editor.values()]))
}

function runValues(groups: readonly RunInputGroup[], triggerId: string) {
  return {
    inputs: Object.fromEntries(groups.filter((group) => group.nodeId != triggerId).map((group) => [group.nodeId, group.editor.values()])) as Readonly<
      Record<string, Readonly<Record<string, JsonValue>>>
    >,
    payload: (groups.find((group) => group.nodeId == triggerId)?.editor.values().payload ?? {}) as JsonValue,
  }
}

export class RunRequestStore {
  readonly #prepareDraft: (flowId: string) => Promise<string | undefined>
  readonly #client: Client
  readonly #identity: () => string
  readonly #i18n: I18n
  readonly #lifetime = new Latest()
  readonly #requests = new Latest()
  readonly #runs: Pick<RunStore, 'follow' | 'prepareStart'>
  readonly #savedInputs = new Map<
    string,
    {
      readonly signature: string
      readonly valid: boolean
      readonly values: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    }
  >()
  readonly #setNotice: SetNotice
  readonly #state: Val<RequestState> = val(initialState)
  #attempt?: { readonly key: string; readonly signature: string }

  public readonly $: RunRequest$

  public constructor(
    client: Client,
    runs: Pick<RunStore, 'follow' | 'prepareStart'>,
    setNotice: SetNotice,
    prepareDraft: (flowId: string) => Promise<string | undefined>,
    i18n: I18n = createI18n(),
    identity: () => string = randomId,
  ) {
    this.#prepareDraft = prepareDraft
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
    this.#rememberInputs(request)
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

  public async editDraft(flow: Flow, draft: Draft, triggerId: string): Promise<RunRequestOutcome> {
    const current = this.#requests.begin()
    try {
      return await this.#request('draft', flow, draft, draft.revisionId, current, undefined, triggerId, true)
    } catch (error) {
      if (current()) this.#setNotice(errorNotice(error, this.#i18n.t))
      return 'unavailable'
    } finally {
      if (current()) this.#set({ starting: false })
    }
  }

  public inputStatus(flowId: string, draft: Draft, triggerId: string): 'missing' | 'none' | 'ready' {
    const specs = inputSpecs(draft, triggerId)
    if (specs.length == 0) return 'none'
    const saved = this.#savedInputs.get(this.#inputKey(flowId, triggerId))
    return saved?.valid == true && saved.signature == inputSignature(specs) ? 'ready' : 'missing'
  }

  public async requestLive(flow: Flow): Promise<RunRequestOutcome> {
    const current = this.#requests.begin()
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
    this.#rememberInputs(request)
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
    this.#rememberInputs(request)
    const { inputs, payload } = runValues(request.groups, request.triggerId)
    const started = await this.#start(request.source, request.flow, request.revisionId, { nodeId: request.triggerId, payload }, inputs, request.publicationId)
    if (started && this.#state.value.inputRequest === request) this.dismissInputs()
    return started
  }

  public async selectTrigger(triggerId: string): Promise<void> {
    const request = this.#state.value.inputRequest
    if (request == null || !request.triggers.some((trigger) => trigger.nodeId == triggerId)) return
    const current = this.#requests.begin()
    this.#rememberInputs(request)
    this.#set({ starting: true })
    try {
      const specs = inputSpecs(request.revision, triggerId)
      const saved = this.#savedInputs.get(this.#inputKey(request.flow.flowId, triggerId))
      const groups = await inputGroups(specs, this.#i18n.lang$, saved?.values)
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
    edit = false,
  ): Promise<RunRequestOutcome> {
    const previous = this.#state.value.inputRequest
    this.#rememberInputs(previous)
    this.#set({ inputRequest: undefined, starting: !edit, submitting: undefined })
    this.#disposeInputRequest(previous)
    const graph = revisionView(revision).graph({ kind: 'flow' })
    const triggers = Object.entries(graph?.nodes ?? {}).flatMap(([nodeId, node]) => ('inputs' in node ? [] : [{ nodeId, title: node.name }]))
    if (triggers.length == 0) {
      this.#set({ starting: false })
      this.#setNotice({ kind: 'error', message: this.#i18n.t('runInput.noTrigger') })
      return 'unavailable'
    }
    const only = triggerId == null ? triggers[0] : triggers.find((trigger) => trigger.nodeId == triggerId)
    if (triggerId != null && only == null) {
      this.#set({ starting: false })
      this.#setNotice({ kind: 'error', message: this.#i18n.t('runInput.selectTrigger') })
      return 'unavailable'
    }
    const specs = only == null ? [] : inputSpecs(revision, only.nodeId)
    const signature = inputSignature(specs)
    const saved = only == null ? undefined : this.#savedInputs.get(this.#inputKey(flow.flowId, only.nodeId))
    const groups = only == null ? [] : await inputGroups(specs, this.#i18n.lang$, saved?.values)
    if (!current()) {
      for (const group of groups) group.editor.dispose()
      return 'unavailable'
    }
    if (!edit && only != null && groups.length == 0) {
      return (await this.#start(source, flow, revisionId, { nodeId: only.nodeId, payload: {} }, {}, publicationId)) ? 'started' : 'unavailable'
    }
    if (!edit && only != null && saved?.valid == true && saved.signature == signature && groups.every((group) => group.editor.valid$.value)) {
      const values = runValues(groups, only.nodeId)
      for (const group of groups) group.editor.dispose()
      return (await this.#start(source, flow, revisionId, { nodeId: only.nodeId, payload: values.payload }, values.inputs, publicationId))
        ? 'started'
        : 'unavailable'
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
    this.#set({ starting: true, submitting: source })
    try {
      if (source == 'draft') {
        const savedRevision = await this.#prepareDraft(flow.flowId)
        if (savedRevision == null || !alive() || !current()) return false
        revisionId = savedRevision
      }
      const target = source == 'draft' ? { flowId: flow.flowId, revisionId } : { publicationId: publicationId! }
      const signature = JSON.stringify({ inputs, trigger, source, ...target })
      const attempt = this.#attempt?.signature == signature ? this.#attempt : { key: this.#identity(), signature }
      this.#attempt = attempt
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

  #inputKey(flowId: string, triggerId: string): string {
    return `${flowId}\u0000${triggerId}`
  }

  #rememberInputs(request: RunInputRequest | undefined): void {
    if (request?.triggerId == null || request.groups.length == 0) return
    this.#savedInputs.set(this.#inputKey(request.flow.flowId, request.triggerId), {
      signature: inputSignature(inputSpecs(request.revision, request.triggerId)),
      valid: request.valid.value,
      values: groupValues(request.groups),
    })
  }

  #set(patch: Partial<RequestState>): void {
    this.#state.set({ ...this.#state.value, ...patch })
  }
}
