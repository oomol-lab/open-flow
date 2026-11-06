import { compactLayout } from '../src/canvas/browser/base/compactLayout.ts'
import { graphLayout } from '../src/canvas/browser/base/graphLayout.ts'

const results = []
for (const count of [50, 200, 1000]) {
  const nodes = Array.from({ length: count }, (_, index) => ({ id: String(index), width: 336, height: 92 + (index % 3) * 20 }))
  const edges = Array.from({ length: count - 1 }, (_, index) => ({ id: String(index), source: String(index), target: String(index + 1) }))
  const start = performance.now()
  const graph = graphLayout(nodes, edges, 'vertical')
  const dagre = performance.now() - start
  const samples = []
  let result
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = performance.now()
    result = compactLayout(graph)
    samples.push(performance.now() - started)
  }
  results.push({
    nodes: count,
    dagreMs: Math.round(dagre),
    compactMs: Math.round(samples.toSorted((a, b) => a - b)[1]!),
    width: Math.ceil(result!.bounds.width),
    height: Math.ceil(result!.bounds.height),
  })
}
console.table(results)
