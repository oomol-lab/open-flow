import type { Presentation } from '../api.ts'

import { expect, it, vi } from 'vitest'
import { ApiError, WorkbenchClient } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { Latest } from './latest.ts'
import { PresentationChanges } from './presentationChanges.ts'

const initial: Presentation = { revision: 1, updatedAt: '2026-10-13T00:00:00.000Z', value: {}, version: 1 }

function session() {
  const client = new WorkbenchClient(vi.fn())
  const i18n = createI18n()
  const latest = new Latest()
  const notice = vi.fn()
  let presentation = initial
  const changes = new PresentationChanges(
    client,
    notice,
    (saved) => {
      presentation = saved
    },
    i18n,
  )
  changes.reset(initial)
  return {
    client,
    latest,
    notice,
    changes,
    presentation: () => presentation,
    dispose: () => {
      changes.dispose()
      i18n.dispose()
    },
  }
}

it('waits for all queued Presentation writes, including changes submitted while export is waiting', async () => {
  const { client, latest, changes, presentation, dispose } = session()
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  const update = vi.spyOn(client, 'updatePresentation').mockImplementation(async (_id, revision, value) => {
    await (revision == 1 ? first.promise : second.promise)
    return { ...initial, revision: revision + 1, value }
  })
  try {
    const a = changes.change('flow', presentation(), latest.capture(), (value) => ({ ...value, first: true }))
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
    let flushed = false
    const flushing = changes.flush().then((success) => {
      flushed = true
      return success
    })
    const b = changes.change('flow', presentation(), latest.capture(), (value) => ({ ...value, second: true }))
    first.resolve()
    await a
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(flushed).toBe(false)
    second.resolve()
    expect(await b).toBe(true)
    expect(await flushing).toBe(true)
    expect(presentation().value).toEqual({ first: true, second: true })
  } finally {
    first.resolve()
    second.resolve()
    dispose()
  }
})

it('does not let a late failure from a previous Flow poison the new Flow save status', async () => {
  const { client, latest, notice, changes, presentation, dispose } = session()
  const response = Promise.withResolvers<Presentation>()
  const update = vi.spyOn(client, 'updatePresentation').mockReturnValue(response.promise)
  try {
    const saving = changes.change('previous', presentation(), latest.capture(), () => ({ old: true }))
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
    latest.invalidate()
    changes.reset(initial)
    response.reject(new Error('Previous Flow failed'))
    expect(await saving).toBe(false)
    expect(await changes.flush()).toBe(true)
    expect(notice).not.toHaveBeenCalled()
  } finally {
    dispose()
  }
})

it('blocks export after a current save failure until the authoritative Presentation is reloaded', async () => {
  const { client, latest, changes, presentation, dispose } = session()
  vi.spyOn(client, 'updatePresentation').mockRejectedValue(new Error('Save failed'))
  try {
    expect(await changes.change('flow', presentation(), latest.capture(), () => ({ edited: true }))).toBe(false)
    expect(await changes.flush()).toBe(false)
    changes.reset(initial)
    expect(await changes.flush()).toBe(true)
  } finally {
    dispose()
  }
})

it('clears a failed save after a later successful write', async () => {
  const { client, latest, changes, presentation, dispose } = session()
  vi.spyOn(client, 'updatePresentation')
    .mockRejectedValueOnce(new Error('Save failed'))
    .mockImplementation(async (_id, revision, value) => ({ ...initial, revision: revision + 1, value }))
  vi.spyOn(client, 'getPresentation').mockResolvedValue(initial)
  try {
    expect(await changes.change('flow', presentation(), latest.capture(), () => ({ edited: true }))).toBe(false)
    expect(await changes.flush()).toBe(false)
    expect(await changes.change('flow', presentation(), latest.capture(), () => ({ edited: true }))).toBe(true)
    expect(await changes.flush()).toBe(true)
  } finally {
    dispose()
  }
})

it('keeps export blocked when a queued undo is a no-op after a conflict reload fails', async () => {
  const { client, latest, changes, presentation, dispose } = session()
  const response = Promise.withResolvers<Presentation>()
  const update = vi.spyOn(client, 'updatePresentation').mockReturnValue(response.promise)
  vi.spyOn(client, 'getPresentation').mockRejectedValue(new Error('Reload failed'))
  try {
    const saving = changes.change('flow', presentation(), latest.capture(), () => ({ edited: true }))
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
    const undoing = changes.change('flow', presentation(), latest.capture(), () => initial.value)
    response.reject(new ApiError(409, 'flow.presentation-conflict', 'Conflict'))
    expect(await saving).toBe(false)
    expect(await undoing).toBe(true)
    expect(update).toHaveBeenCalledOnce()
    expect(presentation().value).toEqual(initial.value)
    expect(await changes.flush()).toBe(false)
    changes.reset(initial)
    expect(await changes.flush()).toBe(true)
  } finally {
    dispose()
  }
})
