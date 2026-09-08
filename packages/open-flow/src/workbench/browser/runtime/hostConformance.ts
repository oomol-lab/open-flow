import type { FlowCatalogEvent, FlowChangeEvent, WorkbenchHost } from './contract.ts'

export async function verifyWorkbenchHost(
  host: WorkbenchHost,
  driver: {
    connect(): Promise<void>
    fail(): Promise<void>
    emit(event: FlowCatalogEvent | FlowChangeEvent): Promise<void>
    advance(milliseconds: number): Promise<void>
  },
): Promise<void> {
  const events: unknown[] = []
  const listener = (event?: FlowCatalogEvent | FlowChangeEvent) => events.push(event)
  const abandoned = host.subscribeFlow('abandoned', listener)
  abandoned.stop()
  await driver.advance(0)
  await abandoned.ready
  await driver.connect()
  assert(events.length == 0, 'Stopped subscriptions must ignore late connections.')

  const catalog = host.subscribeFlowCatalog(listener)
  try {
    await driver.fail()
    await driver.advance(5_000)
    await catalog.ready
    assert(events.length == 0, 'Initial connection failure must allow loading without a false event.')
    await driver.connect()
    assert(events.length == 1 && events[0] == null, 'Recovery must invalidate the catalog for an authoritative reread.')
    events.length = 0
    await driver.emit({ kind: 'flows.changed', version: 1 })
    assert(events.length == 1, 'Catalog changes must reach the catalog subscription.')
  } finally {
    catalog.stop()
  }
  events.length = 0
  const flow = host.subscribeFlow('flow-1', listener)
  try {
    await driver.connect()
    await flow.ready
    assert(events.length == 0, 'The first successful connection must only settle readiness.')
    const event = { kind: 'draft.changed', flowId: 'flow-1', revisionId: 'revision-2', version: 1 } as const
    await driver.emit(event)
    assert(JSON.stringify(events) == JSON.stringify([event]), 'Draft changes must reach the Flow subscription unchanged.')
    flow.stop()
    flow.stop()
    events.length = 0
    await driver.emit(event)
    await driver.advance(10_000)
    await driver.connect()
    assert(events.length == 0, 'Stopping must prevent events and reconnect invalidations.')
  } finally {
    flow.stop()
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}
