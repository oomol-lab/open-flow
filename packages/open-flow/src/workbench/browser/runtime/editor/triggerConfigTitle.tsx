import { useTranslate } from 'val-i18n-react'

export function TriggerConfigTitle() {
  const t = useTranslate()
  return (
    <>
      <i aria-hidden="true" className="i-carbon:power -rotate-90 text-base" />
      {t('triggerConfig.configuration')}
    </>
  )
}
