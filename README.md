# WorkOnIt

Application desktop locale de kanban et d’automatisation, construite avec
Tauri, Rust, React, TypeScript et SQLite.

## Développement

Prérequis : Node.js, npm, Rust et les dépendances système de Tauri.

```bash
npm install
npm run dev
```

Pour lancer l’application desktop :

```bash
npm run tauri dev
```

## Vérification

```bash
npm run typecheck
npm test
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
