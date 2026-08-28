<div align="center">

# Open Flow

**Construisez des workflows que vous pouvez voir, coder, exécuter et posséder.**

[English](../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

[![CI](https://github.com/oomol-lab/open-flow/actions/workflows/ci.yaml/badge.svg)](https://github.com/oomol-lab/open-flow/actions/workflows/ci.yaml)
[![npm](https://img.shields.io/npm/v/%40oomol-lab%2Fopen-flow/next?label=%40oomol-lab%2Fopen-flow)](https://www.npmjs.com/package/@oomol-lab/open-flow)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../LICENSE)
![Node.js 26](https://img.shields.io/badge/Node.js-26-339933)
![Bun 1.4](https://img.shields.io/badge/Bun-1.4-000000)

</div>

Open Flow est une plateforme open source d'automatisation de workflows où les Agents IA et les
personnes construisent le même Flow. Demandez à Codex, Claude Code ou à un autre Agent de terminal de
créer, vérifier, exécuter et publier un workflow typé avec [`oo flow`](https://github.com/oomol-lab/oo-cli),
puis consultez et modifiez visuellement ce Flow précis dans le Workbench.

Utilisez des nœuds typés pour structurer le workflow, conservez la logique personnalisée sous forme de
JavaScript et exécutez l'automatisation sur OOMOL Hosted ou sur une infrastructure que vous
contrôlez. Le graphe reste compréhensible, le code reste du code, et le déploiement reste sous votre
contrôle.

<p align="center">
  <a href="https://www.youtube.com/watch?v=CIF5I11VpLM">
    <img alt="Regarder Codex créer et exécuter un workflow Gmail vers Feishu avec Open Flow" src="assets/open-flow-demo-video.jpg" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=CIF5I11VpLM"><strong>▶ Regarder la démo Open Flow d’une minute</strong></a>
</p>

> [!IMPORTANT]
> Open Flow est en phase alpha. Ses contrats sont versionnés, mais le produit n'a pas encore atteint
> sa première version stable.

## Créer des workflows avec un Agent IA

`oo flow` expose le cycle de création sous forme de commandes versionnées et lisibles par une machine. Un Agent capable d'utiliser un terminal peut :

- découvrir les Connector Actions et Provider Triggers exacts ;
- créer et modifier des Nodes, Edges, Code Tasks et Trigger bindings typés ;
- vérifier un Draft, l'exécuter et consulter son résultat ;
- le publier en Live ou ouvrir le même Flow dans le Workbench lorsque vous le demandez.

> **Exemple de demande :** « Crée un workflow qui lit les messages Gmail non lus, les met en forme et les envoie dans Feishu. »

L'Agent crée un véritable Draft dans le déploiement Open Flow sélectionné, et non une configuration locale jetable. La CLI et le Workbench utilisent la même Control API : une modification créée par l'IA apparaît donc dans le même graphe visuel et reste modifiable par les personnes comme par les Agents.

<p align="center">
  <img alt="Un workflow Gmail vers Feishu exécuté avec succès dans Open Flow Workbench" src="assets/workbench-overview.png">
</p>

[Installez la CLI `oo`](https://github.com/oomol-lab/oo-cli) pour créer des Open Flow depuis Codex, Claude Code ou un autre Agent de terminal.

## Choisir comment exécuter Open Flow

Les trois options prises en charge utilisent le même produit Open Flow et le même Workbench.

<table>
  <tr>
    <td width="33%" align="center"><strong>☁️ OOMOL Hosted</strong></td>
    <td width="33%" align="center"><strong>🐳 Docker Self-hosted</strong></td>
    <td width="33%" align="center"><strong>Fly.io Self-hosted</strong></td>
  </tr>
  <tr>
    <td width="33%" valign="top">Prêt à l'emploi sans préparer, mettre à jour ou superviser un serveur. OOMOL exploite le déploiement et fournit des OAuth Apps gérées pour les intégrations compatibles, ce qui évite les coûts fixes d'un serveur et la configuration séparée des OAuth Apps.</td>
    <td width="33%" valign="top">Exécutez Open Flow sur votre propre infrastructure avec l'image Docker incluse. Vous gérez le déploiement, le stockage, les sauvegardes, les mises à niveau, le réseau et la configuration du Connector ou des OAuth Apps.</td>
    <td width="33%" valign="top">Exécutez la même image Docker sur Fly.io sans exploiter vous-même un serveur. Fly construit l'image, termine le TLS et conserve SQLite sur un volume persistant ; vous gérez les secrets, les sauvegardes, les mises à niveau et la configuration du Connector ou des OAuth Apps.</td>
  </tr>
  <tr>
    <td width="33%" align="center">🚀 <a href="https://oomol.com"><strong>Utiliser OOMOL Hosted</strong></a></td>
    <td width="33%" align="center"><a href="#démarrage-rapide"><strong>S'auto-héberger avec Docker</strong></a></td>
    <td width="33%" align="center"><a href="server/fly-io/README.fr.md"><strong>Déployer sur Fly.io</strong></a></td>
  </tr>
</table>

## Pourquoi Open Flow

- **Créez avec un Agent IA.** Utilisez `oo flow` depuis Codex, Claude Code ou un autre Agent de terminal pour créer, vérifier, exécuter et publier le même Flow que celui affiché dans le Workbench.
- **Rendez les dépendances de données explicites.** Chaque Task déclare des entrées et des sorties nommées et typées. Chaque arête lie une valeur de sortie précise à une entrée précise : le graphe est donc le modèle de dépendances utilisé par le runtime.
- **Concevez visuellement, ajoutez du code lorsque c'est nécessaire.** Composez des nœuds typés sur le canevas et utilisez une Code Task pour le JavaScript personnalisé. Le code reste visible au lieu d'être caché dans des champs de formulaire.
- **Exécutez et déboguez au même endroit.** Validez les entrées et la structure du Flow avant
  l'exécution, inspectez la progression et les sorties de chaque nœud, et suivez l'historique complet
  des événements de chaque Run.
- **Publiez des automatisations de longue durée.** Démarrez les Flows manuellement ou à partir de
  planifications Cron, de Webhooks, de sources de polling et d'événements de Provider.
- **Gardez l'état opérationnel au même endroit.** Les Projects, les Revisions immuables, les
  Publications, les versions Live, les Runs et l'état des Triggers appartiennent à un seul déploiement
  sélectionné, au lieu d'être répartis entre des fichiers locaux et des services cachés.
- **Exécutez du code non fiable en toute sécurité.** Le Server exécute chaque Task de code dans un
  isolate V8 neuf, au sein d'un processus Executor de longue durée, avec uniquement les Capabilities
  déclarées par cette Task.
- **Choisissez où cela s'exécute.** Utilisez OOMOL Hosted ou exécutez le Server inclus avec Docker
  sur votre propre infrastructure.

Open Flow est conçu pour les workflows qui dépassent le stade du prototype no-code mais ne doivent
pas devenir un ensemble opaque de scripts et d'infrastructure.

## Le graphe est le contrat du runtime

Chaque Task déclare des entrées et des sorties nommées et typées. Une arête transporte une valeur d'une sortie précise vers une entrée précise, et le runtime démarre un nœud lorsque ses entrées sont prêtes.

Le graphe montre les dépendances de données réellement utilisées par le runtime : les données ordinaires d'un Flow ne peuvent pas être récupérées depuis un nœud arbitraire au moyen d'un stockage runtime caché. Les branches indépendantes peuvent s'exécuter en parallèle, et la position d'un nœud sur le canevas ne modifie jamais le comportement d'exécution.

### Création visuelle typée

La vue détaillée rend explicites sur le canevas chaque entrée, sortie, type, contrainte nullable et
connexion.

<p align="center">
  <img src="assets/typed-node-details.jpg" alt="Typed input and output handles in the Open Flow Workbench detailed view">
</p>

### Du code là où il est nécessaire

Les Code Tasks placent le JavaScript personnalisé directement dans le graphe, avec des entrées et
sorties typées.

<p align="center">
  <img src="assets/code-task-editor.jpg" alt="Editing a custom Code Task in the Open Flow Workbench">
</p>

## Fonctionnement

```mermaid
flowchart LR
  Workbench["Workbench"] -->|"Control API"| Server["Open Flow Server"]
  CLI["oo flow CLI"] -->|"Control API"| Server
  Server -. "optionnel" .-> Connector["Runtime Connector"]
  Connector --> Providers["Providers tiers"]
  Server --> Store["SQLite : Projects, Revisions, Publications, Runs"]
  Server --> Triggers["Ordonnanceur de Triggers : Cron, Webhook, Poll, Integration"]
  Server --> Runtime["Runtime JavaScript isolé"]
```

Le Workbench et la CLI ne communiquent qu'avec un seul déploiement sélectionné, via la Control API
versionnée. Le déploiement est responsable de la validation, de l'exécution, de la persistance et de
l'admission des Triggers. Les identifiants des Providers n'entrent jamais dans Open Flow : les Actions
adossées à un Connector, les Triggers de Provider et les proxys passent par un runtime Connector tel
que [OpenConnector](https://github.com/oomol-lab/open-connector), et Open Flow ne conserve que des
identités de Connection opaques.

## Démarrage rapide

Vous avez besoin de [Docker](https://docs.docker.com/get-docker/) et d'OpenSSL. Clonez le dépôt, créez
un token opérateur et démarrez le Server auto-hébergé :

```bash
git clone https://github.com/oomol-lab/open-flow.git
cd open-flow

export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"
docker build --file apps/server/Dockerfile --tag open-flow-server:dev .
docker run --rm \
  --publish 3000:3000 \
  --env OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  --volume open-flow-data:/data/open-flow \
  open-flow-server:dev
```

Ouvrez [http://127.0.0.1:3000](http://127.0.0.1:3000) et connectez-vous avec la valeur de
`OPEN_FLOW_TOKEN`. La même valeur sert de Bearer token pour les clients machine de la Control API.
Les Projects et l'historique des Runs sont persistés dans le volume Docker `open-flow-data`.

Le Server est utile sans services externes. Les Actions adossées à un Connector, les Triggers de
Provider et les Tasks LLM échouent de manière sûre (fail closed) tant que la capacité hôte
correspondante n'est pas configurée ; rien ne bascule vers un service non déclaré.

Pour la configuration de production, TLS, les health checks, la persistance, les sauvegardes et les
limites de ressources, consultez le [guide de déploiement du Server](server/container-delivery.md) et
la liste de durcissement dans [SECURITY.md](../SECURITY.md#hardening-your-deployment).

## Déployer sur Fly.io

La même image fonctionne sur Fly.io. Le dépôt fournit un `fly.toml` qui construit
`apps/server/Dockerfile`, garde une machine en marche pour les Triggers Cron et Poll, et persiste
SQLite sur un volume Fly. Consultez [Déploiement sur Fly.io](server/fly-io/README.fr.md) pour la création de l'app, le
volume, les secrets, le déploiement, les domaines personnalisés et les limites de mise à
l'échelle.

## Connecter un Connector

Pour exécuter des Actions et des Triggers de Provider auprès de services tels que GitHub, Gmail, Slack
ou Notion, pointez le Server vers un runtime Connector. Un
[OpenConnector](https://github.com/oomol-lab/open-connector) auto-hébergé comme le Connector hébergé
par OOMOL exposent tous deux l'API runtime requise.

<p align="center">
  <img src="assets/connector-actions.jpg" alt="Browsing Gmail Provider Triggers and Actions in the Open Flow Workbench">
</p>

```dotenv
OPEN_FLOW_CONNECTOR_ORIGIN=http://open-connector:3000
OPEN_FLOW_CONNECTOR_TOKEN=replace-with-a-scoped-runtime-token
OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN=https://connector.example.com
```

L'origine runtime est l'adresse à laquelle le Server joint le Connector ; l'origine console est celle
que les navigateurs des utilisateurs ouvrent pour autoriser des comptes dans la Connector Console. Les
définitions de Triggers de Provider sont livrées avec Open Flow et ne nécessitent aucun
enregistrement. Consultez la [référence de configuration](server/container-delivery.md#4-配置) pour
les paramètres de callback d'Integration et les contraintes applicables à chaque origine.

## Un seul produit, des déploiements portables

Le Workbench et la CLI parlent une Control API versionnée plutôt que de dépendre d'une base de données
ou d'un runtime cloud particulier. Un déploiement est responsable de l'exécution et de la
persistance ; les clients ne créent pas de second format de projet local et ne basculent pas
silencieusement vers un autre backend.

Ce dépôt contient :

- [`packages/open-flow`](../packages/open-flow) : le paquet npm public `@oomol-lab/open-flow`, avec
  les points d'entrée d'authoring, d'exécution, de Trigger, de Control API, de conformité et de
  runtime Workbench ;
- [`packages/command`](../packages/command) : le runtime de la commande `oo flow` et le Command
  Artifact immuable consommé par la [oo CLI](https://github.com/oomol-lab/oo-cli) ;
- [`apps/server`](../apps/server) : le Workbench auto-hébergé, la Control API, la persistance SQLite,
  l'ordonnanceur de Triggers et le runtime JavaScript isolé.

Lisez les [limites du produit et de l'architecture](architecture.md) pour le modèle durable, ou la
[référence de la Control API](control/contracts/control-api.md) pour le contrat HTTP.

## Développer à partir des sources

Open Flow utilise [Bun](https://bun.sh/) pour l'espace de travail et Node.js pour le Server. Utilisez
les versions épinglées dans `.bun-version` et `.node-version`.

```bash
bun install --frozen-lockfile
bun run dev
```

Ouvrez le Workbench de développement à l'adresse
[http://127.0.0.1:5173](http://127.0.0.1:5173). Ses requêtes API sont relayées vers le Server sur
`http://127.0.0.1:3000`.

Le premier lancement en développement crée un token opérateur dans
`apps/server/.open-flow-dev/operator-token`. Les lancements suivants le réutilisent, de sorte que
redémarrer le serveur de développement n'invalide pas la session Workbench en cours. Définissez
`OPEN_FLOW_TOKEN` pour utiliser un token explicite à la place.

Avant de soumettre une modification, exécutez :

```bash
bun run check
bun run test
bun run build
```

Ajoutez `bun run test:package` lorsque vous touchez au paquet publié ou à la CLI, et
`bun run test:docker` lorsque Docker est disponible, afin de vérifier l'image de release, le runtime
isolé, le Workbench, l'arrêt propre et la récupération du volume SQLite. N'exécutez pas `bun test` à
la racine du dépôt : cela contourne les scripts de test de l'espace de travail. Consultez
[CONTRIBUTING.md](../CONTRIBUTING.md) pour l'ensemble des règles de développement.

## Documentation

Commencez par l'[index de la documentation](README.md). Les références les plus utiles sont :

- [Limites du produit et de l'architecture](architecture.md)
- [Control API](control/contracts/control-api.md)
- [Distribution du Command Artifact](distribution/command-artifact.md)
- [Notes sur le frontend du Workbench et du Designer](authoring/frontend-ui.md)
- [Déploiement du Server](server/container-delivery.md)
- [Déploiement sur Fly.io](server/fly-io/README.fr.md)
- [Contribuer](../CONTRIBUTING.md)
- [Code de conduite](../CODE_OF_CONDUCT.md)
- [Sécurité](../SECURITY.md)

## Projets liés

- [OpenConnector](https://github.com/oomol-lab/open-connector) : passerelle de connecteurs open source
  qui fournit le catalogue de Providers, les identifiants et l'exécution des Actions derrière les nœuds
  adossés à un Connector.
- [oo CLI](https://github.com/oomol-lab/oo-cli) : boîte à outils d'agent local qui héberge la commande
  `oo flow` construite à partir de ce dépôt.

## Contribuer

Les issues et les pull requests sont les bienvenues. Lisez [CONTRIBUTING.md](../CONTRIBUTING.md) pour
la configuration de développement, les règles du dépôt et les vérifications à exécuter avant d'ouvrir
une pull request. La participation à ce projet est régie par
[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

## Sécurité

Veuillez signaler les vulnérabilités de manière privée via le
[signalement privé de vulnérabilités GitHub](https://github.com/oomol-lab/open-flow/security/advisories/new)
plutôt que par des issues publiques. [SECURITY.md](../SECURITY.md) décrit les versions prises en
charge, le processus de divulgation, le périmètre couvert et la manière de durcir un déploiement
auto-hébergé.

## Licence

[Apache-2.0](../LICENSE). Les mentions relatives aux ressources tierces embarquées figurent dans
[NOTICE](../NOTICE).

## Contributeurs

Merci à toutes les personnes qui ont contribué à Open Flow. Vous souhaitez les rejoindre ?
Consultez le [guide de contribution](../CONTRIBUTING.md).

[![Contributeurs Open Flow](https://contrib.rocks/image?repo=oomol-lab/open-flow)](https://github.com/oomol-lab/open-flow/graphs/contributors)

## Historique des Stars

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/star-history/star-history-dark.svg">
  <img alt="Star history" src="../assets/star-history/star-history-light.svg">
</picture>
