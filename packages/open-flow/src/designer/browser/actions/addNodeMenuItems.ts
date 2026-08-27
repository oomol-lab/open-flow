import type { I18n } from 'val-i18n'
import type { HandleName } from '../../../schema/index.ts'
import type { AddNodeBlockItem } from '../../common/packageAuthoring.ts'
import type { IAddNodeMenuItem, IFromSource } from '../stores/designer/designer.store.ts'

import { CONDITION_BLOCK_ICON } from '../../../manifest/common/meta/block/conditionBlockMeta.ts'
import { VALUE_BLOCK_ICON } from '../../../manifest/common/meta/block/valueBlockMeta.ts'

const COMMENT_NODE_ICON = ':codicon:note:'
const LLM_NODE_ICON = ':carbon:machine-learning-model:'

function handle(value: string): HandleName {
  return value as HandleName
}

export function provideAddNodeMenuItems(
  i18n: I18n,
  blocks: readonly AddNodeBlockItem[],
  fromSource?: IFromSource,
  canWriteScriptlets: boolean = true,
): IAddNodeMenuItem[] {
  const items: IAddNodeMenuItem[] = []
  if (canWriteScriptlets) {
    items.push({ type: 'scriptlet', data: 'typescript', label: 'TypeScript' }, { type: 'scriptlet', data: 'javascript', label: 'JavaScript' })
  }
  items.push(
    { type: 'llm', data: 'chat', label: i18n.t('addNode.llmChat'), icon: LLM_NODE_ICON },
    { type: 'llm', data: 'json', label: i18n.t('addNode.llmStructured'), icon: LLM_NODE_ICON },
  )
  items.push(
    { type: 'value', label: i18n.t('addNode.value'), icon: VALUE_BLOCK_ICON },
    { type: 'condition', label: i18n.t('addNode.condition'), icon: CONDITION_BLOCK_ICON },
  )
  items.push({
    type: 'comment',
    label: i18n.t('addNode.comment'),
    icon: COMMENT_NODE_ICON,
  })
  if (fromSource) {
    for (const item of items) {
      if (item.type === 'scriptlet') {
        // const name = fromSource.side === "left" ? "output" : "input";
        item.handles = [{ name: fromSource.handle, json_schema: {} }]
      } else if (item.type === 'llm') {
        item.handles = [
          {
            name: fromSource.side === 'left' ? handle('output') : handle('input'),
            json_schema: { type: 'string' },
          },
        ]
      }
    }
  }

  const appendDivider = (label: string, detail?: string) => {
    items.push({ type: 'divider', label, detail })
  }
  appendDivider(i18n.t('addNode.sharedBlocks'), 'Shared Blocks')
  for (const block of blocks) {
    items.push({
      type: 'block',
      data: block.path,
      icon: block.icon,
      label: block.title || block.name,
      detail: block.detail,
      description: block.description,
      handles: fromSource ? (fromSource.side === 'left' ? block.output_handles : block.input_handles) : undefined,
    })
  }

  return items
}
