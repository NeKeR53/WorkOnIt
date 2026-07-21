# WorkOnIt

[![CI](https://github.com/NeKeR53/WorkOnIt/actions/workflows/ci.yml/badge.svg)](https://github.com/NeKeR53/WorkOnIt/actions/workflows/ci.yml)
[![CodeQL](https://github.com/NeKeR53/WorkOnIt/actions/workflows/codeql.yml/badge.svg)](https://github.com/NeKeR53/WorkOnIt/actions/workflows/codeql.yml)
[![License](https://img.shields.io/github/license/NeKeR53/WorkOnIt)](LICENSE)

WorkOnIt est une application desktop locale de kanban et d'automatisation.
Elle combine Tauri, Rust, React, TypeScript et SQLite. Les tableaux, tâches,
secrets et exécutions restent sur la machine de l'utilisateur.

> **Statut :** version `0.1.0`, MVP fonctionnel en développement actif. Les
> formats de données et interfaces peuvent encore évoluer.

## Fonctionnalités

- tableaux kanban, colonnes, limites WIP et champs personnalisés ;
- automatisations séquentielles et planifiées ;
- sources JSON, JSONL, texte et commandes locales ;
- historique d'exécution, logs avec masquage des secrets et annulation ;
- sauvegarde, restauration et archives portables `.workonit` ;
- stockage SQLite local et secrets conservés dans le coffre du système ;
- interface disponible en français et en anglais.

## Sécurité

WorkOnIt peut exécuter des commandes configurées par l'utilisateur. Une
configuration ou archive non fiable doit être traitée comme du code non fiable.
Les commandes importées restent désactivées jusqu'à confirmation explicite.

Consultez [SECURITY.md](SECURITY.md) avant de signaler une vulnérabilité. Ne
publiez jamais de secret, base locale ou archive contenant des données privées
dans une issue.

## Installation

Les versions publiées et leurs artefacts sont disponibles dans
[GitHub Releases](https://github.com/NeKeR53/WorkOnIt/releases). Tant qu'aucune
version stable n'est publiée, construisez l'application depuis les sources.

### Prérequis de développement

- Node.js 22 ou version ultérieure ;
- npm ;
- toolchain Rust stable ;
- [dépendances système Tauri 2](https://v2.tauri.app/start/prerequisites/)
  correspondant à votre plateforme.

```bash
git clone https://github.com/NeKeR53/WorkOnIt.git
cd WorkOnIt
npm ci
npm run tauri dev
```

Pour lancer seulement l'interface web :

```bash
npm run dev
```

## Vérification

```bash
npm run typecheck
npm test
npm run coverage
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
npm run tauri build -- --debug --no-bundle
```

## Architecture

- `src/` : interface React, modèles TypeScript et persistance navigateur de
  secours pour les tests web ;
- `src-tauri/src/domain.rs` : kanbans, tâches, transitions et limites WIP ;
- `src-tauri/src/storage.rs` : schéma et dépôt SQLite ;
- `src-tauri/src/automation.rs` : exécution séquentielle des actions shell ;
- `src-tauri/src/sources.rs` : aperçu JSON, JSONL et texte, puis déduplication ;
- `src-tauri/src/scheduler.rs` : calcul des échéances et règles de réveil ;
- `src-tauri/src/exchange.rs` : archives `.workonit` et frontière de confiance ;
- `docs/` : spécifications produit et UI de référence.

## Contribuer

Lisez [CONTRIBUTING.md](CONTRIBUTING.md), puis ouvrez une issue avant tout
changement important. Toute participation doit respecter le
[code de conduite](CODE_OF_CONDUCT.md).

La direction publique du projet figure dans [ROADMAP.md](ROADMAP.md). Les
changements publiés sont consignés dans [CHANGELOG.md](CHANGELOG.md).

## Licence

WorkOnIt est distribué sous licence [Apache-2.0](LICENSE). Les attributions des
dépendances et ressources tierces figurent dans
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
