import { describe, expect, it } from 'vitest'
import { NODE_TYPE } from '../../../stores/node/constants.ts'
import { defaultTriggerIcon, iconForNodeType } from './constants.ts'

describe('iconForNodeType', () => {
  it('uses the Trigger event icon as its fallback', () => {
    expect(defaultTriggerIcon).toBe('i-codicon:symbol-event')
    expect(iconForNodeType(NODE_TYPE.TriggerNode)).toBe(defaultTriggerIcon)
  })
})
