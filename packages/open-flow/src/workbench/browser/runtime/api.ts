import type { ConditionalResult, Presentation } from '../../../control/common/api.ts'
import type { JsonValue } from '../../../flow/common/change.ts'
import type { FlowCatalogEvent, FlowChangeEvent, WorkbenchHost } from './contract.ts'

import { ApiError, ControlClient } from '../../../control/common/api.ts'

export { ApiError } from '../../../control/common/api.ts'
export type {
  DraftRun,
  Draft,
  DraftChange,
  DraftSync,
  Diagnostic,
  ConnectorAction,
  ConnectorActionMetadata,
  ConnectorAccess,
  ConnectorAccessCandidates,
  ConnectorConnection,
  ConnectorProvider,
  ProviderAccessBinding,
  ProviderAccessBindingCandidate,
  Live,
  LiveRun,
  Presentation,
  Publication,
  PublicationPage,
  PublishOperation,
  Flow,
  FlowCheck,
  FlowPage,
  RevisionMetadata,
  Run,
  RunCancellation,
  RunDetails,
  RunEvent,
  RunEventKind,
  RunEvents,
  RunPage,
  RunResult,
  RunStatus,
  PollTriggerTestResult,
  TriggerActivity,
  TriggerActivityKind,
  TriggerActivityPage,
  TriggerBinding,
  TriggerBindingDetail,
  TriggerRun,
  TriggerKeySummary,
} from '../../../control/common/api.ts'

export type {
  ApprovalNode,
  ChangeOperation,
  CodeModule,
  ConditionOperator,
  ConditionNode,
  Graph,
  GraphEdge,
  GraphNode,
  GraphTarget,
  Group,
  InputMapping,
  InputPort,
  InputPortDefinition,
  JsonValue,
  PortDefinition,
  FlowDocument,
  SubflowNode,
  TaskDefinition,
  TaskNode,
  TriggerKeySnapshot,
  TriggerNode,
  TriggerSchedule,
  ValueNode,
  WaitAction,
  WaitNode,
  WebhookOptions,
  WebhookMethod,
} from '../../../flow/common/change.ts'

type Fetcher = WorkbenchHost['request']
type FlowSubscriber = WorkbenchHost['subscribeFlow']
type FlowCatalogSubscriber = WorkbenchHost['subscribeFlowCatalog']
const segment = encodeURIComponent

export class WorkbenchClient extends ControlClient {
  constructor(
    private readonly fetcher: Fetcher,
    private readonly subscribeFlow: FlowSubscriber = () => ({ ready: Promise.resolve(), stop() {} }),
    private readonly subscribeFlowCatalog: FlowCatalogSubscriber = () => ({ ready: Promise.resolve(), stop() {} }),
  ) {
    super(fetcher)
  }

  async readProxyCatalog<T>(
    query: { readonly path: string; readonly decode: (value: unknown) => T },
    etag: string | null,
    signal?: AbortSignal,
  ): Promise<ConditionalResult<T>> {
    const response = await this.fetcher(query.path, { headers: { accept: 'application/json', ...(etag ? { 'if-none-match': etag } : {}) }, signal })
    const nextETag = response.headers.get('etag')?.trim() || null
    if (response.status == 304) return { modified: false, etag: nextETag }
    const value: unknown = await response.json()
    if (!response.ok) {
      const source = value != null && typeof value == 'object' ? (value as Record<string, unknown>) : undefined
      const flowError = source?.error != null && typeof source.error == 'object' ? (source.error as Record<string, unknown>) : undefined
      const code = flowError?.code ?? source?.errorCode
      const message = flowError?.message ?? source?.message
      throw new ApiError(
        response.status,
        typeof code == 'string' ? code : 'request.failed',
        typeof message == 'string' ? message : `Request failed with status ${response.status}.`,
      )
    }
    return { modified: true, data: query.decode(value), etag: nextETag }
  }

  watchFlowCatalog(changed: (event?: FlowCatalogEvent) => void): ReturnType<FlowCatalogSubscriber> {
    return this.subscribeFlowCatalog(changed)
  }

  watchFlow(
    flowId: string,
    changed: (revisionId?: string) => void,
    runChanged: (event: Extract<FlowChangeEvent, { readonly kind: 'run.changed' | 'run.created' }>) => void = () => {},
    accessChanged: (accessRevision: number) => void = () => {},
  ): ReturnType<FlowSubscriber> {
    return this.subscribeFlow(flowId, (event?: FlowChangeEvent) => {
      if (event == null) changed()
      else if (event.kind == 'draft.changed') changed(event.revisionId)
      else if (event.kind == 'access.changed') accessChanged(event.accessRevision)
      else runChanged(event)
    })
  }

  async updatePresentation(flowId: string, expectedRevision: number, value: Readonly<Record<string, JsonValue>>): Promise<Presentation> {
    return await this.request(`/v1/flows/${segment(flowId)}/presentation`, {
      body: JSON.stringify({ expectedRevision, value, version: 1 }),
      method: 'PUT',
    })
  }
}
