import type { Graph, JsonValue } from '../../flow/common/change.ts'

import { z } from 'zod'
import { isTriggerNode } from '../../flow/common/change.ts'

export interface DependenciesCheckpoint {
  nextId: number
  iterations: Record<string, number>
  nodes: Record<string, DependencyState>
}

interface DependencyState {
  id: number
  status: 'pending' | 'running' | 'completed' | 'skipped'
  input: Record<
    string,
    { readonly execution: number; readonly outputs: Readonly<Record<string, JsonValue>>; readonly systemOutputs?: Readonly<Record<string, JsonValue>> }
  >
  systemOutputs?: Readonly<Record<string, JsonValue>>
  output?: Readonly<Record<string, JsonValue>>
  previous: string[]
  released: string[]
  jobId?: string
  seeded: boolean
}

const outputsSchema = z.record(z.string(), z.json() as z.ZodType<JsonValue>)
const inputSchema = z.record(
  z.string(),
  z.strictObject({ execution: z.number().int().nonnegative(), outputs: outputsSchema, systemOutputs: outputsSchema.optional() }),
)
type InputSnapshot = DependenciesCheckpoint['nodes'][string]['input']
type InputFrame =
  | { values: InputSnapshot }
  | { values?: InputSnapshot; source: string; result: InputSnapshot[string]; parent: InputFrame; cache: Map<string, InputSnapshot[string] | undefined> }

export function dependencyValues(input: InputSnapshot): Readonly<Record<string, Readonly<Record<string, JsonValue>>>> {
  return Object.fromEntries(Object.entries(input).map(([id, result]) => [id, result.outputs]))
}

const stateSchema = z.strictObject({
  id: z.number().int().nonnegative(),
  status: z.enum(['pending', 'running', 'completed', 'skipped']),
  input: inputSchema,
  output: outputsSchema.optional(),
  systemOutputs: outputsSchema.optional(),
  previous: z.array(z.string()),
  released: z.array(z.string()),
  jobId: z.string().optional(),
  seeded: z.boolean(),
})
export const dependenciesSchema = z.strictObject({
  nextId: z.number().int().nonnegative(),
  iterations: z.record(z.string(), z.number().int().nonnegative()),
  nodes: z.record(z.string(), stateSchema),
})
type Edge = Graph['edges'][number]
interface Loop {
  readonly header: string
  readonly feedback: readonly Edge[]
  readonly body: ReadonlySet<string>
  readonly continuation: ReadonlySet<string>
}

/** Dependency completion belongs to an invocation, never to a Run-wide latest-result table. */
export class Dependencies {
  readonly state: DependenciesCheckpoint
  private readonly forward: Edge[] = []
  private readonly loops = new Map<string, Loop>()
  private readonly innerLoopsFirst: readonly Loop[]
  private readonly outgoing = new Map<string, Edge[]>()
  private readonly incoming = new Map<string, Edge[]>()
  private readonly candidates = new Set<string>()
  private readonly frames = new Map<string, InputFrame>()
  private readonly graph: Graph

  constructor(graph: Graph, saved?: DependenciesCheckpoint) {
    this.graph = graph
    // A deterministic DFS cuts recurrence edges. Removing these edges gives the
    // dependency DAG; their targets are iteration entries, including nested loops.
    const feedback = new Map<string, Edge[]>()
    const visited = new Set<string>()
    const stack = new Set<string>()
    const outgoing = new Map<string, Edge[]>()
    for (const edge of graph.edges) {
      const edges = outgoing.get(edge.source) ?? []
      edges.push(edge)
      outgoing.set(edge.source, edges)
    }
    for (const edges of outgoing.values()) edges.sort((a, b) => a.target.localeCompare(b.target) || (a.sourceHandle ?? '').localeCompare(b.sourceHandle ?? ''))
    const visit = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      stack.add(id)
      for (const edge of outgoing.get(id) ?? []) {
        if (stack.has(edge.target)) {
          const edges = feedback.get(edge.target) ?? []
          edges.push(edge)
          feedback.set(edge.target, edges)
        } else {
          this.forward.push(edge)
          visit(edge.target)
        }
      }
      stack.delete(id)
    }
    const ids = Object.keys(graph.nodes).toSorted()
    for (const triggerId of ids.filter((id) => isTriggerNode(graph.nodes[id]!))) visit(triggerId)
    for (const id of ids) visit(id)
    for (const edge of this.forward) {
      const edges = this.incoming.get(edge.target) ?? []
      edges.push(edge)
      this.incoming.set(edge.target, edges)
      const children = this.outgoing.get(edge.source) ?? []
      children.push(edge)
      this.outgoing.set(edge.source, children)
    }
    for (const [header, edges] of feedback) {
      const descendants = new Set([header])
      const walk = (id: string) => {
        for (const edge of this.outgoing.get(id) ?? []) {
          if (descendants.has(edge.target)) continue
          descendants.add(edge.target)
          walk(edge.target)
        }
      }
      walk(header)
      const body = new Set([header])
      const backwards = (id: string) => {
        if (!descendants.has(id) || body.has(id)) return
        body.add(id)
        for (const edge of this.incoming.get(id) ?? []) backwards(edge.source)
      }
      for (const edge of edges) backwards(edge.source)
      this.loops.set(header, { header, feedback: edges, body, continuation: descendants })
    }
    this.innerLoopsFirst = [...this.loops.values()].toSorted((a, b) => a.body.size - b.body.size || a.header.localeCompare(b.header))
    this.state = saved == null ? { nextId: 0, iterations: {}, nodes: {} } : structuredClone(saved)
    if (saved == null) for (const id of ids) this.state.nodes[id] = this.fresh()
    else this.validate()
    for (const id of ids) {
      if (this.state.nodes[id]!.status == 'pending') this.candidates.add(id)
      this.frames.set(id, { values: this.state.nodes[id]!.input })
    }
  }

  private fresh(): DependencyState {
    return { id: this.state.nextId++, status: 'pending', input: {}, previous: [], released: [], seeded: false }
  }

  private validate() {
    const { nodes, nextId, iterations } = this.state
    if (Object.keys(nodes).length != Object.keys(this.graph.nodes).length) throw new Error('Checkpoint dependency nodes do not match the graph.')
    const ids = new Set<number>()
    for (const [id, state] of Object.entries(nodes)) {
      if (this.graph.nodes[id] == null || state.id >= nextId || ids.has(state.id)) throw new Error('Checkpoint dependency identity is invalid.')
      ids.add(state.id)
      if (state.status == 'running' && state.jobId == null) throw new Error('Checkpoint running dependency has no job.')
      if (
        (state.status == 'pending' || state.status == 'skipped') &&
        (state.jobId != null || state.output != null || state.systemOutputs != null || state.released.length != 0)
      )
        throw new Error('Checkpoint inactive dependency contains an execution.')
      if (state.status == 'skipped' && (state.seeded || state.previous.length != 0 || Object.keys(state.input).length != 0))
        throw new Error('Checkpoint skipped dependency contains values.')
      if (state.seeded && (!this.loops.has(id) || state.previous.some((source) => !this.loops.get(id)!.feedback.some((edge) => edge.source == source))))
        throw new Error('Checkpoint recurrence seed is invalid.')
      if (state.released.length != new Set(state.released).size) throw new Error('Checkpoint released handles are duplicated.')
      if (state.previous.some((source) => !this.graph.edges.some((edge) => edge.source == source && edge.target == id)))
        throw new Error('Checkpoint predecessor does not match the graph.')
      if (state.previous.length != new Set(state.previous).size) throw new Error('Checkpoint predecessors are duplicated.')
      if (state.status == 'completed' && state.output == null) throw new Error('Checkpoint completed dependency has no output.')
      if (state.previous.some((source) => state.input[source] == null)) throw new Error('Checkpoint predecessor has no input snapshot.')
      for (const [source, result] of Object.entries(state.input)) {
        if (nodes[source] == null || result.execution > nodes[source]!.id || result.execution >= nextId)
          throw new Error('Checkpoint dependency result identity is invalid.')
      }
    }
    if (Object.keys(iterations).some((id) => !this.loops.has(id))) throw new Error('Checkpoint loop scope is invalid.')
  }

  start(nodeId: string, outputs: Readonly<Record<string, JsonValue>>) {
    for (const [id, node] of Object.entries(this.graph.nodes)) {
      if (!isTriggerNode(node)) continue
      const state = this.state.nodes[id]!
      state.status = id == nodeId ? 'completed' : 'skipped'
      if (id == nodeId) {
        state.output = outputs
        state.released = Object.keys(outputs)
      }
    }
  }

  private edge(edge: Edge): 'pending' | 'selected' | 'skipped' {
    const source = this.state.nodes[edge.source]!
    if (source.status == 'skipped') return 'skipped'
    if (edge.sourceHandle != null && source.released.includes(edge.sourceHandle)) return 'selected'
    if (source.status != 'completed') return 'pending'
    return edge.sourceHandle == null ? 'selected' : 'skipped'
  }

  private edgeResult(edge: Edge): InputSnapshot[string] {
    const source = this.state.nodes[edge.source]!
    const outputs =
      edge.sourceHandle != null && this.graph.nodes[edge.source]!.kind != 'condition'
        ? Object.fromEntries(Object.entries(source.output!).filter(([handle]) => handle == edge.sourceHandle))
        : source.output!
    return { execution: source.id, outputs, ...(source.systemOutputs == null ? {} : { systemOutputs: source.systemOutputs }) }
  }

  input(nodeId: string, sourceId: string): InputSnapshot[string] | undefined {
    if (this.loops.size != 0) return this.state.nodes[nodeId]!.input[sourceId]
    let frame = this.frames.get(nodeId)!
    const visited: Extract<InputFrame, { source: string }>[] = []
    let result: InputSnapshot[string] | undefined
    for (;;) {
      if (!('source' in frame) || frame.values != null) {
        result = frame.values![sourceId]
        break
      }
      if (frame.source == sourceId) {
        result = frame.result
        break
      }
      if (frame.cache.has(sourceId)) {
        result = frame.cache.get(sourceId)
        break
      }
      visited.push(frame)
      frame = frame.parent
    }
    for (const ancestor of visited) ancestor.cache.set(sourceId, result)
    return result
  }

  private snapshot(frame: InputFrame): InputSnapshot {
    const pending: Extract<InputFrame, { source: string }>[] = []
    while ('source' in frame && frame.values == null) {
      pending.push(frame)
      frame = frame.parent
    }
    let values = frame.values!
    for (const current of pending.toReversed()) {
      values = Object.assign({}, values, { [current.source]: current.result })
      current.values = values
      current.cache.clear()
    }
    return values
  }

  private collectInputs(edges: readonly Edge[]): InputSnapshot {
    const input: InputSnapshot = {}
    const merge = (id: string, result: InputSnapshot[string]) => {
      const previous = input[id]
      if (previous == null || result.execution > previous.execution) input[id] = result
      else if (result !== previous && result.execution == previous.execution)
        input[id] = {
          execution: result.execution,
          outputs: { ...previous.outputs, ...result.outputs },
          ...(previous.systemOutputs || result.systemOutputs ? { systemOutputs: { ...previous.systemOutputs, ...result.systemOutputs } } : {}),
        }
    }
    for (const edge of edges) {
      const source = this.state.nodes[edge.source]!
      for (const id in source.input) merge(id, source.input[id]!)
      merge(edge.source, this.edgeResult(edge))
    }
    for (const id of Object.keys(input)) {
      if (this.state.nodes[id]!.status == 'skipped') delete input[id]
    }
    return input
  }

  private loopSettled(loop: Loop): boolean {
    return [...loop.body].every((id) => {
      const state = this.state.nodes[id]!
      return state.status == 'completed' || state.status == 'skipped'
    })
  }

  private blockedByLoop(edge: Edge): boolean {
    // An unselected exit is not a completed dependency until that loop finishes.
    // Pending notifications deliberately leave a suspended loop immediately.
    if (this.edge(edge) == 'selected') return false
    for (const loop of this.loops.values()) {
      const { body } = loop
      if (!body.has(edge.source) || body.has(edge.target)) continue
      if (!this.loopSettled(loop)) return true
      if (loop.feedback.some((back) => this.edge(back) == 'selected')) return true
    }
    return false
  }

  private continuationPending(loop: Loop): boolean {
    const { body } = loop
    const exitBlocked = new Map<string, boolean>()
    const awaitsExit = (id: string): boolean => {
      if (exitBlocked.has(id)) return exitBlocked.get(id)!
      const blocked = (this.incoming.get(id) ?? []).some(
        (edge) =>
          this.edge(edge) != 'selected' &&
          ((body.has(edge.source) && !body.has(id) && this.blockedByLoop(edge)) ||
            (this.state.nodes[edge.source]!.status == 'pending' && awaitsExit(edge.source))),
      )
      exitBlocked.set(id, blocked)
      return blocked
    }
    const visited = new Set<string>()
    const visit = (id: string): boolean => {
      if (visited.has(id) || body.has(id)) return false
      visited.add(id)
      const state = this.state.nodes[id]!
      if (state.status == 'running') return true
      if (state.status == 'pending') return !awaitsExit(id)
      return (this.outgoing.get(id) ?? []).some((edge) => this.edge(edge) == 'selected' && visit(edge.target))
    }
    return this.forward.some((edge) => body.has(edge.source) && !body.has(edge.target) && this.edge(edge) == 'selected' && visit(edge.target))
  }

  private selectedIncoming(nodeId: string): readonly Edge[] | undefined {
    const edges = this.incoming.get(nodeId) ?? []
    if (edges.some((edge) => this.edge(edge) == 'pending' || this.blockedByLoop(edge))) return undefined
    return edges.filter((edge) => this.edge(edge) == 'selected')
  }

  private readyAcyclic(): string[] {
    const ready = new Set<string>()
    for (const id of this.candidates) {
      this.candidates.delete(id)
      const state = this.state.nodes[id]!
      if (state.status != 'pending') continue
      const selected = this.selectedIncoming(id)
      if (selected == null) continue
      if (selected.length == 0) {
        state.status = 'skipped'
        for (const edge of this.outgoing.get(id) ?? []) this.candidates.add(edge.target)
      } else {
        if (selected.length == 1) {
          const edge = selected[0]!
          const frame: InputFrame = { source: edge.source, result: this.edgeResult(edge), parent: this.frames.get(edge.source)!, cache: new Map() }
          this.frames.set(id, frame)
          // Preserve the checkpoint shape while sharing single-predecessor snapshots during execution.
          Object.defineProperty(state, 'input', {
            configurable: true,
            enumerable: true,
            get: () => this.snapshot(frame),
          })
        } else {
          const input = this.collectInputs(selected)
          Object.defineProperty(state, 'input', { configurable: true, enumerable: true, writable: true, value: input })
          this.frames.set(id, { values: input })
        }
        state.previous = [...new Set(selected.map((edge) => edge.source))].toSorted()
        ready.add(id)
      }
    }
    // Keep unadmitted nodes eligible when ready is read again before begin.
    for (const id of ready) this.candidates.add(id)
    return [...ready].toSorted()
  }

  /** Resolve skips and iteration boundaries before admitting another invocation. */
  ready(): string[] {
    if (this.loops.size == 0) return this.readyAcyclic()
    let changed = true
    while (changed) {
      changed = false
      // Inner scopes settle before their enclosing scope. A recurrence replaces
      // only its forward continuation; unrelated and outer invocations are reused.
      for (const loop of this.innerLoopsFirst) {
        const { header, feedback: edges, continuation: affected } = loop
        if (!this.loopSettled(loop)) continue
        const selected = edges.filter((edge) => this.edge(edge) == 'selected')
        if (selected.length == 0) continue
        if (this.continuationPending(loop) || [...affected].some((id) => this.state.nodes[id]!.status == 'running')) continue
        const input = this.collectInputs(selected)
        this.state.iterations[header] = (this.state.iterations[header] ?? 0) + 1
        for (const nested of this.loops.keys()) {
          if (nested != header && affected.has(nested)) {
            delete this.state.iterations[nested]
          }
        }
        for (const id of affected) this.state.nodes[id] = this.fresh()
        const entry = this.state.nodes[header]!
        entry.input = input
        entry.previous = [...new Set(selected.map((edge) => edge.source))].toSorted()
        entry.seeded = true
        changed = true
        break
      }
      for (const [id, state] of Object.entries(this.state.nodes)) {
        if (state.status != 'pending' || state.seeded) continue
        if (this.selectedIncoming(id)?.length == 0) {
          state.status = 'skipped'
          changed = true
        }
      }
    }
    return Object.entries(this.state.nodes).flatMap(([id, state]) => {
      if (state.status != 'pending') return []
      if (state.seeded) return [id]
      const selected = this.selectedIncoming(id)
      if (selected == null || selected.length == 0) return []
      state.input = this.collectInputs(selected)
      // Entering a nested scope through its ordinary entry starts fresh. Only an
      // actual recurrence seed carries that scope's previous iteration values.
      for (const member of this.loops.get(id)?.body ?? []) {
        delete state.input[member]
      }
      state.previous = [...new Set(selected.map((edge) => edge.source))].toSorted()
      return [id]
    })
  }

  begin(nodeId: string, jobId: string) {
    const state = this.state.nodes[nodeId]!
    state.status = 'running'
    state.jobId = jobId
    this.candidates.delete(nodeId)
  }

  release(
    nodeId: string,
    outputs: Readonly<Record<string, JsonValue>>,
    handles: readonly string[],
    complete: boolean,
    systemOutputs?: Readonly<Record<string, JsonValue>>,
  ) {
    const state = this.state.nodes[nodeId]!
    state.output = outputs
    state.systemOutputs = systemOutputs
    state.released = [...new Set([...state.released, ...handles])]
    if (complete) state.status = 'completed'
    if (this.loops.size == 0) for (const edge of this.outgoing.get(nodeId) ?? []) this.candidates.add(edge.target)
  }

  get incomplete(): boolean {
    return Object.values(this.state.nodes).some((state) => state.status == 'pending' || state.status == 'running')
  }
}
