import { render } from 'agentic-markdown'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const resources = {
  'SKILL.md': import.meta.resolve('@oomol-lab/open-flow/skills/open-flow/SKILL.md'),
  'references/flow-authoring.md': import.meta.resolve('@oomol-lab/open-flow/skills/open-flow/references/flow-authoring.md'),
  'references/flow-n8n-conversion.md': import.meta.resolve('@oomol-lab/open-flow/skills/open-flow/references/flow-n8n-conversion.md'),
}

export async function generateSkill(directory: string): Promise<void> {
  const rendered = await Promise.all(
    Object.entries(resources).map(async ([name, url]) => ({
      name,
      content: render(await readFile(fileURLToPath(url), 'utf8'), { flowCommand: 'bun run flow --', localDevelopment: 'true' }),
    })),
  )
  await rm(directory, { recursive: true, force: true })
  for (const { name, content } of rendered) {
    const target = path.join(directory, name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

if (import.meta.main) {
  const directory = path.resolve(import.meta.dirname, '../../../.agents/skills/open-flow')
  await generateSkill(directory)
  process.stdout.write(`Generated ${directory}\n`)
}
