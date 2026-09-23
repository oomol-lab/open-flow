import type { TFunction } from 'val-i18n'
import type { TriggerDisplay } from '../../../../control/common/triggerCatalog.ts'
import type { GraphTarget } from '../../../../flow/common/change.ts'
import type { UiLanguage } from '../../../../localization/common/languages.ts'
import type { RevisionView } from '../revisionView.ts'
import type { DiagnosticItem } from './diagnostics.ts'

export function presentTriggerDiagnostics(
  items: readonly DiagnosticItem[],
  revision: RevisionView | undefined,
  target: GraphTarget | undefined,
  displays: Readonly<Record<string, TriggerDisplay>> | undefined,
  language: UiLanguage,
  t: TFunction,
): readonly DiagnosticItem[] {
  if (revision == null || target == null) return items
  return items.map((item) => {
    if (item.diagnostic.code != 'trigger.config-incomplete' || item.location == null) return item
    const node = revision.node(target, item.location.nodeId)?.node
    if (node?.kind != 'integration' && node?.kind != 'poll') return item
    const labels = displays?.[node.definition.key]?.configInputLabels
    const names = item.diagnostic.fields?.map((field) => labels?.[field])
    const message =
      names != null && names.length > 0 && names.every((name): name is string => name != null)
        ? t('diagnostics.messages.trigger.config-incomplete-fields', { fields: new Intl.ListFormat(language, { type: 'conjunction' }).format(names) })
        : t('diagnostics.messages.trigger.config-incomplete')
    return { ...item, message }
  })
}
