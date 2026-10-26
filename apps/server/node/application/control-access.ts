import type { StoredFlow } from '../storage/flow-store.ts'
import type { Store } from '../storage/store.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { ControlError, serverErrorCode } from '../error.ts'

export class ControlAccess {
  private readonly store: Pick<Store, 'users' | 'flows' | 'runViews' | 'publications'>

  constructor(store: Pick<Store, 'users' | 'flows' | 'runViews' | 'publications'>) {
    this.store = store
  }

  requireAdmin(actorId: string): void {
    const user = this.store.users.get(actorId)
    if (actorId != 'operator' && !(user?.enabled && user.role == 'admin')) {
      throw new ControlError(serverErrorCode.authorizationDenied, 'Administrator permission is required.')
    }
  }

  ownsFlow(actorId: string, flowId: string): boolean {
    return this.store.flows.get(flowId)?.ownerId == actorId
  }

  authorize(actorId: string, resources: { readonly flowId?: string; readonly runId?: string; readonly publicationId?: string }): void {
    if (resources.flowId != null && !this.ownsFlow(actorId, resources.flowId)) notFound()
    if (resources.runId != null) {
      const run = this.store.runViews.controlRun(resources.runId)
      if (run == null || !this.ownsFlow(actorId, run.flowId)) throw new ControlError(controlErrorCode.runNotFound, 'The Run was not found.')
    }
    if (resources.publicationId != null) {
      const storedPublication = this.store.publications.publicationById(resources.publicationId)
      if (storedPublication == null || !this.ownsFlow(actorId, storedPublication.flowId))
        throw new ControlError(controlErrorCode.publicationNotFound, 'The Publication was not found.')
    }
  }

  requireFlow(actorId: string, flowId: string): StoredFlow {
    const stored = this.store.flows.get(flowId)
    if (stored == null || stored.ownerId != actorId) notFound()
    return stored
  }
}
export function notFound(): never {
  throw new ControlError(controlErrorCode.flowNotFound, 'The Flow or Revision was not found.')
}
