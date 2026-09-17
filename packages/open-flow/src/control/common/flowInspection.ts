import type { Draft, Flow } from './api.ts'

export async function inspectFlowDraft(flow: Flow, readDraft: () => Draft | Promise<Draft>) {
  try {
    return { flow, draft: await readDraft(), version: 1 as const }
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || (error.code != 'flow.invalid' && error.code != 'flow.revision-upgrade-required')) throw error
    return {
      flow,
      draft: null,
      draftIssue: { code: error.code, message: error.message, revisionId: flow.draftRevisionId },
      version: 1 as const,
    }
  }
}
