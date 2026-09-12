import type { LlmConfig } from '../deployment/llm.ts'
import type { Database } from './database.ts'

import { ConnectorTeamStore } from './connector-team-store.ts'
import { FlowStore } from './flow-store.ts'
import { IntegrationStore } from './integration-store.ts'
import { PollStore } from './poll-store.ts'
import { PublicationStore } from './publication-store.ts'
import { ResultStore } from './result-store.ts'
import { RevisionStore } from './revision-store.ts'
import { RunStore } from './run-store.ts'
import { RunViewStore } from './run-view-store.ts'
import { TriggerStore } from './trigger-store.ts'
import { VariableStore } from './variable-store.ts'

const defaultRunEventRetentionMs = 30 * 24 * 60 * 60 * 1000
const defaultMaxPendingRuns = 1_000

/**
 * Composition root for a deployment's persistent state.
 *
 * It owns no SQL of its own: it borrows the single connection and transaction
 * boundary from {@link Database} and hands them to one store per state owner.
 * Callers reach a concern through that owner — `store.runs`, `store.flows`,
 * `store.variables`, and so on — instead of through one flat surface.
 */
export class Store {
  readonly connectorTeams: ConnectorTeamStore
  readonly flows: FlowStore
  readonly integrations: IntegrationStore
  readonly polls: PollStore
  readonly publications: PublicationStore
  readonly results: ResultStore
  readonly revisions: RevisionStore
  readonly runs: RunStore
  readonly runViews: RunViewStore
  readonly triggers: TriggerStore
  readonly variables: VariableStore

  constructor(
    database: Database,
    clock: () => number = Date.now,
    runEventRetentionMs = defaultRunEventRetentionMs,
    maxPendingRuns = defaultMaxPendingRuns,
    llmConfig: () => LlmConfig | undefined = () => undefined,
  ) {
    const connection = database.connection
    const transaction = <Value>(operation: () => Value): Value => database.transaction(operation)

    this.variables = new VariableStore(connection, transaction, clock)
    this.connectorTeams = new ConnectorTeamStore(connection)
    this.revisions = new RevisionStore(connection, this.variables, llmConfig)
    this.results = new ResultStore(connection, transaction)
    // Trigger admission is resolved lazily because Runs are assembled after the
    // stores that report occurrences into them.
    this.integrations = new IntegrationStore(connection, transaction, (input) => this.runs.acceptTriggerOccurrence(input))
    this.polls = new PollStore(connection, transaction, (input) => this.runs.acceptTriggerOccurrence(input))
    this.publications = new PublicationStore(connection, clock, transaction, this.integrations, this.polls, this.variables)
    this.flows = new FlowStore(connection, transaction, this.revisions)
    this.runViews = new RunViewStore(connection)
    this.runs = new RunStore(
      connection,
      transaction,
      clock,
      { maxPendingRuns, runEventRetentionMs },
      {
        connectorTeams: this.connectorTeams,
        flows: this.flows,
        publications: this.publications,
        revisions: this.revisions,
        variables: this.variables,
        views: this.runViews,
      },
    )
    this.triggers = new TriggerStore(connection, transaction, (input) => this.runs.acceptTriggerOccurrence(input))
  }
}
