import { SourceIdentityError } from './definition.ts'
import { feishuApplication } from './feishu.ts'
import { firefliesAccount } from './fireflies.ts'
import { intercomApplication } from './intercom.ts'
import { jiraProject } from './jira.ts'
import { sentryApplication } from './sentry.ts'
import { slackApplication } from './slack.ts'
import { zoomApplication } from './zoom.ts'

export type { EventSourceDefinition, SourceConfiguration, SourceEvent, SourceSubscription } from './definition.ts'
export { SourceIdentityError } from './definition.ts'
export { feishuApplication } from './feishu.ts'

const definitions: readonly (typeof feishuApplication)[] = [
  feishuApplication,
  slackApplication,
  intercomApplication,
  sentryApplication,
  zoomApplication,
  firefliesAccount,
  jiraProject,
]

export function eventSourceDefinition(kind: string): (typeof definitions)[number] {
  const definition = definitions.find((item) => item.kind == kind)
  if (definition == null) throw new SourceIdentityError(`Unknown event source kind: ${kind}`)
  return definition
}
