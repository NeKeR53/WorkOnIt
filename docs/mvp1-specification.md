# WorkOnIt — Spécification produit MVP1

Statut : validé pour planification

## 1. Vision

WorkOnIt est une application desktop locale qui permet à un utilisateur de :

1. construire des kanbans personnalisés ;
2. créer, classer et faire avancer des tâches ;
3. déclencher des chaînes de commandes shell lors des transitions entre
   colonnes ;
4. alimenter les kanbans depuis la sortie de commandes ;
5. planifier ces collectes ;
6. exporter et importer sa configuration.

Le produit est local, mono-utilisateur et utilisable hors ligne. Il ne fournit
ni collaboration temps réel ni synchronisation cloud native.

## 2. Plateformes et socle technique

### 2.1 Plateformes MVP1

- Windows 10/11 ;
- macOS.

### 2.2 Technologies imposées

- Tauri pour l'application desktop ;
- Rust pour le moteur local ;
- React et TypeScript pour l'interface ;
- Tailwind CSS et shadcn/ui pour le système visuel ;
- SQLite pour la persistance structurée.

### 2.3 Cycle de vie de l'application

- Une seule application et un seul processus moteur par session utilisateur.
- Une seconde ouverture réactive la fenêtre existante.
- Une seconde ouverture avec un fichier `.workonit` transmet ce fichier à
  l'instance existante pour lancer le parcours d'import.
- Fermer la fenêtre conserve le moteur en arrière-plan dans la zone de
  notification ou la barre des menus.
- Une commande explicite `Quitter WorkOnIt` arrête le moteur et les
  planifications.
- Le lancement automatique à l'ouverture de session est optionnel.
- MVP1 utilise une fenêtre principale unique et une navigation interne entre
  kanbans.

## 3. Modèle fonctionnel

WorkOnIt sépare trois concepts :

- **Source** : exécute une commande, analyse sa sortie et crée ou met à jour des
  tâches.
- **Action** : exécute une commande à la suite d'une transition de tâche.
- **Déclencheur** : lance une source manuellement ou selon une planification.

Les sources et actions utilisent le même moteur d'exécution shell, mais restent
des objets distincts dans le modèle et dans l'interface.

## 4. Kanbans

### 4.1 Personnalisation

Chaque kanban permet de configurer :

- le nombre de colonnes ;
- le nom et l'ordre des colonnes ;
- les transitions autorisées ;
- les limites de travail en cours ;
- les champs personnalisés des tâches ;
- les actions associées aux transitions.

Colonnes et transitions possèdent des identifiants stables. Renommer une
colonne ne casse donc pas les automatisations qui la référencent.

### 4.2 Transitions

- Tous les déplacements sont autorisés par défaut.
- Un kanban peut restreindre les transitions autorisées.
- Une tentative de transition interdite est bloquée et expliquée.
- Une automatisation est attachée à une transition précise
  `colonne source -> colonne cible`.
- Des raccourcis de configuration peuvent représenter
  `toute colonne -> colonne cible`.
- Toute origine de transition déclenche le même moteur : glisser-déposer,
  édition, source, futur plugin ou système.
- Une automatisation peut filtrer l'origine de la transition : `utilisateur`,
  `source`, `plugin` ou `système`.
- Un déplacement automatique configuré dans une source reste une vraie
  transition et peut donc lancer des actions.

### 4.3 Limites WIP

Chaque colonne peut définir :

- aucune limite ;
- une limite produisant un avertissement ;
- une limite bloquante.

Les sources respectent ces règles. Une tâche qui ne peut pas entrer dans une
colonne bloquée est conservée en attente et signalée, jamais perdue.

### 4.4 Suppression d'une colonne

Une colonne contenant des tâches ou référencée par des transitions ne peut pas
être supprimée immédiatement.

Le parcours de suppression doit :

1. demander une colonne de destination pour les tâches ;
2. afficher les tâches concernées ;
3. afficher les automatisations qui deviendront invalides ;
4. déplacer les tâches ;
5. conserver mais désactiver les automatisations invalidées.

Aucun effacement en cascade silencieux n'est autorisé.

### 4.5 Ordre et affichage

- L'ordre manuel des cartes est persistant.
- Des tris visuels temporaires sont proposés : date, priorité, titre ou champ
  personnalisé.
- Un tri visuel ne réécrit pas l'ordre manuel.
- MVP1 ne prend pas en charge le déplacement groupé. Une tâche est déplacée à
  la fois.

## 5. Tâches

### 5.1 Champs fondamentaux

Chaque tâche possède au minimum :

- identifiant interne ;
- titre ;
- description ;
- colonne ;
- ordre ;
- tags ;
- notes manuelles ;
- dates de création et de modification ;
- statut d'exécution courant ;
- historique des transitions.

### 5.2 Champs personnalisés

Un kanban peut ajouter des champs typés :

- texte ;
- nombre ;
- booléen ;
- date ;
- liste ;
- secret.

Les actions et sources peuvent référencer ces champs. Les valeurs secrètes ne
sont jamais enregistrées en clair dans SQLite.

### 5.3 Archivage et suppression

- L'action courante de retrait est `Archiver`.
- La suppression définitive est disponible uniquement depuis les archives.
- La suppression définitive exige une confirmation.
- L'historique et les logs associés restent soumis à leur politique de
  rétention.

## 6. Bibliothèque d'actions

### 6.1 Réutilisation

- Les actions appartiennent à une bibliothèque globale.
- Plusieurs kanbans et transitions peuvent référencer la même action.
- Une transition peut fournir des paramètres propres à l'action.
- Un export de kanban peut embarquer les actions nécessaires.

### 6.2 Variantes par système

Une action peut déclarer une implémentation différente pour Windows et macOS.
Aucune traduction de commande n'est réalisée automatiquement.

Runners guidés MVP1 :

- Windows : PowerShell, `pwsh`, `cmd` ou exécutable personnalisé ;
- macOS : `zsh`, `bash`, `pwsh` ou exécutable personnalisé.

Un runner personnalisé indique explicitement le chemin de l'exécutable et ses
arguments. Une action sans variante compatible est marquée incompatible sur le
système courant.

WSL ne fait pas partie du MVP1. Aucun mécanisme de traduction des chemins WSL
n'est prévu.

### 6.3 Contexte d'exécution

- Les commandes tournent avec les droits du compte utilisateur courant.
- L'exécution avec des droits administrateur est interdite et non prise en
  charge.
- WorkOnIt ne propose aucun mécanisme UAC, `sudo` ou équivalent et refuse
  d'exécuter des commandes lorsqu'il détecte un contexte élevé.
- Aucun sandbox système spécifique en MVP1.
- Le shell est non interactif par défaut.
- Les profils utilisateur comme `.zshrc` ou le profil PowerShell ne sont pas
  chargés par défaut.
- Une action peut explicitement demander le chargement du profil utilisateur.
- Le dossier de travail est visible et configurable.

### 6.4 Transmission des données de tâche

WorkOnIt transmet les données de tâche de deux façons sûres :

1. variables d'environnement, par exemple `WORKONIT_TITLE` ;
2. document JSON complet sur l'entrée standard de la commande.

Exemples :

```bash
deploy "$WORKONIT_TITLE"
```

```powershell
deploy $env:WORKONIT_TITLE
```

L'interpolation directe avec une syntaxe de template reste disponible en mode
avancé. L'interface avertit du risque de casse d'échappement ou d'injection.

### 6.5 Chaînes d'actions

- Une transition peut lancer plusieurs actions.
- Les actions s'exécutent en série et dans un ordre défini.
- Chaque étape choisit `arrêter la chaîne si échec` ou `continuer`.
- Les actions peuvent avoir des conditions simples portant sur les champs de la
  tâche, l'origine de la transition ou le système d'exploitation.
- Les conditions utilisent un éditeur visuel ; MVP1 n'ajoute pas un langage de
  script dédié.
- Le parallélisme entre actions est hors périmètre MVP1.

### 6.6 Succès, échec et reprise

- Code de sortie `0` : succès par défaut.
- Une action peut déclarer d'autres codes acceptés.
- Une validation optionnelle de `stdout` peut utiliser une regex ou JSONPath.
- Timeout et annulation sont des états distincts de l'échec.
- Le timeout par défaut est de cinq minutes par action ou source.
- Le timeout est configurable.
- L'option `sans limite` est autorisée mais clairement signalée.
- Une annulation tue l'arbre de processus enfant, pas uniquement le shell
  parent.

Lorsqu'une action échoue :

- la tâche reste dans la colonne cible ;
- la carte affiche l'état `Échec` ;
- l'action fautive et ses logs sont accessibles ;
- aucun retour automatique de colonne n'a lieu ;
- `Relancer` reprend depuis l'action échouée ;
- `Tout relancer` recommence la chaîne après avertissement.

Ce comportement évite de prétendre annuler des effets externes déjà produits.

### 6.7 Verrouillage pendant exécution

Une tâche est verrouillée pendant l'exécution de sa chaîne. Elle affiche la
progression et un bouton d'annulation. Un nouveau déplacement devient possible
après fin ou annulation.

### 6.8 Crash et résultat inconnu

Si l'application ou la machine s'arrête pendant une commande :

- l'exécution devient `Interrompue — résultat inconnu` au prochain démarrage ;
- aucune relance automatique n'a lieu ;
- l'utilisateur choisit de reprendre depuis l'étape interrompue ou d'abandonner.

### 6.9 Sortie des actions

Dans MVP1, `stdout` et `stderr` des actions servent aux logs et aux validations.
Ils ne créent pas de tâche et ne modifient pas la tâche courante.

## 7. Sources de tâches

### 7.1 Fonctionnement

Une source :

1. exécute une commande ;
2. capture sa sortie ;
3. analyse zéro, un ou plusieurs enregistrements ;
4. prévisualise les tâches résultantes ;
5. crée ou met à jour les tâches autorisées.

### 7.2 Formats MVP1

- JSON ;
- JSONL ;
- texte libre.

JSON et JSONL sont privilégiés. CSV n'est pas prévu dans MVP1.

### 7.3 Mapping

- JSON/JSONL utilise JSONPath.
- Le texte libre utilise des regex avec groupes nommés.
- L'éditeur accepte une sortie réelle ou un exemple collé.
- L'aperçu montre les tâches qui seraient produites avant activation.
- Une erreur sur un élément est affichée ligne par ligne et n'efface pas les
  éléments valides.

### 7.4 Code de sortie en échec

Si la commande source retourne un code d'échec :

- l'exécution est marquée échouée ;
- aucune tâche n'est créée automatiquement ;
- la sortie et son aperçu restent disponibles ;
- l'utilisateur peut choisir `Importer quand même` ;
- une source peut activer explicitement `Accepter les données partielles`.

### 7.5 Déduplication et mise à jour

Une source peut mapper une clé externe unique, par exemple un identifiant de
ticket ou une URL.

- Clé inconnue : création.
- Clé connue : mise à jour.
- Aucune clé configurée : création systématique avec avertissement.

La source met à jour uniquement les champs explicitement autorisés. Colonne,
ordre, notes manuelles et historique sont protégés par défaut.

Le déplacement automatique est une règle distincte, visible et explicite. Il
déclenche les actions de transition selon les règles normales.

### 7.6 Colonne initiale

- Une colonne fixe est obligatoire par défaut.
- Un mapping dynamique peut choisir une colonne depuis les données source.
- Une table de correspondance transforme les valeurs externes.
- Une valeur inconnue utilise une colonne de secours configurée.
- Aucune tâche n'est perdue silencieusement.

### 7.7 Disparition d'un élément externe

Une tâche absente des résultats successifs n'est ni supprimée ni déplacée.
Après un nombre configurable d'absences, elle reçoit l'état
`Absent de la source`. Une règle séparée pourra ultérieurement l'archiver ou la
déplacer.

### 7.8 Concurrence

- Une seule exécution active par source.
- Si une échéance arrive pendant une exécution, elle est ignorée et journalisée
  comme `exécution déjà active`.
- Aucun empilement silencieux en file d'attente.
- L'utilisateur peut arrêter l'exécution active.

### 7.9 Taille et encodage des sorties

- Limite par défaut : 10 Mo pour `stdout` et 10 Mo pour `stderr` par exécution.
- La limite est configurable.
- Au-delà, la capture est tronquée mais le processus peut continuer.
- Une source refuse d'analyser automatiquement une sortie tronquée ; un import
  manuel reste possible après validation.
- Encodage par défaut : UTF-8.
- Encodages alternatifs : Windows-1252, encodage console système ou détection
  automatique.
- Les octets invalides sont signalés, jamais corrigés silencieusement.

## 8. Déclencheurs MVP1

MVP1 prend en charge :

- lancement manuel ;
- intervalle régulier ;
- planification guidée quotidienne ou hebdomadaire ;
- expression cron avancée.

Chaque déclencheur utilise le fuseau système par défaut et peut définir un autre
fuseau.

Lors d'un changement d'heure :

- une heure inexistante est ignorée ;
- une heure répétée n'est exécutée qu'une fois.

Pendant arrêt ou veille de la machine :

- aucune rafale de rattrapage n'est lancée ;
- une option `Rattraper la dernière exécution` permet un seul lancement au
  retour ;
- sinon le moteur attend la prochaine échéance ;
- les occurrences manquées apparaissent dans l'historique.

WebSocket, webhook HTTP, surveillance de fichier et autres déclencheurs
événementiels sont hors périmètre MVP1.

## 9. Brouillons, tests et activation

### 9.1 Publication

- Les tâches et kanbans sont sauvegardés automatiquement.
- Les modifications d'une automatisation restent en brouillon.
- L'ancienne version reste active pendant l'édition.
- L'utilisateur utilise `Tester`, puis `Enregistrer et activer`.

### 9.2 Test

Deux opérations distinctes sont proposées :

- `Prévisualiser` affiche commande, paramètres, variables et mapping sans
  exécuter ;
- `Exécuter le test` lance réellement la commande avec une tâche exemple et une
  confirmation explicite.

WorkOnIt ne prétend pas fournir un dry-run universel pour des commandes shell.

### 9.3 Confirmation avant transition

- Une transition validée lance ses actions immédiatement par défaut.
- Une transition peut activer `Demander confirmation`.
- Une action marquée destructive impose cette confirmation.
- Aucun bouton d'annulation ne prétend inverser les effets externes déjà
  produits.

## 10. Stockage et résilience

### 10.1 Emplacements

Les données résident dans le dossier applicatif du système :

- Windows : dossier Local App Data de WorkOnIt ;
- macOS : dossier Application Support de WorkOnIt.

La base SQLite centrale stocke les kanbans, tâches, sources, actions,
déclencheurs, versions et métadonnées d'exécution. Des sous-dossiers séparés
contiennent logs et sauvegardes.

Les kanbans ne sont pas des fichiers de travail individuels. Ils deviennent des
fichiers uniquement lors d'un export.

### 10.2 Sauvegardes

- Snapshot SQLite quotidien.
- Snapshot avant import ou migration.
- Conservation par défaut : sept sauvegardes quotidiennes et quatre
  hebdomadaires.
- Restauration depuis les réglages.
- Les secrets restent hors sauvegarde.

### 10.3 Logs

- Conservation par défaut : 30 jours ou 100 Mo, première limite atteinte.
- Rotation automatique.
- Limites globales configurables.
- `stdout` et `stderr` sont consultables.
- Export manuel possible.
- Les secrets connus sont masqués.
- Les notifications de succès sont désactivées par défaut.
- Échecs, demandes de confirmation et sources bloquées produisent une
  notification système par défaut.
- Les notifications de succès, échec, confirmation et source bloquée sont
  configurables globalement et par automatisation.

## 11. Secrets et sécurité

### 11.1 Secrets

- Windows utilise Windows Credential Manager.
- macOS utilise Keychain.
- Une action ou source référence un secret par nom logique.
- Aucun secret dans SQLite, les exports, les sauvegardes ou les logs.
- Les valeurs secrètes ne sont jamais affichées après saisie.

### 11.2 Commandes importées

Les actions, sources et déclencheurs contenant du shell restent désactivés après
import. Un écran de confiance affiche :

- chaque commande ;
- le shell ou l'exécutable ;
- le dossier de travail ;
- les variables transmises ;
- les permissions attendues.

L'utilisateur doit valider explicitement avant activation.

### 11.3 Limites du modèle de sécurité MVP1

Une commande shell approuvée dispose des accès normaux du compte utilisateur.
MVP1 ne fournit pas de sandbox multiplateforme. L'interface doit donc rendre le
niveau de confiance et les effets possibles visibles avant exécution.

## 12. Export et import

### 12.1 Format

Un export produit une archive ZIP portant l'extension `.workonit`. Elle contient
un manifeste versionné et des fichiers JSON lisibles.

L'utilisateur choisit les kanbans, actions, sources et déclencheurs associés à
inclure.

Toujours exclus :

- secrets ;

Exclus par défaut, mais exportables manuellement :

- logs ;
- historique d'exécution.

### 12.2 Prévisualisation et conflits

Tout import présente un aperçu avant écriture. Pour chaque identifiant déjà
présent, l'utilisateur choisit :

- `Mettre à jour` ;
- `Créer une copie` avec nouvel identifiant ;
- `Ignorer`.

Aucun remplacement silencieux n'est autorisé. Un snapshot automatique précède
l'import.

## 13. Interface et design

La [spécification UI MVP1](./ui-design.md) définit la direction visuelle, la
structure de fenêtre et les comportements d'interface obligatoires.

### 13.1 Principes

- Material Design 3 flat adapté au desktop, sans reproduire strictement une
  application Google.
- Surfaces pleines, couleurs tonales et ombres rares.
- Aucun gradient décoratif ni glassmorphism.
- Vue kanban simple par défaut.
- Panneau d'automatisation guidé.
- Densité confortable.
- Navigation latérale gauche rétractable et panneau droit contextuel.
- Complexité révélée progressivement.
- Les options shell, regex, JSONPath et permissions restent accessibles dans
  des sections avancées, sans créer un mode utilisateur irréversible.

### 13.2 Thèmes et langues

- thème clair ;
- thème sombre ;
- suivi du thème système ;
- français et anglais ;
- langue système utilisée par défaut ;
- textes externalisés dès MVP1.

### 13.3 Accessibilité

- navigation clavier complète ;
- contraste WCAG AA ;
- focus visible ;
- préférence de réduction des animations ;
- commande `Déplacer vers…` comme alternative au glisser-déposer.

## 14. Architecture plugins future

Le chargeur de plugins n'est pas implémenté dans MVP1. L'architecture doit
toutefois préserver ses futures frontières.

### 14.1 Modèle prévu

- Plugin exécuté dans un processus séparé.
- Communication JSON-RPC versionnée.
- Aucun chargement direct de DLL ou `dylib` dans WorkOnIt.
- Un crash plugin ne doit pas arrêter le kanban.
- Un plugin pourra être écrit en Rust, Node.js ou autre langage compatible avec
  le protocole.

### 14.2 Premiers points d'extension MVP2

- fournisseurs de Sources ;
- fournisseurs d'Actions ;
- authentification et connexions ;
- validation et test de connexion.

Les déclencheurs personnalisés, rendus de cartes et vues arbitraires sont
reportés.

Un plugin Jira devra pouvoir importer les tickets et proposer des actions comme
transitionner ou commenter un ticket.

### 14.3 Interface et permissions plugins

- Les formulaires sont déclarés par schéma JSON et rendus par WorkOnIt avec ses
  composants shadcn/ui.
- Aucune interface web arbitraire injectée initialement.
- Le manifeste déclare accès réseau et domaines, secrets, fichiers, commandes
  et notifications.
- Un changement de permissions désactive le plugin jusqu'à nouvelle validation.
- L'installation future commence par archive locale signée ou dossier
  développeur.
- Marketplace et mise à jour automatique sont ultérieures.
- Une mise à jour conserve la version précédente pour rollback.

## 15. Distribution

- Windows : installateur `.exe`.
- macOS : image `.dmg` contenant l'application `.app`.
- Aucun package MSI.
- Aucune mise à jour automatique dans MVP1.
- La signature des builds n'est pas une exigence de livraison MVP1.
- Une éventuelle diffusion publique devra définir séparément sa politique de
  signature Windows et de signature/notarisation macOS.

## 16. Objectifs de capacité

MVP1 vise au minimum :

- 50 kanbans ;
- 10 000 tâches actives ;
- 100 000 tâches archivées ;
- 200 automatisations ;
- aucune dégradation visible dans l'usage normal.

Les colonnes doivent être virtualisées dès la conception pour soutenir ces
volumes.

## 17. Hors périmètre MVP1

- collaboration multi-utilisateur ;
- synchronisation cloud native ;
- déplacement groupé de tâches ;
- actions parallèles ;
- CSV comme format de source ;
- WSL et traduction de chemins WSL ;
- toute exécution avec des droits administrateur ;
- sandbox multiplateforme des commandes ;
- modification des tâches par sortie d'action ;
- WebSocket, webhook et surveillance de fichiers ;
- chargeur de plugins ;
- plugin Jira ;
- marketplace de plugins ;
- interface plugin arbitraire ;
- mise à jour automatique de l'application ;
- fenêtres multiples.

## 18. Critères d'acceptation MVP1

MVP1 est terminé uniquement lorsque le parcours suivant fonctionne et est testé
sur Windows et macOS :

1. créer un kanban personnalisé ;
2. créer une tâche avec champs standards et personnalisés ;
3. configurer une transition et une chaîne de commandes ;
4. déplacer la tâche ;
5. observer progression, succès et logs ;
6. provoquer un échec ;
7. reprendre depuis l'action échouée ;
8. créer une source JSON ou JSONL ;
9. créer une source texte avec regex ;
10. prévisualiser puis importer plusieurs tâches ;
11. mettre à jour sans doublon grâce à une clé externe ;
12. planifier une source ;
13. vérifier comportement après veille ;
14. exporter puis réimporter sans activer silencieusement les commandes ;
15. restaurer après crash avec état d'exécution inconnu ;
16. restaurer une sauvegarde locale.

La validation comprend :

- tests unitaires Rust ;
- tests unitaires React/TypeScript ;
- tests d'intégration du moteur de commandes et du scheduler ;
- tests de migrations SQLite ;
- tests d'import/export et de confiance ;
- tests UI réels du parcours affecté ;
- validation manuelle finale sur Windows et macOS.

## 19. Décision de phase

MVP1 livre un kanban local personnalisable, un moteur shell sûr et visible, des
sources configurables, une planification fiable et un format d'échange robuste.

MVP2 pourra activer le système de plugins préparé par l'architecture, avec Jira
comme premier cas d'usage envisagé.
