# Contribuer à WorkOnIt

Merci de contribuer. Les petites corrections peuvent arriver directement en
pull request. Pour une fonctionnalité, un changement de format ou une décision
d'architecture, ouvrez d'abord une issue afin d'aligner le périmètre.

## Préparer l'environnement

1. Forkez puis clonez le dépôt.
2. Installez Node.js 22+, npm, Rust stable et les prérequis Tauri 2.
3. Exécutez `npm ci`.
4. Créez une branche courte depuis `main`.

## Règles de code

- TypeScript strict, modules ES, indentation deux espaces et format Prettier ;
- composants React et fichiers composants en `PascalCase` ;
- fonctions et variables en `camelCase` ;
- Rust formaté avec `cargo fmt` et conventions idiomatiques ;
- tout texte visible ajouté dans `src/locales/en.json` et `src/locales/fr.json` ;
- test de régression pour chaque changement de comportement ;
- aucune clé, base locale, archive privée ou donnée personnelle dans Git.

## Vérifier une contribution

```bash
npm run typecheck
npm test
npm run coverage
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Pour tout changement UI, lancez l'application et testez réellement le parcours
concerné. Ajoutez une capture aux pull requests qui modifient l'interface.

## Commits et pull requests

Utilisez des commits Conventional Commits concis, par exemple
`fix: preserve scheduled task state`. Une pull request doit expliquer le
comportement, la raison, les commandes de vérification et les risques.

Les contributions utilisent le [Developer Certificate of Origin](DCO). Signez
chaque commit :

```bash
git commit -s -m "feat: describe the change"
```

Le sign-off certifie que vous avez le droit de proposer la contribution sous la
licence du projet.

## Revue

Les mainteneurs peuvent demander des tests, documentation ou changements de
périmètre. Gardez les PR petites et répondez aux fils de revue avant fusion.
Toute participation suit [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
