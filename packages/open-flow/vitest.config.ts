import { defineConfig } from 'vitest/config'
import { providerIconsPlugin } from './src/build/node/providerIcons.ts'
import { twemojiCollectionPlugin } from './src/build/node/twemojiCollection.ts'

export default defineConfig({
  plugins: [providerIconsPlugin({ iconUrls: { github: 'https://static.oomol.com/logo/third-party/github.svg' } }), twemojiCollectionPlugin()],
  test: {
    coverage: {
      include: [
        'src/execution/common/events.ts',
        'src/execution/common/scheduler.ts',
        'src/flow/common/change.ts',
        'src/flow/common/encoding.ts',
        'src/flow/common/semantics.ts',
        'src/manifest/common/schemaCompare.ts',
        'src/manifest/common/schemaComparer.ts',
        'src/trigger/providers/google-drive/changes.ts',
        'src/trigger/providers/slack/on-message-posted.ts',
        'src/trigger/providers/telegram/on-update.ts',
      ],
      provider: 'v8',
      reporter: ['text'],
      thresholds: { branches: 70, functions: 80, lines: 80 },
    },
  },
})
