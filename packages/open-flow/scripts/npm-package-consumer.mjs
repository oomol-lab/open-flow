import assert from 'node:assert/strict'

const action = await import('@oomol-lab/open-flow/connector-action')
if (typeof action.connectorActionPorts !== 'function') throw new Error('Missing Connector Action contract.')

const Effect = await import('effect/Effect')
const { runFlow } = await import('@oomol-lab/open-flow/scheduler')
const result = await Effect.runPromise(
  runFlow(
    {
      closureDigest: 'consumer',
      engineContract: 'open-flow-engine/v2',
      graph: { edges: [], nodes: { start: { kind: 'manual', name: 'Start' } } },
      modules: {},
      subflows: {},
      tasks: {},
    },
    {
      trigger: { nodeId: 'start', payload: {} },
      createId: () => 'consumer-job',
      flowId: 'main',
      invokeTask: () => Effect.fail(new Error('Unexpected Task invocation.')),
      runId: 'consumer-run',
    },
  ),
)
if (result.kind !== 'node-results' || result.nodes.length !== 0) throw new Error('Scheduler Effect is not interoperable with the consumer Effect runtime.')

const api = await import('@oomol-lab/open-flow/control-api')
if (typeof api.ControlClient !== 'function') throw new Error('Missing Control API client.')
if (api.controlErrorMetadata[api.controlErrorCode.runNotFound].status !== 404) throw new Error('Missing Control API errors.')
const proxy = await import('@oomol-lab/open-flow/connector-proxy')
if (Object.keys(proxy).length !== 0) throw new Error('Connector Proxy should be type-only.')
const control = await import('@oomol-lab/open-flow/control-api-conformance')
for (const name of [
  'controlApiConformanceCases',
  'controlRecoveryConformanceCases',
  'publicationControlApiConformanceCases',
  'triggerControlApiConformanceCases',
  'connectorControlApiConformanceCases',
]) {
  assert.ok(Array.isArray(control[name]) && control[name].length > 0, `Missing ${name}.`)
}
const cron = await import('@oomol-lab/open-flow/cron-trigger')
if (typeof cron.nextTriggerScheduledAt !== 'function') throw new Error('Missing Cron Trigger contract.')
const integration = await import('@oomol-lab/open-flow/integration-trigger')
if (integration.integrationConformanceCases.length === 0) throw new Error('Missing Integration Trigger contract.')
const poll = await import('@oomol-lab/open-flow/poll-trigger')
if (poll.maximumPollEventsPerPage !== 100) throw new Error('Missing Poll Trigger contract.')
const providers = await import('@oomol-lab/open-flow/provider-triggers')
const slack = providers.triggerDefinitions.find((definition) => definition.snapshot.key === 'slack.on_message_posted')
if (slack == null || !('poll' in slack)) throw new Error('Missing Slack Trigger definition.')
await assert.rejects(
  () =>
    slack.poll({
      checkpoint: null,
      config: { channelId: 'C1' },
      connector: { execute: async () => ({ data: { error: 'invalid_auth', ok: false }, status: 200 }) },
      now: new Date(),
    }),
  poll.PollConnectionError,
)
const lifecycle = await import('@oomol-lab/open-flow/run-lifecycle')
if (lifecycle.transitionRun('queued', { kind: 'claim' }).kind !== 'ready') throw new Error('Missing Run lifecycle runtime.')
const events = await import('@oomol-lab/open-flow/run-events')
if (typeof events.createEventProjector !== 'function') throw new Error('Missing Run event projection.')
const runtime = await import('@oomol-lab/open-flow/runtime-contract')
if (runtime.runtimeConformanceCases.length === 0) throw new Error('Missing Runtime contract.')
const webhook = await import('@oomol-lab/open-flow/webhook-trigger')
if (webhook.maximumWebhookBodyBytes !== 65536) throw new Error('Missing Webhook Trigger contract.')
const encoding = await import('@oomol-lab/open-flow/flow-encoding')
if (typeof encoding.encodeRevision !== 'function') throw new Error('Missing Flow encoding runtime.')
const semantics = await import('@oomol-lab/open-flow/flow-semantics')
if (typeof semantics.prepareFlow !== 'function') throw new Error('Missing Flow semantics runtime.')
const localization = await import('@oomol-lab/open-flow/localization')
if (localization.resolveUiLanguage(['zh-Hant-HK']) !== 'zh-TW') throw new Error('Missing UI language registry.')
const workbench = await import('@oomol-lab/open-flow/workbench')
if (typeof workbench.OpenFlowWorkbench !== 'function' || typeof workbench.OpenFlowSessionGate !== 'function') throw new Error('Missing Workbench runtime.')
await import.meta.resolve('@oomol-lab/open-flow/workbench.css')
await import.meta.resolve('@oomol-lab/open-flow/theme.css')
await import.meta.resolve('@oomol-lab/open-flow/ui.css')

await assert.rejects(import('@oomol-lab/open-flow'), { message: /Cannot find package '@oomol-lab\/open-flow'/ })
