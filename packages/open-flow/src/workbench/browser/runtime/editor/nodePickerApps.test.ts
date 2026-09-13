import { describe, expect, it } from 'vitest'
import { comparePickerApps, pickerConnectionPriorities } from './nodePickerApps.ts'

const account = (serviceId: string, connectionId: string, builtInAccount = false, status: 'active' | 'disconnected' = 'active') => ({
  serviceId,
  connectionId,
  builtInAccount,
  status,
  displayName: serviceId,
  isDefault: false,
})

describe('picker app order', () => {
  it('prioritizes active connections before Chinese names and natural name order within each group', () => {
    const apps = [
      { label: 'App 10' },
      { label: '企业微信', priority: 3 },
      { label: 'Gmail', priority: 0 },
      { label: '17TRACK' },
      { label: '飞书', priority: 0 },
      { label: 'App 2', priority: 3 },
      { label: '钉钉' },
    ]
    expect(apps.toSorted(comparePickerApps).map((app) => app.label)).toEqual(['飞书', 'Gmail', '钉钉', '企业微信', '17TRACK', 'App 2', 'App 10'])
  })
})

it('classifies active accounts independently of response order', () => {
  const connections = [
    account('mixed', 'built-in', true),
    account('mixed', 'personal'),
    account('built-in', 'marketplace', true),
    account('free', 'no_auth:free'),
    account('offline', 'old', false, 'disconnected'),
  ]
  for (const items of [connections, connections.toReversed()]) {
    const priorities = pickerConnectionPriorities(items)
    expect(priorities.get('mixed')).toBe(0)
    expect(priorities.get('built-in')).toBe(1)
    expect(priorities.get('free')).toBe(2)
    expect(priorities.has('offline')).toBe(false)
  }
  expect(
    [{ label: '未配置' }, { label: '免配置', priority: 2 }, { label: '内置', priority: 1 }, { label: 'Z connected', priority: 0 }]
      .toSorted(comparePickerApps)
      .map((item) => item.label),
  ).toEqual(['Z connected', '内置', '免配置', '未配置'])
})
