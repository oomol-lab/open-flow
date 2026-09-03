# Docker-образ (GHCR)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow публикует готовый образ Server в реестре контейнеров GitHub Packages (GHCR), поэтому его можно запустить без клонирования
репозитория и сборки. Имя образа:

```text
ghcr.io/oomol-lab/open-flow
```

Содержимое образа совпадает с описанием в [справочнике по поставке контейнера](../container-delivery.md): один процесс Server с Workbench,
Control API, Run runtime, Trigger runtime и миграциями SQLite. Конфигурация, проверки здоровья, персистентность и резервное копирование
описаны там и здесь не повторяются.

## Выбор тега

| Тег             | Указывает на                                              | Когда использовать                                                           |
| --------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `latest`        | новейший стабильный Release                               | нужен текущий стабильный Server                                              |
| `<release-tag>` | конкретный Release, например `v0.1.0-beta.1` (неизменяем) | вы разворачиваете production и хотите зафиксированную воспроизводимую сборку |
| `tip`           | последний коммит в `main`                                 | хотите попробовать ещё не выпущенные изменения                               |
| `<short-sha>`   | конкретный коммит в `main` (неизменяем)                   | хотите зафиксировать точную предрелизную сборку                              |

Каждый GitHub Release публикует свой тег. Стабильный Release также перемещает `latest`; pre-release этого не делает, поэтому `latest`
никогда не указывает на beta. Каждый push в `main` публикует `tip` и короткий хеш коммита. Тег с тем же именем заменяется более новой
сборкой, поэтому `latest` и `tip` перемещаются, а теги Release и хеши коммитов остаются фиксированными.

Open Flow находится в beta: `latest` появится с первым стабильным Release, а до тех пор используйте `tip` или beta-тег Release, например `v0.1.0-beta.1`. Для production фиксируйте тег Release, а не `latest`.

## Загрузка

Образ публичный, вход не требуется:

```bash
docker pull ghcr.io/oomol-lab/open-flow:tip
```

Если вы получаете ошибку `unauthorized` или `denied`, войдите с GitHub token со scope `read:packages`:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

Образ мультиархитектурный (`linux/amd64` + `linux/arm64`). Каждая архитектура собирается нативно, поэтому Docker загружает вариант,
подходящий вашей машине, включая Apple Silicon и AWS Graviton, без флага `--platform`.

## Запуск

Образ слушает порт `3000`, привязывается к `0.0.0.0` и хранит SQLite в `/data/open-flow`. Смонтируйте туда volume, чтобы данные
пережили перезапуски.

Server принимает operator token из окружения. Сгенерируйте токен длиной не менее 32 байт и сохраните его в надёжном месте. Он используется
для входа в Workbench и работает как Bearer token для Control API:

```bash
export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"

docker run -d \
  --name open-flow \
  --stop-timeout 45 \
  -p 3000:3000 \
  -v open-flow-data:/data/open-flow \
  -e OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  ghcr.io/oomol-lab/open-flow:tip
```

Откройте [http://127.0.0.1:3000](http://127.0.0.1:3000) и войдите с этим токеном. Если опустить `OPEN_FLOW_TOKEN`, при первом запуске в
логах появится одноразовый setup code, и Workbench запросит его перед установкой токена; процесс описан в разделе
[Запуск](../container-delivery.md#3-启动).

Чтобы подключить Connector или LLM-сервис, добавьте переменные из [таблицы конфигурации](../container-delivery.md#4-配置).
[Руководство по self-hosted стеку](../self-hosted-stack/README.ru.md) показывает запуск Open Flow вместе с OpenConnector и oo CLI.

### Docker Compose

В корне репозитория есть `docker-compose.yml`, который запускает опубликованный образ с теми же портом и volume. Перечисленные там
переменные читаются из вашей оболочки и опускаются, если не заданы, поэтому применяются значения по умолчанию образа:

```bash
export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"
docker compose up -d
docker compose logs -f open-flow
```

Чтобы запустить конкретный тег, экспортируйте `OPEN_FLOW_IMAGE_TAG` в оболочке перед каждой командой compose, включая команды обновления ниже, иначе зафиксированный Release откатится на `tip`: `export OPEN_FLOW_IMAGE_TAG=v0.1.0-beta.1`.

### Сборка из исходников

Чтобы собрать образ самостоятельно вместо загрузки, добавьте build overlay. Он собирает `apps/server/Dockerfile` и помечает результат тем
же именем, которое использует `docker-compose.yml`:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

## Обновление

Загрузите новый тег, затем пересоздайте контейнер с тем же volume. Server выполняет ожидающие миграции SQLite при старте, а при остановке
даёт выполняющимся Run завершиться в пределах 30 секунд:

```bash
docker compose pull
docker compose up -d
```

Одновременно записывать в volume данных может только один контейнер Server. Не запускайте новый контейнер, пока старый ещё работает с тем
же volume, и сделайте [quiesced backup](../container-delivery.md#6-持久化与恢复) перед обновлением production.
