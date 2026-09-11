import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateTriggerLocales } from '../src/build/node/triggerLocales.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'trigger-locales-'))
  roots.push(root)
  return root
}
async function add(root: string, provider: string, locale: string) {
  const directory = path.join(root, provider, 'locales')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, `${locale}.json`), '{}\n')
}

describe('Trigger locale discovery', () => {
  it('discovers added provider resources and removes deleted resources without editing indexes', async () => {
    const root = await setup()
    await add(root, 'first', 'zh-CN')
    await generateTriggerLocales(root)
    expect(await readFile(path.join(root, 'locales/zh-CN.ts'), 'utf8')).toContain('../first/locales/zh-CN.json')
    await add(root, 'second', 'zh-CN')
    await add(root, 'second', 'ja')
    await expect(generateTriggerLocales(root, true)).rejects.toThrow('stale')
    await generateTriggerLocales(root)
    const chinese = await readFile(path.join(root, 'locales/zh-CN.ts'), 'utf8')
    expect(chinese).toContain('../second/locales/zh-CN.json')
    expect(chinese).not.toContain('/ja.json')
    await rm(path.join(root, 'first'), { recursive: true })
    await generateTriggerLocales(root)
    expect(await readFile(path.join(root, 'locales/zh-CN.ts'), 'utf8')).not.toContain('../first/')
    await expect(generateTriggerLocales(root, true)).resolves.toBeUndefined()
  })

  it('does not rewrite unchanged indexes or mutate files during a stale check', async () => {
    const root = await setup()
    await generateTriggerLocales(root)
    const target = path.join(root, 'locales/fr.ts')
    const original = await stat(target)
    await generateTriggerLocales(root)
    expect((await stat(target)).mtimeMs).toBe(original.mtimeMs)
    await add(root, 'provider', 'fr')
    await expect(generateTriggerLocales(root, true)).rejects.toThrow('stale')
    expect((await stat(target)).mtimeMs).toBe(original.mtimeMs)
  })
})
