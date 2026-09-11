import { generateTriggerLocales } from '../src/build/node/triggerLocales.ts'

await generateTriggerLocales(undefined, process.argv.includes('--check'))
