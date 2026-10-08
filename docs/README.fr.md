<div align="center">

<img src="../assets/logo/open-flow-wordmark-auto.svg" alt="Open Flow" width="280" height="64" />

**Construisez des workflows que vous pouvez voir, coder, exécuter et posséder.**

[English](../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

[![CI](https://github.com/oomol-lab/open-flow/actions/workflows/ci.yaml/badge.svg)](https://github.com/oomol-lab/open-flow/actions/workflows/ci.yaml)
[![npm](https://img.shields.io/npm/v/%40oomol-lab%2Fopen-flow/next?label=%40oomol-lab%2Fopen-flow)](https://www.npmjs.com/package/@oomol-lab/open-flow)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../LICENSE)
![Node.js 26](https://img.shields.io/badge/Node.js-26-339933)
![Bun 1.4](https://img.shields.io/badge/Bun-1.4-000000)

</div>

**Créez vos automatisations avec votre agent IA. Voyez exactement ce qui sera exécuté.**

Open Flow est une plateforme de workflows open source qui associe la rapidité de la création assistée par IA à la clarté d'un workflow visuel. Demandez à Codex, Claude Code ou à un autre agent de créer un Flow, ouvrez-le dans le Workbench et continuez à améliorer ensemble ce même workflow.

Combinez JavaScript, applications connectées, IA, embranchements et validation humaine sur un même canevas. Inspectez les entrées, suivez l'exécution et choisissez la version à mettre en production. Utilisez OOMOL Hosted ou votre propre infrastructure.

[Explorer la démo interactive](https://openflow.run) · [Utiliser OOMOL Hosted](https://oomol.com) · [Auto-héberger avec Docker](#exécutez-open-flow-où-vous-voulez)

![Un workflow d'accueil client dans le Workbench actuel, avec des données client explicites, du JavaScript, une validation et un sous-flux](assets/readme-workbench.png)

> [!IMPORTANT]
> Open Flow est en bêta. Le produit et ses contrats versionnés continuent d'évoluer.

## Votre agent construit. Vous gardez la main.

Décrivez le travail à accomplir :

> « Lis les nouveaux e-mails du support, classe chaque demande, rédige une réponse et demande mon accord avant de l'envoyer. »

Avec [`oo flow`](https://github.com/oomol-lab/oo-cli), un agent disposant d'un terminal peut découvrir les intégrations, créer et modifier des nœuds, vérifier un brouillon, l'exécuter, examiner les résultats et le publier à votre demande. Ses modifications apparaissent dans le même Workbench que vous utilisez pour examiner le graphe et modifier le code. Aucun projet distinct généré par l'IA n'est à convertir ou à synchroniser.

Le Server expose aussi des [outils MCP de création et d'exécution](server/mcp.md) pour les clients compatibles. Les deux interfaces agissent sur les Flows, révisions et exécutions enregistrés dans le déploiement sélectionné.

Confiez les raccordements répétitifs à l'agent. Gardez les décisions importantes bien visibles.

## Rendez chaque étape inspectable

Un workflow doit rester compréhensible même quand la conversation qui l'a créé a disparu.

- **JavaScript pour les traitements précis.** Transformez des données, formatez des messages ou écrivez votre logique dans des Code Tasks aux entrées et sorties nommées et typées.
- **Des sources d'entrée explicites.** Voyez d'où vient une valeur dans le panneau de propriétés. Les connexions de contrôle déterminent ce qui s'exécute ensuite ; les mappings d'entrée déterminent les données reçues par chaque étape.
- **Des branches et des sous-flux réutilisables.** Aiguillez le travail à l'aide de conditions et donnez une interface claire aux traitements récurrents.
- **Des notes à côté du travail.** Expliquez une décision directement sur le canevas pour que la personne suivante en comprenne l'intention.

![Le panneau de propriétés actuel d'une Code Task, avec le JavaScript, la source des données client et une sortie message typée](assets/readme-code.png)

## Donnez à l'IA une mission bien délimitée

Utilisez les LLM Tasks pour classer, extraire ou résumer. Choisissez les Agent Tasks pour les travaux qui nécessitent plusieurs appels d'outils. Ajoutez du code classique, des conditions et des validations là où vous avez besoin d'un comportement prévisible.

Une Agent Task dispose d'un modèle configuré, d'outils déclarés et de limites d'exécution. La configuration des outils définit les actions, les comptes et la politique d'approbation à la disposition du modèle. Vous pouvez exiger une approbation humaine pour un appel d'outil, ou placer un nœud Approval dans le workflow avant de laisser la suite s'exécuter.

Les nœuds Approval et Wait conservent leur état d'attente de façon persistante. Après une décision, le travail peut reprendre sans rejouer les étapes déjà terminées dans cette exécution.

## Comprenez l'exécution. Choisissez ce qui passe en production.

Testez un brouillon à partir d'un déclencheur choisi et suivez son exécution dans le Workbench. Inspectez les résultats des nœuds, les logs, les erreurs et les approbations en attente, sans devoir reconstituer le déroulement à partir du seul message final. L'historique relie chaque exécution à la révision qui l'a produite.

![Un test du workflow d'accueil client en attente d'approbation humaine dans le Workbench](assets/readme-approval.png)

La publication crée un instantané versionné pour l'automatisation Live. Continuez à modifier le brouillon pendant que la version publiée s'exécute, consultez les anciennes Publications et revenez à une version précédente si nécessaire.

Démarrez les workflows manuellement, selon un calendrier, par webhook ou à partir des événements et sources de polling pris en charge. Le même déploiement gère le workflow, sa version Live et son état d'exécution.

## Connectez vos applications sans mettre les identifiants dans le graphe

Open Flow utilise un runtime Connector tel qu'[OpenConnector](https://github.com/oomol-lab/open-connector) pour découvrir et exécuter les actions de services comme Gmail, Slack, GitHub et Notion. Les identifiants des comptes restent dans le Connector ; les workflows font référence à des identifiants de Connection.

OOMOL Hosted fournit des applications OAuth gérées pour les intégrations prises en charge. En auto-hébergement, vous choisissez le déploiement du Connector et gérez la configuration des services ainsi que les autorisations des comptes. La logique du workflow et l'accès aux comptes restent distincts.

Consultez [Open Flow avec OpenConnector et le CLI oo](server/self-hosted-stack/README.fr.md) pour la configuration complète, y compris l'autorisation d'un compte et la création d'un premier Flow.

## Exécutez Open Flow où vous voulez

| Option           | Ce que vous gérez                                                                                | Pour démarrer                                      |
| ---------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| **OOMOL Hosted** | Vos workflows et comptes connectés ; OOMOL exploite le déploiement.                              | [Ouvrir OOMOL](https://oomol.com)                  |
| **Docker**       | Déploiement, stockage, sauvegardes, mises à niveau et intégrations.                              | Commandes ci-dessous                               |
| **Fly.io**       | Application, volume persistant, secrets, sauvegardes et mises à niveau sur l'infrastructure Fly. | [Guide de déploiement](server/fly-io/README.fr.md) |

Pour une instance auto-hébergée en local, installez Docker et OpenSSL, puis exécutez :

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

Ouvrez [http://127.0.0.1:3000](http://127.0.0.1:3000) et connectez-vous avec `OPEN_FLOW_TOKEN`. Les Flows et l'historique d'exécution sont stockés dans le volume Docker. Le jeton opérateur sert aussi à authentifier les accès CLI et API.

Vous préférez une image préconstruite ? Suivez le [guide des images GHCR](server/docker-ghcr/README.fr.md) et choisissez un tag de version explicite pendant la bêta. Le tag `latest` est réservé aux versions stables.

Les actions Connector et les LLM Tasks nécessitent la configuration des services correspondants. Le Server ne bascule pas silencieusement vers un autre fournisseur. Avant d'exposer un déploiement sur Internet, suivez le [guide de déploiement](server/container-delivery.md) et la [liste de vérification de sécurité](../SECURITY.md#hardening-your-deployment).

## Développez avec Open Flow

Open Flow est distribué sous licence Apache-2.0. Ce dépôt comprend les contrats et le runtime des workflows, le Workbench, le package de commandes CLI et le Server auto-hébergeable. Le Control API versionné rend les clients indépendants de l'implémentation du stockage et de l'exécution du déploiement.

Utilisez les versions de Bun et Node.js fixées dans `.bun-version` et `.node-version` :

```bash
bun install --frozen-lockfile
bun run dev
```

Le Workbench de développement est accessible sur [http://localhost:5174](http://localhost:5174). Le premier lancement crée un jeton opérateur dans `apps/server/.open-flow-dev/operator-token`. Consultez [CONTRIBUTING.md](../CONTRIBUTING.md) pour la configuration, les vérifications et le Lab de composants.

| Pour en savoir plus                                        | Référence                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Modèle du produit et limites du runtime                    | [Architecture](architecture.md)                                                                                           |
| Intégrer vos propres clients                               | [Control API](control/contracts/control-api.md) · [MCP](server/mcp.md)                                                    |
| Déployer et exploiter une instance                         | [Server](server/container-delivery.md) · [Docker](server/docker-ghcr/README.fr.md) · [Fly.io](server/fly-io/README.fr.md) |
| Connecter des applications et un agent de programmation IA | [OpenConnector + CLI oo](server/self-hosted-stack/README.fr.md)                                                           |
| Parcourir toute la documentation                           | [Index de la documentation](README.md)                                                                                    |

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
