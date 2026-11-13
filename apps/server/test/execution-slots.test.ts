import { expect, it } from 'vitest'
import { ExecutionSlots } from '../node/application/execution-slots.ts'

const signal = new AbortController().signal

async function settles(promise: Promise<void>): Promise<boolean> {
  return await Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20))])
}

it('lends a permit until every overlapping child wait of one invocation has resumed', async () => {
  const slots = new ExecutionSlots(1)
  await slots.acquire('parent', 'job', signal)
  slots.suspend('parent', 'job')
  slots.suspend('parent', 'job')

  // One child call returning early must not reclaim the permit while its sibling still waits.
  await slots.resume('parent', 'job', signal)
  expect(await settles(slots.acquire('child', 'job', signal))).toBe(true)

  const resumed = slots.resume('parent', 'job', signal)
  expect(await settles(resumed)).toBe(false)
  slots.release('child', 'job')
  expect(await settles(resumed)).toBe(true)
  expect(await settles(slots.acquire('other', 'job', signal))).toBe(false)
})

it('drops a queued admission when its invocation ends', async () => {
  const slots = new ExecutionSlots(1)
  await slots.acquire('holder', 'job', signal)
  const queued = slots.acquire('waiting', 'job', signal)
  slots.release('waiting', 'job')
  await expect(queued).rejects.toThrow()
  slots.release('holder', 'job')
  expect(await settles(slots.acquire('next', 'job', signal))).toBe(true)
})

it('returns a permit that arrives after its lease lent itself out', async () => {
  const slots = new ExecutionSlots(1)
  await slots.acquire('holder', 'job', signal)
  const racer = slots.acquire('racer', 'job', signal)
  slots.suspend('racer', 'job')
  slots.release('holder', 'job')
  expect(await settles(racer)).toBe(true)
  expect(await settles(slots.acquire('next', 'job', signal))).toBe(true)
})
