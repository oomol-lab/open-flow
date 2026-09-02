import type { JsonValue } from '../../../flow/common/change.ts'
import type { FlowCatalogEvent, FlowChangeEvent, WorkbenchHost } from './contract.ts'

import { ControlClient } from '../../../control/common/api.ts'

export { ApiError } from '../../../control/common/api.ts'
export type {
  DraftRun,
  Draft,
  DraftChange,
  DraftSync,
  Diagnostic,
  ConnectorAction,
  ConnectorConnection,
  ConnectorProvider,
  Live,
  LiveRun,
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
} from '../../../flow/common/change.ts'

export interface Presentation {
  readonly revision: number
  readonly updatedAt: string
  readonly value: Readonly<Record<string, JsonValue>>
  readonly version: 1
}

type Fetcher = WorkbenchHost['request']
type FlowSubscriber = WorkbenchHost['subscribeFlow']
type FlowCatalogSubscriber = WorkbenchHost['subscribeFlowCatalog']
const segment = encodeURIComponent

export class WorkbenchClient extends ControlClient {
  constructor(
    fetcher: Fetcher,
    private readonly subscribeFlow: FlowSubscriber = () => () => {},
    private readonly subscribeFlowCatalog: FlowCatalogSubscriber = () => () => {},
  ) {
    super(fetcher)
  }

  watchFlowCatalog(changed: (event?: FlowCatalogEvent) => void): () => void {
    return this.subscribeFlowCatalog(changed)
  }

  watchFlow(
    flowId: string,
    changed: (revisionId?: string) => void,
    runChanged: (event: Extract<FlowChangeEvent, { readonly kind: 'run.changed' | 'run.created' }>) => void = () => {},
  ): () => void {
    return this.subscribeFlow(flowId, (event?: FlowChangeEvent) => {
      if (event == null) changed()
      else if (event.kind == 'draft.changed') changed(event.revisionId)
      else runChanged(event)
    })
  }

  async getPresentation(flowId: string): Promise<Presentation> {
    return await this.request(`/v1/flows/${segment(flowId)}/presentation`)
  }

  async updatePresentation(flowId: string, expectedRevision: number, value: Readonly<Record<string, JsonValue>>): Promise<Presentation> {
    return await this.request(`/v1/flows/${segment(flowId)}/presentation`, {
      body: JSON.stringify({ expectedRevision, value, version: 1 }),
      method: 'PUT',
    })
  }
}
