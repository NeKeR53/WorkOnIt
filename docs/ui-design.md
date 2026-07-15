# WorkOnIt — Spécification UI MVP1

Statut : validé pour implémentation

Cette spécification complète la
[spécification produit MVP1](./mvp1-specification.md). En cas d'ambiguïté sur
l'interface, ce document constitue la référence.

## 1. Direction visuelle

WorkOnIt utilise un Material Design 3 flat adapté à une application desktop.
Il ne cherche pas à reproduire strictement une application Google.

Principes obligatoires :

- surfaces pleines ;
- couleurs tonales ;
- hiérarchie obtenue par couleur, espacement et typographie ;
- ombres rares et légères ;
- angles modérément arrondis ;
- aucune glassmorphism ;
- aucun gradient décoratif ;
- aucune décoration sans fonction ;
- composants shadcn/ui restylés selon cette direction ;
- icônes Material Symbols.

La typographie utilise la police système : `Segoe UI` sous Windows et `SF Pro`
sous macOS. Aucune police web n'est nécessaire.

## 2. Densité et dimensions

- Densité confortable unique dans MVP1.
- Une colonne doit afficher environ cinq à sept cartes usuelles sur un écran
  portable, selon leur contenu.
- Taille minimale de fenêtre : 1024 × 700 pixels.
- Sous forte contrainte horizontale, la navigation gauche et le panneau droit
  peuvent être masqués.
- MVP1 ne propose pas de réglage de densité compacte.

## 3. Structure de la fenêtre

La fenêtre principale comporte quatre zones.

### 3.1 Navigation latérale gauche

La barre latérale contient :

- kanbans ;
- sources ;
- automatisations ;
- historique.

Elle est rétractable. Son état ouvert ou fermé est mémorisé entre les sessions.
Une fois rétractée, les fonctions principales restent accessibles sans rouvrir
la barre de façon permanente.

### 3.2 Barre supérieure

La barre supérieure contient :

- identité du kanban courant ;
- recherche dans le kanban ;
- actions principales du contexte ;
- accès au thème et aux réglages utiles.

Elle reste sobre et ne duplique pas toute la navigation latérale.

### 3.3 Zone centrale

La zone centrale affiche les colonnes du kanban horizontalement. Les colonnes
et cartes sont virtualisées lorsque le volume l'exige.

### 3.4 Panneau droit contextuel

Le panneau droit affiche selon le contexte :

- détail et édition d'une tâche ;
- configuration d'une colonne ;
- configuration d'une source ;
- configuration d'une action ou transition ;
- détail d'une exécution et de ses logs.

Il est refermable. L'ouverture d'une tâche ne navigue pas vers une page séparée.

## 4. Cartes de tâches

### 4.1 Contenu

Le titre est toujours visible. Chaque kanban choisit d'afficher ou non :

- tags ;
- priorité ;
- échéance ;
- source ;
- statut d'automatisation.

Jusqu'à trois champs personnalisés peuvent être épinglés sur la carte. Les
autres restent accessibles dans le panneau droit.

### 4.2 Couleurs

- Les fonds des colonnes et cartes restent neutres.
- Une colonne peut utiliser une couleur personnalisée dans son en-tête ou son
  liseré, jamais comme grand aplat imposé.
- Les couleurs fortes sont réservées aux états sémantiques : succès, attente,
  erreur et avertissement.
- La couleur ne constitue jamais l'unique moyen d'identifier un état.

### 4.3 État d'exécution

Une carte peut afficher un badge compact :

- `En attente` ;
- `En cours 2/4` ;
- `Échec` ;
- `Succès`.

Une barre fine montre la progression pendant une chaîne. Cliquer un échec ouvre
directement l'action fautive dans le panneau droit. Le succès disparaît de la
carte après un court délai, mais reste enregistré dans l'historique.

## 5. Déplacement des cartes

Pendant un glisser-déposer :

- la carte reçoit une légère élévation ;
- l'emplacement cible est matérialisé ;
- les colonnes interdites sont atténuées ;
- le déplacement utilise une transition d'environ 150 ms ;
- aucun effet spectaculaire n'est ajouté.

Avec la réduction des animations activée, le déplacement animé disparaît. La
commande clavier `Déplacer vers…` fournit une alternative complète au
glisser-déposer.

## 6. Éditeur de commandes

L'éditeur shell reste plus léger qu'un IDE. Il fournit :

- police monospace ;
- coloration syntaxique adaptée au runner ;
- numéros de lignes ;
- insertion guidée des variables WorkOnIt ;
- indication visible du runner et du système ciblé.

L'éditeur est organisé en onglets :

1. `Commande` ;
2. `Contexte` ;
3. `Conditions` ;
4. `Test`.

MVP1 ne fournit ni terminal intégré, ni autocomplétion complexe, ni fonctions de
mini-IDE.

## 7. Éditeur de mapping

Sur une largeur suffisante, le mapping d'une source utilise trois zones
redimensionnables :

1. sortie brute ;
2. règles JSONPath ou regex ;
3. aperçu des tâches produites.

Les erreurs sont surlignées dans la sortie concernée et dans l'aperçu. Sur une
petite largeur, les trois zones deviennent des onglets sans perdre leur état.

## 8. Recherche et palette globale

- La recherche du kanban courant reste visible dans la barre supérieure.
- `Ctrl+K` sous Windows et `Cmd+K` sous macOS ouvre la palette globale.
- La palette cherche les kanbans, tâches, actions et sources.
- Elle permet de naviguer et de lancer des commandes non destructives.
- Une opération destructive ouverte depuis la palette conserve son parcours de
  confirmation normal.

## 9. Retours utilisateur

### 9.1 Snackbars et alertes

- Les succès et informations utilisent des snackbars Material en bas à droite.
- Les erreurs importantes restent visibles jusqu'à résolution ou fermeture.
- Chaque snackbar contient au plus une action directement liée au message.
- Une sauvegarde automatique réussie ne produit pas de snackbar.

### 9.2 Dialogues

Les dialogues sont réservés à :

- une action destructive ;
- l'exécution réelle d'une commande nécessitant confirmation ;
- l'approbation de confiance après import ;
- une décision bloquante sans valeur par défaut sûre.

Les opérations ordinaires ne doivent pas être interrompues par une boîte de
dialogue.

## 10. Chargement, vide et erreur

### 10.1 Premier lancement

WorkOnIt démarre vide :

- aucun assistant obligatoire ;
- aucune donnée exemple ;
- aucune automatisation préinstallée ;
- une action principale `Créer un kanban`.

### 10.2 Chargement

- Les skeletons reprennent la forme des colonnes et cartes attendues.
- Un spinner est réservé à une opération locale courte dont la structure finale
  n'est pas encore connue.
- Aucun écran blanc bloquant ne remplace l'interface complète.

### 10.3 Erreurs

- Une erreur apparaît au plus près de l'élément concerné.
- Une action `Réessayer` est proposée lorsqu'elle est sûre.
- Les détails techniques restent accessibles sans dominer le message principal.
- Une erreur partielle ne masque pas les données encore utilisables.

## 11. Thèmes

Les modes clair, sombre et système utilisent les mêmes règles de hiérarchie.
Chaque couleur sémantique dispose d'une variante accessible dans les deux
thèmes. Le changement de thème ne modifie ni disposition ni densité.

## 12. Accessibilité

- Contraste WCAG AA minimum.
- Focus clavier toujours visible.
- Navigation complète sans souris.
- Libellés accessibles pour chaque Material Symbol.
- États communiqués par texte ou icône en plus de la couleur.
- Réduction des animations respectée.
- Ordre de tabulation cohérent entre navigation, kanban et panneau contextuel.

## 13. Hors périmètre UI MVP1

- thème fortement personnalisable par utilisateur ;
- densité compacte ;
- fenêtres multiples ;
- terminal intégré ;
- autocomplétion shell avancée ;
- interface de plugin arbitraire ;
- assistant de premier lancement ;
- données ou kanban exemple.

## 14. Critères d'acceptation UI

La direction UI est acceptée lorsque les parcours suivants sont utilisables au
clavier et à la souris, en clair et sombre, sous Windows et macOS :

1. créer le premier kanban depuis l'état vide ;
2. rétracter puis restaurer la navigation latérale ;
3. ouvrir, modifier et fermer une tâche dans le panneau droit ;
4. déplacer une carte vers une colonne autorisée ;
5. comprendre pourquoi une colonne est interdite ;
6. suivre une chaîne d'actions depuis la carte ;
7. ouvrir directement l'action en échec ;
8. prévisualiser une commande sans l'exécuter ;
9. configurer un mapping et identifier une erreur ;
10. retrouver une tâche depuis la palette globale ;
11. utiliser `Déplacer vers…` sans glisser-déposer ;
12. parcourir un chargement, un état vide et une erreur récupérable sans écran
    bloquant.
