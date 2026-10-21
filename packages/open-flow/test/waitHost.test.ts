import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { advanceWaiting } from './waitHost.ts'

it('settles after repeated fiber yields and advances the execution budget with Effect time', async () => {
  const originalNow = performance.now
  const result = await advanceWaiting(
    Effect.gen(function* () {
      for (let index = 0; index < 20; index++) yield* Effect.yieldNow
      const started = performance.now()
      yield* Effect.sleep(90)
      return { kind: 'node-results' as const, nodes: [], outputs: { elapsed: performance.now() - started } }
    }),
  )
  expect(result).toMatchObject({ kind: 'node-results', outputs: { elapsed: 90 } })
  expect(performance.now).toBe(originalNow)
})

it('propagates failures and restores the monotonic clock', async () => {
  const originalNow = performance.now
  await expect(advanceWaiting(Effect.sleep(10).pipe(Effect.andThen(Effect.fail(new Error('failed')))))).rejects.toThrow('failed')
  expect(performance.now).toBe(originalNow)
})

it('bounds a never-settling effect and restores the monotonic clock', async () => {
  const originalNow = performance.now
  let interrupted = false
  const effect = Effect.never.pipe(
    Effect.ensuring(
      Effect.sync(() => {
        interrupted = true
      }),
    ),
  )
  await expect(advanceWaiting(effect)).rejects.toThrow('Scheduler did not settle with the controlled clock.')
  expect(interrupted).toBe(true)
  expect(performance.now).toBe(originalNow)
})
