import type { CreateEventSource, UpdateEventSource } from '@oomol-lab/open-flow/control-api'
import type { EventSourceRuntime } from '../runtime/event-source-runtime.ts'
import type { ConnectorControl } from './connector-control.ts'
import type { ControlAccess } from './control-access.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { ControlError } from '../error.ts'

export class EventSourceControl {
  private readonly access: ControlAccess
  private readonly eventSources: EventSourceRuntime | undefined
  private readonly connectors: Pick<ConnectorControl, 'resolveConnectorScope'>
  private readonly resolveConnectorTeam: (teamId?: string) => Promise<string | undefined>

  constructor(
    access: ControlAccess,
    eventSources: EventSourceRuntime | undefined,
    connectors: Pick<ConnectorControl, 'resolveConnectorScope'>,
    resolveConnectorTeam: (teamId?: string) => Promise<string | undefined>,
  ) {
    this.access = access
    this.eventSources = eventSources
    this.connectors = connectors
    this.resolveConnectorTeam = resolveConnectorTeam
  }

  async listEventSources(actorId: string, flowId?: string, signal?: AbortSignal) {
    if (flowId == null) this.access.requireAdmin(actorId)
    else this.access.authorize(actorId, { flowId })

    if (this.eventSources == null) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Event sources are unavailable.')
    if (flowId == null) return this.eventSources.list(undefined, signal)
    const teamId = (await this.connectors.resolveConnectorScope(actorId, flowId)) ?? null
    return { ...(await this.eventSources.list(teamId, signal)), teamId }
  }

  async createEventSource(actorId: string, input: CreateEventSource, signal: AbortSignal) {
    this.access.requireAdmin(actorId)

    if (this.eventSources == null) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Event sources are unavailable.')
    const teamId = await this.resolveConnectorTeam(input.teamId ?? undefined)
    if ((teamId ?? null) != input.teamId) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Select the Connector Team explicitly.')
    return this.eventSources.create(input, signal)
  }

  updateEventSource(actorId: string, sourceId: string, input: UpdateEventSource, signal: AbortSignal) {
    this.access.requireAdmin(actorId)

    if (this.eventSources == null) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Event sources are unavailable.')
    return this.eventSources.update(sourceId, input, signal)
  }

  deleteEventSource(actorId: string, sourceId: string, revision: number, signal = AbortSignal.timeout(30_000)) {
    this.access.requireAdmin(actorId)

    if (this.eventSources == null) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Event sources are unavailable.')
    return this.eventSources.delete(sourceId, revision, signal)
  }
}
