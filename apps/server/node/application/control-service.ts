import type { Store } from '../storage/store.ts'
import type { ConnectorControl } from './connector-control.ts'
import type { ControlAccess } from './control-access.ts'
import type { DraftControl } from './draft-control.ts'
import type { EventSourceControl } from './event-source-control.ts'
import type { FlowControl } from './flow-control.ts'
import type { PublicationControl } from './publication-control.ts'
import type { RunControl } from './run-control.ts'
import type { VariableControl } from './variable-control.ts'

export interface ControlService {
  readonly access: ControlAccess
  readonly eventSources: EventSourceControl
  readonly variables: VariableControl
  readonly connectors: ConnectorControl
  readonly flows: FlowControl
  readonly drafts: DraftControl
  readonly publications: PublicationControl
  readonly runs: RunControl
  readonly users: Store['users']
}
