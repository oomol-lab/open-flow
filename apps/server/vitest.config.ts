import { providerIconsPlugin } from '@oomol-lab/open-flow/provider-icons-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [providerIconsPlugin({ iconUrls: {} })],
  test: {
    coverage: {
      include: [
        'node/deployment/connector.ts',
        'node/application/control-service.ts',
        'node/application/cron-driver.ts',
        'node/application/flow-validation.ts',
        'node/application/maintenance.ts',
        'node/application/service-options.ts',
        'node/runtime/integration-runtime.ts',
        'node/runtime/isolated-vm.ts',
        'node/application/service.ts',
        'node/application/supervisor.ts',
        'node/application/wait-actions.ts',
        'node/application/webhook-targets.ts',
        'node/application/run.ts',
        'node/application/publication.ts',
        'node/storage/store.ts',
        'node/storage/trigger-store.ts',
      ],
      provider: 'v8',
      reporter: ['text'],
      thresholds: { branches: 70, functions: 80, lines: 80 },
    },
    testTimeout: 30_000,
  },
})
