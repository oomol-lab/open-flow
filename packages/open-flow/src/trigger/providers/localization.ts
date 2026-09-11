import type { TriggerDisplay } from '../../control/common/triggerCatalog.ts'
import type { TriggerKeySnapshot } from '../../flow/common/change.ts'
import type { UiLanguage } from '../../localization/common/languages.ts'

import airtable_fr from './airtable/locales/fr.json'
import airtable_ja from './airtable/locales/ja.json'
import airtable_ko from './airtable/locales/ko.json'
import airtable_ru from './airtable/locales/ru.json'
import airtable_zh_CN from './airtable/locales/zh-CN.json'
import airtable_zh_TW from './airtable/locales/zh-TW.json'
import github_fr from './github/locales/fr.json'
import github_ja from './github/locales/ja.json'
import github_ko from './github/locales/ko.json'
import github_ru from './github/locales/ru.json'
import github_zh_CN from './github/locales/zh-CN.json'
import github_zh_TW from './github/locales/zh-TW.json'
import gitlab_fr from './gitlab/locales/fr.json'
import gitlab_ja from './gitlab/locales/ja.json'
import gitlab_ko from './gitlab/locales/ko.json'
import gitlab_ru from './gitlab/locales/ru.json'
import gitlab_zh_CN from './gitlab/locales/zh-CN.json'
import gitlab_zh_TW from './gitlab/locales/zh-TW.json'
import gmail_fr from './gmail/locales/fr.json'
import gmail_ja from './gmail/locales/ja.json'
import gmail_ko from './gmail/locales/ko.json'
import gmail_ru from './gmail/locales/ru.json'
import gmail_zh_CN from './gmail/locales/zh-CN.json'
import gmail_zh_TW from './gmail/locales/zh-TW.json'
import google_calendar_fr from './google-calendar/locales/fr.json'
import google_calendar_ja from './google-calendar/locales/ja.json'
import google_calendar_ko from './google-calendar/locales/ko.json'
import google_calendar_ru from './google-calendar/locales/ru.json'
import google_calendar_zh_CN from './google-calendar/locales/zh-CN.json'
import google_calendar_zh_TW from './google-calendar/locales/zh-TW.json'
import google_drive_fr from './google-drive/locales/fr.json'
import google_drive_ja from './google-drive/locales/ja.json'
import google_drive_ko from './google-drive/locales/ko.json'
import google_drive_ru from './google-drive/locales/ru.json'
import google_drive_zh_CN from './google-drive/locales/zh-CN.json'
import google_drive_zh_TW from './google-drive/locales/zh-TW.json'
import google_sheets_fr from './google-sheets/locales/fr.json'
import google_sheets_ja from './google-sheets/locales/ja.json'
import google_sheets_ko from './google-sheets/locales/ko.json'
import google_sheets_ru from './google-sheets/locales/ru.json'
import google_sheets_zh_CN from './google-sheets/locales/zh-CN.json'
import google_sheets_zh_TW from './google-sheets/locales/zh-TW.json'
import linear_fr from './linear/locales/fr.json'
import linear_ja from './linear/locales/ja.json'
import linear_ko from './linear/locales/ko.json'
import linear_ru from './linear/locales/ru.json'
import linear_zh_CN from './linear/locales/zh-CN.json'
import linear_zh_TW from './linear/locales/zh-TW.json'
import notion_fr from './notion/locales/fr.json'
import notion_ja from './notion/locales/ja.json'
import notion_ko from './notion/locales/ko.json'
import notion_ru from './notion/locales/ru.json'
import notion_zh_CN from './notion/locales/zh-CN.json'
import notion_zh_TW from './notion/locales/zh-TW.json'
import one_drive_fr from './one-drive/locales/fr.json'
import one_drive_ja from './one-drive/locales/ja.json'
import one_drive_ko from './one-drive/locales/ko.json'
import one_drive_ru from './one-drive/locales/ru.json'
import one_drive_zh_CN from './one-drive/locales/zh-CN.json'
import one_drive_zh_TW from './one-drive/locales/zh-TW.json'
import outlook_fr from './outlook/locales/fr.json'
import outlook_ja from './outlook/locales/ja.json'
import outlook_ko from './outlook/locales/ko.json'
import outlook_ru from './outlook/locales/ru.json'
import outlook_zh_CN from './outlook/locales/zh-CN.json'
import outlook_zh_TW from './outlook/locales/zh-TW.json'
import shopify_fr from './shopify/locales/fr.json'
import shopify_ja from './shopify/locales/ja.json'
import shopify_ko from './shopify/locales/ko.json'
import shopify_ru from './shopify/locales/ru.json'
import shopify_zh_CN from './shopify/locales/zh-CN.json'
import shopify_zh_TW from './shopify/locales/zh-TW.json'
import slack_fr from './slack/locales/fr.json'
import slack_ja from './slack/locales/ja.json'
import slack_ko from './slack/locales/ko.json'
import slack_ru from './slack/locales/ru.json'
import slack_zh_CN from './slack/locales/zh-CN.json'
import slack_zh_TW from './slack/locales/zh-TW.json'
import stripe_fr from './stripe/locales/fr.json'
import stripe_ja from './stripe/locales/ja.json'
import stripe_ko from './stripe/locales/ko.json'
import stripe_ru from './stripe/locales/ru.json'
import stripe_zh_CN from './stripe/locales/zh-CN.json'
import stripe_zh_TW from './stripe/locales/zh-TW.json'
import telegram_fr from './telegram/locales/fr.json'
import telegram_ja from './telegram/locales/ja.json'
import telegram_ko from './telegram/locales/ko.json'
import telegram_ru from './telegram/locales/ru.json'
import telegram_zh_CN from './telegram/locales/zh-CN.json'
import telegram_zh_TW from './telegram/locales/zh-TW.json'
import woocommerce_fr from './woocommerce/locales/fr.json'
import woocommerce_ja from './woocommerce/locales/ja.json'
import woocommerce_ko from './woocommerce/locales/ko.json'
import woocommerce_ru from './woocommerce/locales/ru.json'
import woocommerce_zh_CN from './woocommerce/locales/zh-CN.json'
import woocommerce_zh_TW from './woocommerce/locales/zh-TW.json'
import zendesk_fr from './zendesk/locales/fr.json'
import zendesk_ja from './zendesk/locales/ja.json'
import zendesk_ko from './zendesk/locales/ko.json'
import zendesk_ru from './zendesk/locales/ru.json'
import zendesk_zh_CN from './zendesk/locales/zh-CN.json'
import zendesk_zh_TW from './zendesk/locales/zh-TW.json'

export const triggerTranslations: Readonly<Record<Exclude<UiLanguage, 'en'>, Readonly<Record<string, Partial<TriggerDisplay>>>>> = {
  'zh-CN': {
    ...airtable_zh_CN,
    ...gmail_zh_CN,
    ...github_zh_CN,
    ...gitlab_zh_CN,
    ...google_calendar_zh_CN,
    ...google_drive_zh_CN,
    ...google_sheets_zh_CN,
    ...linear_zh_CN,
    ...notion_zh_CN,
    ...one_drive_zh_CN,
    ...outlook_zh_CN,
    ...shopify_zh_CN,
    ...slack_zh_CN,
    ...stripe_zh_CN,
    ...telegram_zh_CN,
    ...woocommerce_zh_CN,
    ...zendesk_zh_CN,
  },
  'zh-TW': {
    ...airtable_zh_TW,
    ...gmail_zh_TW,
    ...github_zh_TW,
    ...gitlab_zh_TW,
    ...google_calendar_zh_TW,
    ...google_drive_zh_TW,
    ...google_sheets_zh_TW,
    ...linear_zh_TW,
    ...notion_zh_TW,
    ...one_drive_zh_TW,
    ...outlook_zh_TW,
    ...shopify_zh_TW,
    ...slack_zh_TW,
    ...stripe_zh_TW,
    ...telegram_zh_TW,
    ...woocommerce_zh_TW,
    ...zendesk_zh_TW,
  },
  'ja': {
    ...airtable_ja,
    ...gmail_ja,
    ...github_ja,
    ...gitlab_ja,
    ...google_calendar_ja,
    ...google_drive_ja,
    ...google_sheets_ja,
    ...linear_ja,
    ...notion_ja,
    ...one_drive_ja,
    ...outlook_ja,
    ...shopify_ja,
    ...slack_ja,
    ...stripe_ja,
    ...telegram_ja,
    ...woocommerce_ja,
    ...zendesk_ja,
  },
  'ko': {
    ...airtable_ko,
    ...gmail_ko,
    ...github_ko,
    ...gitlab_ko,
    ...google_calendar_ko,
    ...google_drive_ko,
    ...google_sheets_ko,
    ...linear_ko,
    ...notion_ko,
    ...one_drive_ko,
    ...outlook_ko,
    ...shopify_ko,
    ...slack_ko,
    ...stripe_ko,
    ...telegram_ko,
    ...woocommerce_ko,
    ...zendesk_ko,
  },
  'ru': {
    ...airtable_ru,
    ...gmail_ru,
    ...github_ru,
    ...gitlab_ru,
    ...google_calendar_ru,
    ...google_drive_ru,
    ...google_sheets_ru,
    ...linear_ru,
    ...notion_ru,
    ...one_drive_ru,
    ...outlook_ru,
    ...shopify_ru,
    ...slack_ru,
    ...stripe_ru,
    ...telegram_ru,
    ...woocommerce_ru,
    ...zendesk_ru,
  },
  'fr': {
    ...airtable_fr,
    ...gmail_fr,
    ...github_fr,
    ...gitlab_fr,
    ...google_calendar_fr,
    ...google_drive_fr,
    ...google_sheets_fr,
    ...linear_fr,
    ...notion_fr,
    ...one_drive_fr,
    ...outlook_fr,
    ...shopify_fr,
    ...slack_fr,
    ...stripe_fr,
    ...telegram_fr,
    ...woocommerce_fr,
    ...zendesk_fr,
  },
}

export function localizeTrigger(definition: TriggerKeySnapshot, locale: UiLanguage): TriggerDisplay {
  const copy = locale == 'en' ? undefined : triggerTranslations[locale][definition.key]
  return { displayName: copy?.displayName ?? definition.displayName, description: copy?.description ?? definition.description }
}
