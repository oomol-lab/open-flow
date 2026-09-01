import { providerIconsPlugin } from '@oomol-lab/open-flow/provider-icons-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [providerIconsPlugin({ iconUrls: {} })],
  test: {
    coverage: {
      include: [
        'node/connector.ts',
        'node/control-service.ts',
        'node/integration-runtime.ts',
        'node/isolated-vm.ts',
        'node/service.ts',
        'node/store.ts',
        'node/trigger-store.ts',
      ],
      provider: 'v8',
      reporter: ['text'],
      thresholds: { branches: 70, functions: 80, lines: 80 },
    },
    testTimeout: 30_000,
  },
})
