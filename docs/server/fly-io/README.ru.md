# Развёртывание на Fly.io

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow Server может работать на Fly.io как Node Docker runtime. Этот deployment использует
`apps/server/Dockerfile` из репозитория, конфигурацию Fly app в `fly.toml` в корне репозитория и Fly
volume, смонтированный в `/data/open-flow`. Fly обеспечивает терминацию TLS, удалённые сборки Docker,
health check, rolling deploy и опциональные custom domain.

Граница deployment та же, что и в [справочнике по доставке контейнера](../container-delivery.md):
одна machine Server и один writer SQLite. Никогда не запускайте больше одной machine.

## Предварительные требования

- Аккаунт Fly.io.
- Установленный `flyctl`, авторизованный через `fly auth login`.
- Docker, доступный локально, или Fly remote builder. `apps/server/Dockerfile` использует синтаксис
  BuildKit, который remote builder поддерживают.

## Создание app

Создайте Fly app, пока не развёртывая его:

```bash
fly apps create my-open-flow
```

Имена Fly app глобально уникальны. Если вы выбрали другое имя, обновите поле `app` в `fly.toml`
перед развёртыванием:

```toml
app = "my-open-flow"
```

## Создание постоянного хранилища

Образ хранит SQLite в `/data/open-flow`. Создайте Fly volume с тем же именем source, что и в
`fly.toml`:

```bash
fly volumes create open_flow_data \
  --region iad \
  --size 1 \
  --app my-open-flow
```

История Run и RunEvent растут со временем. Увеличьте `--size`, если ожидаете много Run, или расширьте
volume позже с помощью `fly volumes extend`.

## Настройка secrets

Operator token должен содержать не менее 32 байт UTF-8. Храните его как Fly secret, а не коммитьте
в `fly.toml`:

```bash
OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"

fly secrets set \
  OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  --app my-open-flow
```

Храните `OPEN_FLOW_TOKEN` в менеджере паролей. То же значение используется для входа в Workbench и
работает как Bearer token для Control API.

`fly.toml` уже устанавливает `OPEN_FLOW_SESSION_COOKIE_SECURE` в `true`: `force_https` перенаправляет
обычные HTTP-запросы, поэтому браузеры обращаются к Server только по TLS.

Задайте secrets Connector, когда вам нужен Connector:

```bash
fly secrets set \
  OPEN_FLOW_CONNECTOR_ORIGIN="https://connector.example.com" \
  OPEN_FLOW_CONNECTOR_TOKEN="replace-with-a-scoped-runtime-token" \
  OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN="https://connector.example.com" \
  --app my-open-flow
```

Когда OpenConnector работает в той же организации Fly, runtime origin может использовать приватную
сеть Fly, например `http://my-open-connector.internal:3000`. Console origin по-прежнему должен быть
публичным HTTPS origin, который могут открыть браузеры пользователей.

Задайте callback origin и ключ, когда вам нужны Provider Integration:

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://my-open-flow.fly.dev" \
  OPEN_FLOW_INTEGRATION_CALLBACK_KEY="$(openssl rand -hex 32)" \
  --app my-open-flow
```

`fly secrets set` повторно развёртывает machine. Полный список переменных окружения и ограничения
для каждого origin см. в [справочнике по доставке контейнера](../container-delivery.md#4-配置).

## Развёртывание

Выполните развёртывание из корня репозитория:

```bash
fly deploy --config fly.toml --remote-only --ha=false
```

`--ha=false` не даёт Fly создать вторую machine для нового app. Server допускает одного writer
SQLite, и каждая machine монтирует собственный volume, поэтому две machine хранили бы две несвязанные
копии состояния. Сохраняйте число machine равным одной при каждом последующем развёртывании и
никогда не увеличивайте его через `fly scale count`.

Конфигурация Fly использует:

- `apps/server/Dockerfile` для сборки образа, с корнем репозитория в качестве build context.
- `internal_port = 3000`, значение по умолчанию для образа.
- `GET /readyz` в качестве HTTP health check. Он возвращает 503, пока Server запускается, когда
  фоновая обработка остановлена или когда настроенный Connector недоступен; после этого Fly перестаёт
  направлять трафик на machine и завершает развёртывание с ошибкой. Замените путь на `/healthz`, если
  вам нужна только liveness-проверка.
- `kill_signal = "SIGTERM"` и `kill_timeout = "45s"`. Server ждёт до 30 секунд, чтобы завершить Run и
  закрыть SQLite, поэтому grace period должен превышать 30 секунд.
- `auto_stop_machines = "off"` и `min_machines_running = 1`. Cron и Poll Trigger срабатывают, только
  пока machine работает.

## Проверка runtime

```bash
curl https://my-open-flow.fly.dev/healthz
curl https://my-open-flow.fly.dev/readyz
```

Ожидаемые ответы: `{"status":"ok"}` и `{"status":"ready"}`. Откройте `https://my-open-flow.fly.dev`
и войдите в Workbench, указав `OPEN_FLOW_TOKEN`.

Просматривайте логи при диагностике проблем с развёртыванием или запуском:

```bash
fly logs --app my-open-flow
```

## Custom domain

Зарегистрируйте домен в Fly:

```bash
fly certs add flow.example.com --app my-open-flow
```

Fly выведет DNS-записи, которые нужно создать. Когда DNS будет готов, проверьте состояние
сертификата:

```bash
fly certs check flow.example.com --app my-open-flow
```

Если настроены Integration callback, направьте `OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN` на новый домен:

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://flow.example.com" \
  --app my-open-flow
```

## Обновление

```bash
git pull
fly deploy --config fly.toml --remote-only
```

Volume сохраняет `open-flow.sqlite` вместе с его файлами WAL и SHM. Миграции SQLite выполняются по
порядку при запуске Server; дополнительных шагов не требуется.

## Резервное копирование

Fly автоматически создаёт снимки volume, но Server гарантирует только резервные копии в
остановленном состоянии. Для согласованной резервной копии остановите machine перед созданием
снимка:

```bash
fly machine stop <machine-id> --app my-open-flow
fly volumes snapshots create <volume-id> --app my-open-flow
fly volumes snapshots list <volume-id> --app my-open-flow
fly machine start <machine-id> --app my-open-flow
```

Snapshot создаётся асинхронно. Держите machine остановленной, пока `fly volumes snapshots list` не
покажет новый snapshot в состоянии `created`, затем запустите machine.

Идентификаторы можно найти с помощью `fly machine list` и `fly volumes list`.

## Масштабирование и простаивающие machine

- Сохраняйте число machine равным одной. Для большей ёмкости измените `size` и `memory` в секции
  `[[vm]]` в `fly.toml` и повторно разверните приложение.
- По умолчанию `memory = "1gb"`. Isolated VM каждого Run по умолчанию ограничена 128 МБ,
  `OPEN_FLOW_MAX_CONCURRENT_RUNS` по умолчанию равен 4, а процессу Node нужна собственная память.
  Увеличивайте память вместе с лимитом параллелизма.
- Если вы используете только ручные Run и Webhook и готовы мириться с холодными стартами, задайте
  `auto_stop_machines = "suspend"` и `min_machines_running = 0`. Cron и Poll Trigger не срабатывают,
  пока machine приостановлена, а первый запрос Webhook ждёт пробуждения machine.
