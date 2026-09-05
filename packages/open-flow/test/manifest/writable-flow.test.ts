import type { Revision } from '../../src/base/common/revision.ts'
import type { BlockResourceName } from '../../src/manifest/common/manifestTypes.ts'
import type { HandleInputFrom, HandleName, NodeId } from '../../src/schema/index.ts'

import { assert, describe, expect, it } from 'vitest'
import { WritableSubflowNodeManifest } from '../../src/manifest/common/writable/node/writableSubflowNodeManifest.ts'
import { WritableTaskNodeManifest } from '../../src/manifest/common/writable/node/writableTaskNodeManifest.ts'
import { WritableValueNodeManifest } from '../../src/manifest/common/writable/node/writableValueNodeManifest.ts'
import { WritableFlowManifest } from '../../src/manifest/common/writable/writableFlowManifest.ts'

const revision = 'revision-1' as Revision

const source = `title: Example
nodes:
  - node_id: task#1
    task: self::task
  - node_id: value#1
    values:
      - handle: result
        value: 1
  - node_id: subflow#1
    subflow: self::subflow
`

function nodeId(value: string): NodeId {
  return value as NodeId
}

function handleName(value: string): HandleName {
  return value as HandleName
}

function blockResourceName(value: string): BlockResourceName {
  return value as BlockResourceName
}

describe('writable flow manifest', () => {
  it('adds and removes nodes when clean source text is replaced', () => {
    const manifest = new WritableFlowManifest('nodes: []\n', revision)

    manifest.updateSourceText(source)

    expect([...manifest.nodes.keys()]).toEqual([nodeId('task#1'), nodeId('value#1'), nodeId('subflow#1')])

    manifest.updateSourceText(`nodes:
  - node_id: value#1
    values:
      - handle: result
        value: 2
`)

    expect([...manifest.nodes.keys()]).toEqual([nodeId('value#1')])
    expect(manifest.nodes.get(nodeId('task#1'))).toBeUndefined()
    expect(manifest.nodes.get(nodeId('subflow#1'))).toBeUndefined()
    expect(manifest.nodes.get(nodeId('value#1'))?.toJSON()).toEqual({
      node_id: 'value#1',
      values: [{ handle: 'result', value: 2 }],
    })
  })

  it('updates task, value, and subflow node fields and serializes them', async () => {
    const manifest = new WritableFlowManifest(source, revision)
    const task = WritableTaskNodeManifest.to(manifest.nodes.get(nodeId('task#1')))
    const value = WritableValueNodeManifest.to(manifest.nodes.get(nodeId('value#1')))
    const subflow = WritableSubflowNodeManifest.to(manifest.nodes.get(nodeId('subflow#1')))

    assert(task)
    assert(value)
    assert(subflow)
    assert(value.$$.values.value)
    expect(value.$).not.toHaveProperty('timeout')
    expect(value.$).not.toHaveProperty('concurrency')
    expect(value.$).not.toHaveProperty('progress_weight')

    task.$$.title.set('Updated task')
    task.$$.timeout.set(30)
    task.$$.progress_weight.set(3)
    value.$$.title.set('Updated value')
    value.$$.description.set('Static inputs')
    value.$$.values.value.$$.values.set([{ handle: handleName('result'), value: 42 }])
    subflow.$$.title.set('Updated subflow')
    subflow.$$.subflow.set(blockResourceName('self::next-subflow'))
    await Promise.resolve()

    expect(manifest.toJSON()).toEqual({
      title: 'Example',
      nodes: [
        {
          node_id: 'task#1',
          task: 'self::task',
          title: 'Updated task',
          timeout: 30,

          progress_weight: 3,
        },
        {
          node_id: 'value#1',
          values: [{ handle: 'result', value: 42 }],
          title: 'Updated value',
          description: 'Static inputs',
        },
        {
          node_id: 'subflow#1',
          subflow: 'self::next-subflow',
          title: 'Updated subflow',
        },
      ],
    })
    expect(manifest._toSaveFileString()).toContain('subflow: self::next-subflow')
  })

  it('updates input connections and preserves them in serialized YAML', async () => {
    const manifest = new WritableFlowManifest(source, revision)
    const subflow = WritableSubflowNodeManifest.to(manifest.nodes.get(nodeId('subflow#1')))
    const inputsFrom: readonly HandleInputFrom[] = [
      {
        handle: handleName('input'),
        from_node: [{ node_id: nodeId('task#1'), output_handle: handleName('result') }],
      },
      {
        handle: handleName('limit'),
        value: 10,
      },
    ]

    assert(subflow)
    subflow.$$.inputs_from.set(inputsFrom)
    await Promise.resolve()

    expect(subflow.$.inputs_from.value).toEqual(inputsFrom)
    expect(manifest.toJSON()).toEqual({
      title: 'Example',
      nodes: [
        { node_id: 'task#1', task: 'self::task' },
        { node_id: 'value#1', values: [{ handle: 'result', value: 1 }] },
        {
          node_id: 'subflow#1',
          subflow: 'self::subflow',
          inputs_from: [
            {
              handle: 'input',
              from_node: [{ node_id: 'task#1', output_handle: 'result' }],
            },
            { handle: 'limit', value: 10 },
          ],
        },
      ],
    })
    expect(manifest._toSaveFileString()).toContain('output_handle: result')
  })

  it('stops change reactions after disposal', async () => {
    const manifest = new WritableFlowManifest(source, revision)
    const task = WritableTaskNodeManifest.to(manifest.nodes.get(nodeId('task#1')))
    let changes = 0
    manifest.events.on('changed', () => {
      changes += 1
    })

    assert(task)
    task.$$.title.set('Before disposal')
    await Promise.resolve()
    expect(changes).toBeGreaterThan(0)

    const changesBeforeDisposal = changes
    manifest.dispose()
    task.$$.title.set('After disposal')
    await Promise.resolve()

    expect(changes).toBe(changesBeforeDisposal)
  })
})
