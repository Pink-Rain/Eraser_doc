# Instructions pour les IA travaillant sur Eraser Doc

Eraser Doc est l'éditeur des documents de campagne d'Eraser (dépôt principal : `Pink-Rain/Eraser`),
publié comme extension : lettres, parchemins, pages de grimoire écrits sur un fond, donnés aux
joueurs et envoyés à Roll20. Eraser l'affiche dans sa coque à l'adresse
`/extension/doc/campagne/<id>` (`?document=`, `?nouveau=1`, `&session=`). Le contrat des extensions
est décrit dans la section « Extensions » de l'`ARCHITECTURE.md` d'Eraser.

## Ce qui vit où

- Ici : l'éditeur (`src/document-studio.tsx`, `src/document-stage.tsx`), son rendu
  (`src/document-render.ts` : l'image WebP que reçoivent les joueurs et Roll20, l'impression JPEG
  du PDF), le texte riche (`src/document-text.ts`), les polices et les fonds (`assets/`, déclarés
  dans `src/document-assets.ts`, servis à côté du module). `src/main.tsx` exporte `Page`.
- **Le rendu doit couper les lignes comme l'éditeur** : toute mise en forme ajoutée à l'éditeur
  l'est aussi au rendu, sinon l'image donnée aux joueurs ne ressemble plus à ce que le MJ a écrit.
- Dans Eraser : le modèle pur (`lib/document-model.ts` : types, clés des polices et des fonds,
  nettoyage, marque d'inventaire, adresses ; emprunté), la feuille « Documents de campagne », les
  API (`/api/campaigns/<id>/documents…`, `?atelier=1` pour les données de l'éditeur), la lecture
  (`components/eraser/document-viewer.tsx`, empruntée), l'inventaire, le Créateur de session et Roll20.
- Une police ou un fond nouveau : sa clé d'abord dans `documentFontKeys` / `builtinBackgroundKeys`
  d'Eraser (qui refuse une clé inconnue à l'enregistrement), publiée ; puis ses fichiers dans
  `assets/` et sa déclaration dans `src/document-assets.ts`. Ne jamais renommer une clé.
- Droits **par module** : l'éditeur, les MJ (de la campagne) et les administrateurs
  (`eraser.account.role`) ; les API d'Eraser vérifient toujours.
- Tout import `@/…`, React et `next/*` sont **prêtés par Eraser** à l'exécution : ne jamais les
  recopier ici. Ce qui charge encore porte `aria-busy="true"` (relevé de fluidité d'Eraser).

## Construire et vérifier

- Une copie d'Eraser (avec ses dépendances) est nécessaire : `ERASER_DIR=/chemin/vers/Eraser`, ou
  `./eraser`. Dans une session cloud, Eraser est souvent cloné dans `/home/user/Eraser`.
- `npm run build` : esbuild (React Compiler compris), Tailwind avec le thème d'Eraser, et
  `assets/` copié dans `dist/`. Il échoue si `src/` importe un module qu'Eraser ne prête pas.
- `npm run check` : types de `src/` avec ceux d'Eraser.
- `npm test` : `tests/*.test.mjs` (fonds et polices : chaque clé d'Eraser a ses fichiers, un
  document neuf passe le nettoyage d'Eraser), avec les modules d'Eraser comme à l'exécution.
- `npm run pack` : `release/eraser-extension.json` et `release/eraser-extension.pack.gz`.

## Publier

- Incrémenter `version` dans `package.json` et réécrire `RELEASE.md`, puis pousser sur `main` :
  le workflow construit contre `windows-app-migration` d'Eraser et publie la Release
  `v<version>`. Sans incrément, rien n'est publié. Publier sans demander, comme les alpha d'Eraser.
- Si l'extension a besoin d'Eraser plus récent (nouveau module prêté, nouvelle API), publier Eraser
  d'abord, puis l'extension.
