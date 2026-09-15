import type { EnvironmentModuleNode, Plugin } from 'vite'

export function fullReloadPlugin(): Plugin {
  return {
    name: 'open-flow-full-reload',
    apply: 'serve',
    hotUpdate({ file, modules, timestamp }) {
      if (this.environment.name != 'client' || modules.length == 0 || !/\.(?:[cm]?[jt]sx?|json)$/.test(file)) return

      // Fast Refresh can preserve stores after effect cleanup has disposed them.
      const invalidated = new Set<EnvironmentModuleNode>()
      for (const module of modules) {
        this.environment.moduleGraph.invalidateModule(module, invalidated, timestamp, true)
      }
      this.environment.hot.send({ type: 'full-reload' })
      return []
    },
  }
}
