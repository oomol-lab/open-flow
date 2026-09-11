import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'

import { digestBytes, encodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { prepareFlow, variableBindings } from '@oomol-lab/open-flow/flow-semantics'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { AcceptanceError } from '../error.ts'

export interface ValidatedFlow {
  readonly content: string
  readonly prepared: PreparedFlow
  readonly revisionDigest: string
  readonly variableBindings: Readonly<Record<string, string>>
}

export type RevisionValidator = (revision: RevisionContent) => Promise<ValidatedFlow>

export async function validatedFlow(revision: RevisionContent): Promise<ValidatedFlow> {
  let prepared: Awaited<ReturnType<typeof prepareFlow>>
  try {
    prepared = await prepareFlow(revision, currentEngineContract)
  } catch {
    throw new AcceptanceError('revision-invalid', 'Flow Revision is not structurally valid.')
  }
  switch (prepared.kind) {
    case 'engine-unsupported':
      throw new AcceptanceError(prepared.kind, 'Flow Revision requires an unsupported Engine Contract.')
    case 'flow-invalid':
      throw new AcceptanceError(prepared.kind, 'Flow validation failed.')
    case 'prepared': {
      const bytes = encodeRevision(revision)
      return {
        content: new TextDecoder().decode(bytes),
        prepared: prepared.flow,
        revisionDigest: await digestBytes(bytes),
        variableBindings: variableBindings(revision, prepared.validation.closure.dependencies.inputBindings),
      }
    }
  }
}
