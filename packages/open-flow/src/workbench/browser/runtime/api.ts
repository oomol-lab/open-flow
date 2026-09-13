import type { Presentation } from '../../../control/common/api.ts'
import type { JsonValue } from '../../../flow/common/change.ts'
import type { FlowCatalogEvent, FlowChangeEvent, WorkbenchHost } from './contract.ts'

import { ControlClient } from '../../../control/common/api.ts'
import { RequestCache } from './requestCache.ts'

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

type Fetcher = WorkbenchHost['request']
type FlowSubscriber = WorkbenchHost['subscribeFlow']
type FlowCatalogSubscriber = WorkbenchHost['subscribeFlowCatalog']
const segment = encodeURIComponent

export class WorkbenchClient extends ControlClient {
  readonly #requestCache: RequestCache
  readonly #cacheOptions: WorkbenchHost['connectorCache']
  constructor(
    fetcher: Fetcher,
    private readonly subscribeFlow: FlowSubscriber = () => ({ ready: Promise.resolve(), stop() {} }),
    private readonly subscribeFlowCatalog: FlowCatalogSubscriber = () => ({ ready: Promise.resolve(), stop() {} }),
    connectorCache?: WorkbenchHost['connectorCache'],
  ) {
    super(fetcher)
    this.#cacheOptions = connectorCache
    this.#requestCache = new RequestCache(`open-flow:connector:v1:${encodeURIComponent(connectorCache?.namespace ?? '')}`)
  }

  protected override connectorRequest<Value>(
    path: string,
    kind: 'providers' | 'actions' | 'connections',
    signal: AbortSignal | undefined,
    decode: (value: unknown) => Value,
    fresh = false,
  ): Promise<Value> {
    const options = this.#cacheOptions
    return this.#requestCache.get(
      path,
      {
        maxAgeMs: kind == 'providers' ? 5 * 60_000 : 30_000,
        storage:
          options == null
            ? undefined
            : () => (kind == 'providers' ? (options.localStorage ?? window.localStorage) : (options.sessionStorage ?? window.sessionStorage)),
      },
      signal,
      decode,
      (headers) => this.response(path, { headers, signal }, true),
      fresh,
    )
  }

  get requestCache() {
    return this.#requestCache
  }

  watchFlowCatalog(changed: (event?: FlowCatalogEvent) => void): ReturnType<FlowCatalogSubscriber> {
    return this.subscribeFlowCatalog(changed)
  }

  watchFlow(
    flowId: string,
    changed: (revisionId?: string) => void,
    runChanged: (event: Extract<FlowChangeEvent, { readonly kind: 'run.changed' | 'run.created' }>) => void = () => {},
  ): ReturnType<FlowSubscriber> {
    return this.subscribeFlow(flowId, (event?: FlowChangeEvent) => {
      if (event == null) changed()
      else if (event.kind == 'draft.changed') changed(event.revisionId)
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
