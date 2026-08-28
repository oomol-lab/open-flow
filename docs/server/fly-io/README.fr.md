# Déploiement sur Fly.io

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow Server peut s'exécuter sur Fly.io en tant que runtime Docker Node. Ce déploiement utilise le
`apps/server/Dockerfile` du dépôt, la configuration d'app Fly dans le `fly.toml` à la racine du
dépôt, et un volume Fly monté sur `/data/open-flow`. Fly fournit la terminaison TLS, les builds
Docker distants, les health checks, les déploiements progressifs et, en option, les domaines
personnalisés.

La limite de déploiement est la même que dans la
[référence de livraison en conteneur](../container-delivery.md) : une machine Server et un seul
writer SQLite. N'exécutez jamais plus d'une machine.

## Prérequis

- Un compte Fly.io.
- `flyctl` installé et authentifié avec `fly auth login`.
- Docker disponible en local, ou les remote builders de Fly. `apps/server/Dockerfile` utilise la
  syntaxe BuildKit, que les remote builders prennent en charge.

## Créer l'app

Créez une app Fly sans la déployer pour l'instant :

```bash
fly apps create my-open-flow
```

Les noms d'app Fly sont uniques à l'échelle mondiale. Si vous choisissez un autre nom, mettez à jour
le champ `app` dans `fly.toml` avant de déployer :

```toml
app = "my-open-flow"
```

## Créer le stockage persistant

L'image stocke SQLite dans `/data/open-flow`. Créez un volume Fly avec le même nom de source que
`fly.toml` :

```bash
fly volumes create open_flow_data \
  --region iad \
  --size 1 \
  --app my-open-flow
```

L'historique des Runs et les RunEvents grossissent avec le temps. Augmentez `--size` si vous
attendez de nombreux Runs, ou étendez le volume plus tard avec `fly volumes extend`.

## Définir les secrets

Le token opérateur doit contenir au moins 32 octets UTF-8. Stockez-le comme secret Fly au lieu de le
committer dans `fly.toml` :

```bash
OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"

fly secrets set \
  OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  --app my-open-flow
```

Conservez `OPEN_FLOW_TOKEN` dans un gestionnaire de mots de passe. La même valeur permet de se
connecter au Workbench et sert de Bearer token pour la Control API.

`fly.toml` définit déjà `OPEN_FLOW_SESSION_COOKIE_SECURE` à `true` : `force_https` redirige les
requêtes HTTP en clair, de sorte que les navigateurs n'atteignent le Server que via TLS.

Définissez les secrets du Connector lorsque vous avez besoin d'un Connector :

```bash
fly secrets set \
  OPEN_FLOW_CONNECTOR_ORIGIN="https://connector.example.com" \
  OPEN_FLOW_CONNECTOR_TOKEN="replace-with-a-scoped-runtime-token" \
  OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN="https://connector.example.com" \
  --app my-open-flow
```

Lorsque OpenConnector s'exécute dans la même organisation Fly, l'origine runtime peut utiliser le
réseau privé Fly, par exemple `http://my-open-connector.internal:3000`. L'origine console doit rester
une origine HTTPS publique que les navigateurs des utilisateurs peuvent ouvrir.

Définissez l'origine et la clé de callback lorsque vous avez besoin des Integrations de Provider :

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://my-open-flow.fly.dev" \
  OPEN_FLOW_INTEGRATION_CALLBACK_KEY="$(openssl rand -hex 32)" \
  --app my-open-flow
```

`fly secrets set` redéploie la machine. Consultez la
[référence de livraison en conteneur](../container-delivery.md#4-配置) pour la liste complète des
variables d'environnement et les contraintes applicables à chaque origine.

## Déployer

Déployez depuis la racine du dépôt :

```bash
fly deploy --config fly.toml --remote-only --ha=false
```

`--ha=false` empêche Fly de créer une seconde machine pour une nouvelle app. Le Server n'autorise
qu'un seul writer SQLite, et chaque machine monte son propre volume : deux machines détiendraient
donc deux copies sans lien de l'état. Gardez le nombre de machines à un lors de chaque déploiement
ultérieur et ne l'augmentez jamais avec `fly scale count`.

La configuration Fly utilise :

- `apps/server/Dockerfile` pour la construction de l'image, avec la racine du dépôt comme contexte
  de build.
- `internal_port = 3000`, la valeur par défaut de l'image.
- `GET /readyz` comme health check HTTP. Il renvoie 503 pendant le démarrage du Server, lorsque le
  traitement en arrière-plan s'est arrêté, ou lorsque le Connector configuré est injoignable ; Fly
  cesse alors de router le trafic vers la machine et fait échouer le déploiement. Remplacez le chemin
  par `/healthz` si vous ne voulez qu'un contrôle de vivacité.
- `kill_signal = "SIGTERM"` et `kill_timeout = "45s"`. Le Server attend jusqu'à 30 secondes pour
  vider les Runs et fermer SQLite, le délai de grâce doit donc dépasser 30 secondes.
- `auto_stop_machines = "off"` et `min_machines_running = 1`. Les Triggers Cron et Poll ne se
  déclenchent que lorsque la machine est en marche.

## Vérifier le runtime

```bash
curl https://my-open-flow.fly.dev/healthz
curl https://my-open-flow.fly.dev/readyz
```

Les réponses attendues sont `{"status":"ok"}` et `{"status":"ready"}`. Ouvrez
`https://my-open-flow.fly.dev` et connectez-vous au Workbench avec `OPEN_FLOW_TOKEN`.

Consultez les logs pour diagnostiquer les problèmes de déploiement ou de démarrage :

```bash
fly logs --app my-open-flow
```

## Domaine personnalisé

Enregistrez le domaine auprès de Fly :

```bash
fly certs add flow.example.com --app my-open-flow
```

Fly affiche les enregistrements DNS à créer. Une fois le DNS prêt, vérifiez l'état du certificat :

```bash
fly certs check flow.example.com --app my-open-flow
```

Si les callbacks d'Integration sont configurés, faites pointer `OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN`
vers le nouveau domaine :

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://flow.example.com" \
  --app my-open-flow
```

## Mise à jour

```bash
git pull
fly deploy --config fly.toml --remote-only
```

Le volume conserve `open-flow.sqlite` ainsi que ses fichiers WAL et SHM. Les migrations SQLite
s'exécutent dans l'ordre au démarrage du Server ; aucune étape supplémentaire n'est nécessaire.

## Sauvegarde

Fly prend automatiquement des snapshots du volume, mais le Server ne garantit que des sauvegardes au
repos. Pour une sauvegarde cohérente, arrêtez la machine avant de créer un snapshot :

```bash
fly machine stop <machine-id> --app my-open-flow
fly volumes snapshots create <volume-id> --app my-open-flow
fly volumes snapshots list <volume-id> --app my-open-flow
fly machine start <machine-id> --app my-open-flow
```

Le snapshot est créé de manière asynchrone. Laissez la machine arrêtée jusqu'à ce que
`fly volumes snapshots list` affiche le nouveau snapshot avec l'état `created`, puis redémarrez la machine.

Retrouvez les identifiants avec `fly machine list` et `fly volumes list`.

## Mise à l'échelle et machines inactives

- Gardez le nombre de machines à un. Pour plus de capacité, modifiez `size` et `memory` sous
  `[[vm]]` dans `fly.toml` et redéployez.
- La valeur par défaut est `memory = "1gb"`. La VM isolée de chaque Run est plafonnée à 128 Mo par
  défaut, `OPEN_FLOW_MAX_CONCURRENT_RUNS` vaut 4 par défaut, et le processus Node a besoin de sa
  propre mémoire. Augmentez la mémoire en même temps que la limite de concurrence.
- Si vous n'utilisez que des Runs manuels et des Webhooks et acceptez les démarrages à froid,
  définissez `auto_stop_machines = "suspend"` et `min_machines_running = 0`. Les Triggers Cron et
  Poll ne se déclenchent pas tant que la machine est suspendue, et la première requête Webhook attend
  le réveil de la machine.
