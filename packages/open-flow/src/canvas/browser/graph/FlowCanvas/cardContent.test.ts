import { describe, expect, it } from 'vitest'
import { createI18n } from '../../i18n/i18n-loader.ts'
import { conditionBranchSummary, imageSources, nodeSummary } from './cardContent.ts'

const base = { id: 'node', title: 'Schedule', position: { x: 0, y: 0 }, inputs: [], outputs: [] }

describe('Canvas content', () => {
  it('leaves configured nodes without a description compact instead of inventing a configuration prompt', () => {
    expect(nodeSummary({ ...base, kind: 'task', reference: 'normalize', description: '  ' })).toBe('')
    expect(nodeSummary({ ...base, kind: 'trigger', presentation: { kind: 'webhook', schedules: [] } })).toBe('')
    expect(nodeSummary({ ...base, kind: 'value', values: [] })).toBe('')
    expect(nodeSummary({ ...base, kind: 'subflow', reference: 'prepare' })).toBe('')
  })
  it('keeps the value description separate from its structured content', () => {
    expect(
      nodeSummary({
        ...base,
        kind: 'value',
        description: 'Old values',
        values: [{ handle: 'limit', value: 0 }, { handle: 'enabled', value: false }, { handle: 'fallback', value: null }, { handle: 'unset' }],
      }),
    ).toBe('Old values')
  })
  it('keeps authored purpose and waiting notices without adding type explanations', () => {
    expect(nodeSummary({ ...base, kind: 'task', reference: 'normalize', description: '  Normalize order dates.  ' })).toBe('Normalize order dates.')
    expect(nodeSummary({ ...base, kind: 'wait', notice: { text: 'Approve the campaign.' } })).toBe('Approve the campaign.')
  })
  it('preserves the description when a trigger has schedule content', () => {
    expect(
      nodeSummary({
        ...base,
        kind: 'trigger',
        description: 'Refresh the report',
        presentation: { kind: 'cron', schedules: [{ type: 'every', value: 2, unit: 'day' }] },
      }),
    ).toBe('Refresh the report')
  })
  it('keeps a condition purpose in the card body and puts each rule on its branch', () => {
    const node = {
      ...base,
      kind: 'condition' as const,
      description: 'Route qualified applications.',
      cases: [
        {
          expressions: [
            { input: 'score', operator: '>=' as const, value: 80 },
            { input: 'active', operator: 'is true' as const },
          ],
          output: 'qualified',
          relation: 'all' as const,
        },
      ],
      defaultOutput: 'review',
    }
    const t = createI18n('en').t
    expect(nodeSummary(node)).toBe('Route qualified applications.')
    expect(conditionBranchSummary(node, 'qualified', t)).toBe('score ≥ 80 ∧ active is true')
    expect(conditionBranchSummary(node, 'review', t)).toBe('Default')
    expect(conditionBranchSummary(node, 'unused', t)).toBe('')
  })
  it('recognizes raster outputs and signed image URLs without treating artifact IDs as links', () => {
    expect(
      imageSources({
        outputs: ['https://example.com/report.png?token=sample', 'https://example.com/page'],
        artifact: { mediaType: 'image/png', id: 'artifact-1' },
        signed: { mediaType: 'image/webp', url: 'https://example.com/download?id=2' },
      }),
    ).toEqual(['https://example.com/report.png?token=sample', 'https://example.com/download?id=2'])
  })
  it('rejects executable and local URL schemes and bounds cyclic output traversal', () => {
    const value: Record<string, unknown> = { mediaType: 'image/png', url: 'javascript:alert(1)', local: 'file:///tmp/image.png', relative: '/image.png' }
    value.self = value
    expect(imageSources(value)).toEqual([])
  })
})
