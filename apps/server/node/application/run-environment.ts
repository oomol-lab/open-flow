import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { LlmConfig } from '../deployment/llm.ts'
import type { RunEnvironment } from '../storage/run-store.ts'

import { decodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { flowDependencies, variableBindings } from '@oomol-lab/open-flow/flow-semantics'
import { AcceptanceError } from '../error.ts'

const encoder = new TextEncoder()

export function runEnvironment(engineDigest: string, llmConfig: () => LlmConfig | undefined = () => undefined): RunEnvironment {
  return {
    engineDigest,
    snapshot(content, resolveBindings, triggerId) {
      const stored = JSON.parse(content) as RevisionContent
      if (!Object.values(stored.document.graph.nodes).some((node) => node.kind == 'task' && 'executor' in node.task && node.task.executor.kind == 'agent'))
        return
      const revision = decodeRevision(encoder.encode(content))
      const hasAgent = (id: string): boolean => {
        const node = revision.document.graph.nodes[id]
        return node?.kind == 'task' && 'executor' in node.task && node.task.executor.kind == 'agent'
      }
      const dependencies = flowDependencies(revision, triggerId)
      if (![...dependencies.nodes].some(hasAgent)) return
      const model = llmConfig()
      const bindings = resolveBindings(variableBindings(revision, dependencies.bindings))
      if (model == null || bindings == null) throw new AcceptanceError('flow-invalid', 'Agent model or variable configuration is unavailable.')
      return { model, bindings }
    },
  }
}
