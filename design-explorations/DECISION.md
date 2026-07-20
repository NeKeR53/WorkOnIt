# Décision UI — 16 juillet 2026

**Direction retenue : Option 4 « Atelier »** ([option-4-atelier.html](option-4-atelier.html)),
**modifiée : pas de menu latéral, navigation par onglets dans le header.**

## Structure (écart vs mockup)

- Le mockup a une sidebar : **la supprimer**. Navigation par onglets dans le
  header : `Kanbans · Sources · Automatisations · Historique`, à droite du logo
  WorkOnIt, soulignement ou aplat vert forêt sur l'onglet actif.
- Ligne de contexte sous le header : titre du kanban (`Projet Alpha`, gras 800),
  compteur de tâches, puis recherche + `Configurer` + `+ Nouvelle tâche` à droite.
- Liste des kanbans : dropdown sur le titre du kanban (plus de sous-liste sidebar).
- Archives / Réglages / Thème : menu overflow en fin d'onglets ou à droite du header.

## Langage visuel (reprendre du mockup)

- **Clair chaleureux, pas crème** : fond gris-vert `#eef0ec`, cartes `#fbfbf9`,
  encre charbon `#20241f`.
- Accents nommés : forêt `#2f5d3f` (action principale, marque), terracotta
  `#b4552d`, ardoise `#43586d`, or `#8a6d1f` (avertissements). Pas de violet.
- **Bordures noires franches** 1.5–2px, angles carrés (zéro radius).
- **Ombres dures offset** `3px 3px 0` (pas de blur) sur cartes et boutons ;
  hover = translation 1px + ombre réduite (effet « pressé »).
- En-têtes de colonnes : **aplats pleins colorés** (ardoise / terracotta / forêt),
  texte blanc, compteur en pastille translucide.
- Cartes : fiches cartonnées, titre gras, tags encadrés noirs, priorités en
  aplats colorés uppercase (`HAUTE` terracotta, `NORMALE` ardoise, `BASSE` gris).
- États d'exécution : badges encadrés `EN COURS 2/4` / `ÉCHEC` / `SUCCÈS`
  (couleur du contour = état, fond très pâle).
- WIP : encart pointillé or sur fond sable.
- Sélection carte : bordure épaissie + ombre offset vert forêt.
- Typo : Avenir Next / Segoe UI, titres en 800, corps 13.5px.

## À traiter à l'implémentation

- Thème sombre : décliner (encre inversée, mêmes accents désaturés, ombres
  offset conservées en plus sombre).
- Icônes : Material Symbols (déjà en dépendance) — trait plutôt que rempli
  pour coller au style fiche.
- Garder les acquis des passes précédentes : tokens sémantiques, a11y
  (focus visible, Échap, accent-color), labels empilés, densité 5–7 cartes.

## Rejeté

- Options 1 (graphite), 2 (éditorial), 3 (terminal), 5 (console d'ops).
- Violet Material, boutons pill arrondis, sidebar latérale, ombres floues.

**Statut : implémenté le 17 juillet 2026** (styles.css réécrit, sidebar supprimée
d'App.tsx, onglets header, switcher kanban en dropdown, couleurs de colonnes par
défaut ardoise/terracotta/forêt, thème sombre décliné, 26 tests verts).

---

# Révision — 18 juillet 2026

**La décision ci-dessus est obsolète.** Nouvelle direction retenue :
**Option 6 « Codex »** ([option-6-codex.html](option-6-codex.html)), implémentée
telle quelle (avec sidebar, contrairement à la décision du 16 juillet).

- Sidebar gris clair `#f4f4f5`, hairlines `#e5e7eb`, contenu blanc, coins
  arrondis doux (6/9/14 px), typo système, quasi monochrome.
- Couleur uniquement en touches : dots de colonnes, badges d'état pastel.
- Bouton principal : noir plein (`--ink`). Violet toujours banni.
