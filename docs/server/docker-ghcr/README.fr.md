# Image Docker (GHCR)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow publie une image Server préconstruite sur le registre de conteneurs GitHub Packages (GHCR), pour l'exécuter sans cloner le dépôt
ni rien construire. L'image est :

```text
ghcr.io/oomol-lab/open-flow
```

Elle contient exactement ce que décrit la [référence de livraison du conteneur](../container-delivery.md) : un processus Server avec le
Workbench, la Control API, le Run runtime, le Trigger runtime et les migrations SQLite. La configuration, les health checks, la persistance
et la sauvegarde y sont documentés et ne sont pas répétés ici.

## Choisir un tag

| Tag             | Pointe vers                                                 | À utiliser quand                                                     |
| --------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `latest`        | la Release stable la plus récente                           | vous voulez le Server stable actuel                                  |
| `<release-tag>` | une Release précise, par exemple `v0.1.0-beta.1` (immuable) | vous déployez en production et voulez un build figé et reproductible |
| `tip`           | le dernier commit de `main`                                 | vous voulez essayer des changements pas encore publiés               |
| `<short-sha>`   | un commit précis de `main` (immuable)                       | vous voulez figer un build pré-release exact                         |

Chaque GitHub Release publie son tag. Une Release stable déplace aussi `latest` ; une pre-release ne le fait pas, donc `latest` ne pointe
jamais vers une beta. Chaque push sur `main` publie `tip` et le hash court du commit. Un tag publié par un build plus récent remplace
l'ancien sous le même nom : `latest` et `tip` bougent, tandis que les tags de Release et les hashs de commit restent fixes.

Open Flow est en beta : `latest` apparaît avec la première Release stable, donc en attendant utilisez `tip` ou un tag de Release beta tel que `v0.1.0-beta.1`. En production, figez un tag de Release plutôt que `latest`.

## Pull

L'image est publique, aucune connexion n'est requise :

```bash
docker pull ghcr.io/oomol-lab/open-flow:tip
```

Si vous obtenez une erreur `unauthorized` ou `denied`, connectez-vous avec un token GitHub ayant le scope `read:packages` :

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

L'image est multi-architecture (`linux/amd64` + `linux/arm64`). Chaque architecture est construite nativement, donc Docker télécharge la
variante adaptée à votre machine, y compris Apple Silicon et AWS Graviton, sans option `--platform`.

## Exécuter

L'image écoute sur le port `3000`, se lie à `0.0.0.0` et stocke SQLite dans `/data/open-flow`. Montez-y un volume pour que les données
survivent aux redémarrages.

Le Server accepte un operator token depuis l'environnement. Générez-en un d'au moins 32 octets et conservez-le en lieu sûr. Il sert à se
connecter au Workbench et fonctionne comme Bearer token pour la Control API :

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

Ouvrez [http://127.0.0.1:3000](http://127.0.0.1:3000) et connectez-vous avec le token. Si vous omettez `OPEN_FLOW_TOKEN`, le premier
démarrage affiche un setup code à usage unique dans les logs et le Workbench le demande avant de définir un token ; voir
[Démarrage](../container-delivery.md#3-启动) pour la procédure de revendication.

Pour connecter un Connector ou un service LLM, ajoutez les variables du [tableau de configuration](../container-delivery.md#4-配置).
Le [guide de la pile auto-hébergée](../self-hosted-stack/README.fr.md) détaille l'exécution d'Open Flow avec OpenConnector et la oo CLI.

### Docker Compose

La racine du dépôt fournit un `docker-compose.yml` qui exécute l'image publiée avec le même port et le même volume. Les variables qui y
sont listées sont lues depuis votre shell et omises si elles ne sont pas définies, donc les valeurs par défaut de l'image s'appliquent :

```bash
export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"
docker compose up -d
docker compose logs -f open-flow
```

Pour exécuter un tag précis, exportez `OPEN_FLOW_IMAGE_TAG` dans le shell avant chaque commande compose, y compris les commandes de mise à niveau ci-dessous, sinon une Release figée retombe sur `tip` : `export OPEN_FLOW_IMAGE_TAG=v0.1.0-beta.1`.

### Construire depuis les sources

Pour construire l'image vous-même au lieu de la télécharger, ajoutez l'overlay de build. Il construit `apps/server/Dockerfile` et tague le
résultat avec le nom utilisé par `docker-compose.yml` :

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

## Mise à niveau

Téléchargez le nouveau tag, puis recréez le conteneur avec le même volume. Le Server exécute les migrations SQLite en attente au démarrage,
et l'arrêt laisse les Runs en cours se terminer dans le délai de 30 secondes :

```bash
docker compose pull
docker compose up -d
```

Un seul conteneur Server peut écrire dans un volume de données à la fois. Ne démarrez pas le nouveau conteneur tant que l'ancien tourne
encore sur le même volume, et faites une [sauvegarde quiesced](../container-delivery.md#6-持久化与恢复) avant de mettre à niveau la production.
