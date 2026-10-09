import { decodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { flowResourceReferences } from '@oomol-lab/open-flow/flow-semantics'

export function draftResourceReferences(content: string): string | null {
  let revision
  try {
    revision = decodeRevision(new TextEncoder().encode(content))
  } catch {
    // Flows awaiting repair or upgrade must remain listable without claiming an empty resource set.
    return null
  }
  return JSON.stringify(flowResourceReferences(revision))
}
