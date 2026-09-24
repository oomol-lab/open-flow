import type { InputSourceCandidate } from '../../../../flow/common/graph.ts'

import { describe, expect, it } from 'vitest'
import { githubRepoEvent } from '../../../../trigger/providers/github/on-repo-event.ts'
import { localizeTrigger } from '../../../../trigger/providers/localization.ts'
import {
  presentProviderOutputDescription,
  presentProviderSourceCandidates,
  presentProviderTriggerConfig,
  presentProviderTriggerOutputs,
} from './providerTriggerPresentation.ts'

const trigger = {
  config: {},
  definition: githubRepoEvent.snapshot,
  kind: 'integration',
  name: 'Repository Event',
} as const

describe('Provider Trigger presentation', () => {
  it('localizes configuration and output descriptions without changing runtime definitions', async () => {
    const display = await localizeTrigger(trigger.definition, 'zh-CN')
    const config = presentProviderTriggerConfig(trigger.definition.configInputs, display)
    const outputs = presentProviderTriggerOutputs(trigger, display)
    const presentedOwner = config.find((field) => 'handle' in field && field.handle == 'owner')
    const runtimeOwner = trigger.definition.configInputs.find((field) => 'handle' in field && field.handle == 'owner')

    expect(presentedOwner != null && 'handle' in presentedOwner ? presentedOwner.description : undefined).toBe(display.configInputs.owner)
    expect(outputs.find((field) => field.handle == 'body')?.description).toBe(display.outputs.body)
    expect(display.configInputs.owner).not.toBe('Owner of the GitHub repository.')
    expect(runtimeOwner != null && 'handle' in runtimeOwner ? runtimeOwner.description : undefined).toBeUndefined()
    expect(trigger.definition.outputs.find((field) => field.handle == 'body')?.description).toBeUndefined()
  })

  it('presents localized output descriptions in source choices', async () => {
    const display = await localizeTrigger(trigger.definition, 'fr')
    const candidates: readonly InputSourceCandidate[] = [{ output: 'body', check: { kind: 'available' } }]
    const presented = presentProviderSourceCandidates(trigger, candidates, display)

    expect(presented[0]?.description).toBe(display.outputs.body)
    expect(presentProviderOutputDescription(trigger, 'body', undefined, display)).toBe(display.outputs.body)
    expect(candidates[0]?.description).toBeUndefined()
  })
})
