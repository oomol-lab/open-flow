import type { ManagedTaskExecutor } from '../../../../flow/common/change.ts'

import { describe, expect, it, vi } from 'vitest'
import { AgentChanges } from './agentChanges.ts'

const initial: ManagedTaskExecutor = { kind: 'agent', model: 'test', system: '', prompt: { kind: 'value', value: '' }, maxRounds: 10, tools: [] }

describe('Agent automatic saving', () => {
  it('serializes committed edits and leaves unfinished text out of the next write', async () => {
    let finish: ((value: boolean) => void) | undefined
    const write = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve
          }),
      )
      .mockResolvedValue(true)
    const changes = new AgentChanges(initial, write)
    const first = { ...initial, model: 'first' }
    const second = { ...initial, model: 'second' }
    const unfinished = { ...initial, model: 'typing' }
    changes.value = first
    const saved = changes.save()
    changes.value = second
    void changes.save()
    changes.value = unfinished
    changes.sync(first)
    expect(changes.value).toEqual(unfinished)
    expect(write).toHaveBeenCalledTimes(1)
    if (finish == null) throw new Error('Expected a pending write.')
    finish(true)
    expect(await saved).toBe(true)
    expect(write.mock.calls).toEqual([
      [initial, first],
      [first, second],
    ])
    expect(changes.value).toEqual(unfinished)
    await changes.save()
    expect(write).toHaveBeenLastCalledWith(second, unfinished)
  })

  it.each(['conflict', 'network'])('keeps edits after a %s failure and retries only when requested', async (failure) => {
    const write = vi.fn()
    if (failure == 'network') write.mockRejectedValueOnce(new Error('offline'))
    else write.mockResolvedValueOnce(false)
    write.mockResolvedValue(true)
    const changes = new AgentChanges(initial, write)
    const edited = { ...initial, system: 'Keep this text' }
    changes.value = edited
    if (failure == 'network') await expect(changes.save()).rejects.toThrow('offline')
    else expect(await changes.save()).toBe(false)
    changes.sync({ ...initial, model: 'remote' })
    expect(changes.value).toEqual(edited)
    expect(write).toHaveBeenCalledTimes(1)
    expect(await changes.save()).toBe(true)
    expect(write).toHaveBeenLastCalledWith(initial, edited)
  })

  it('does not drop an edit immediately after an unchanged blur', async () => {
    const write = vi.fn().mockResolvedValue(true)
    const changes = new AgentChanges(initial, write)
    void changes.save()
    changes.value = { ...initial, model: 'changed' }
    await changes.save()
    expect(write).toHaveBeenCalledWith(initial, changes.value)
  })

  it('does not write unchanged values and accepts external changes when clean', async () => {
    const write = vi.fn().mockResolvedValue(true)
    const changes = new AgentChanges(initial, write)
    await changes.save()
    changes.sync({ ...initial, model: 'remote' })
    await changes.save()
    expect(changes.value).toEqual({ ...initial, model: 'remote' })
    expect(write).not.toHaveBeenCalled()
  })
})
