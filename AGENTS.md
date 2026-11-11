# Instructions pour les IA travaillant sur Eraser Doc

Eraser Doc est l'éditeur des documents de campagne d'Eraser (dépôt principal : `Pink-Rain/Eraser`),
publié comme extension : lettres, parchemins, pages de grimoire écrits sur un fond, donnés aux
joueurs et envoyés à Roll20. Eraser l'affiche dans sa coque à l'adresse
`/extension/doc/campagne/<id>` (`?document=`, `?nouveau=1`, `&session=`). Le contrat des extensions
est décrit dans la section « Extensions » de l'`ARCHITECTURE.md` d'Eraser.

## Ce qui vit où

- Ici : l'éditeur (`src/document-studio.tsx` ; la scène `src/document-stage.tsx` ; les petits
  panneaux `src/document-tools.tsx` ; la liste rangée en dossiers `src/document-library.tsx`), son
  rendu (`src/document-render.ts` : l'image WebP que reçoivent les joueurs et Roll20, l'impression
  JPEG du PDF), le texte riche (`src/document-text.ts`), les éléments communs à la scène et au rendu
  (`src/document-elements.ts` : ordre des calques, modes de fusion, lignes, formes, plume
  calligraphique), les polices et les fonds (`assets/`, déclarés dans `src/document-assets.ts`,
  servis à côté du module). `src/main.tsx` exporte `Page`.
- **Le rendu doit dessiner comme l'éditeur** : toute mise en forme ou tout élément ajouté à
  l'éditeur l'est aussi au rendu (mêmes coupures de lignes, mêmes pointillés, mêmes chemins de
  formes et dégradés, même mode de fusion CSS/canvas, `blendModes`), sinon l'image donnée aux
  joueurs ne ressemble plus à ce que le MJ a fait. Une forme se dessine à part puis se fond d'un
  seul tenant, comme le SVG de la scène.
- Un document : une ou plusieurs pages (30 au plus), chacune avec son fond et ses zones de texte,
  lignes, formes, images posées et calques de dessin, dans l'ordre de `content.order`. La première
  page est le `background` et le `content` du document (ce que lit un Eraser sans pages) ; les
  suivantes sont dans `pages` (`id`, `background`, `content`), envoyé seulement si Eraser annonce
  `pages`. Le brouillon de l'éditeur tient toutes les pages (`Draft.pages`, `Draft.page` : la
  page ouverte) ; annuler revient aussi sur les pages. « Enregistrer » dessine chaque page
  (`render`/`print`, puis `render-<n>`/`print-<n>`) ; le fond importé d'une page part avec elle
  (`background`, `background-<id>`) quand il est nouveau ou que la page a changé de place, car
  Eraser range à part celui de la première (`savedFonds` dit où il est). Une page dupliquée
  renomme ses éléments et ses calques de dessin (`copiedContent`) : deux pages ne partagent
  jamais un calque. Un calque de dessin garde ses coups de plume en mémoire (annuler trait par
  trait) et part dans Drive comme une image à l'enregistrement (`piece-<nom>`) ; une image posée
  aussi. Dossier et modèle s'enregistrent tout seuls (`PATCH`), sans redessiner.
- **Seuls les types viennent du modèle d'Eraser pour les nouveautés** : une valeur nouvelle du
  modèle (liste, fonction) n'existe pas dans un Eraser plus ancien, qui prête quand même l'ancien
  module. L'éditeur lit `features` (`?atelier=1`) et ne propose un outil que si Eraser sait le
  garder (`calques`, `formes`, `dossiers`, `modeles`, `pages`). « Donner à… » reçoit de
  `?atelier=1` les `players`, puis les `merchants` et les `npcs` (absents d'un Eraser plus ancien).
- **Les envois de fichiers passent par `src/document-upload.ts`** : avant l'alpha 286, le serveur
  d'Eraser (vinext) refusait (413) tout POST `multipart/form-data` de plus de 1 Mo, même vers
  `/api/…` ; les images y sont alors ajustées et réparties en plusieurs envois. Depuis, Eraser
  accepte 40 Mo et annonce `envoi-unique` dans `features` : tout part en un envoi (une seule
  lecture et écriture dans Google Sheets). Une image importée reste sous 4 Mo.
- Dans Eraser : le modèle pur (`lib/document-model.ts` : types, clés des polices et des fonds,
  nettoyage, marque d'inventaire, adresses ; emprunté), la feuille « Documents de campagne », les
  API (`/api/campaigns/<id>/documents…`, `?atelier=1` pour les données de l'éditeur), la lecture
  (`components/eraser/document-viewer.tsx`, empruntée), l'inventaire, le Créateur de session et Roll20.
- Un élément ou un champ nouveau : d'abord dans le nettoyage de `lib/document-model.ts` d'Eraser
  (qui efface ce qu'il ne connaît pas) et dans ses `features`, publié ; puis ici.
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
- `npm test` : `tests/*.test.mjs` (fonds et polices : chaque clé d'Eraser a ses fichiers ; un
  document neuf, chaque nouvel élément et des pages faites par l'éditeur passent le nettoyage
  d'Eraser sans rien perdre ; ordre des calques, formes, dégradés ; pages dupliquées ; envois sous
  1 Mo, fonds des pages dans le premier envoi), avec les modules d'Eraser comme à l'exécution.
- `npm run pack` : `release/eraser-extension.json` et `release/eraser-extension.pack.gz`.

## Publier

- Incrémenter `version` dans `package.json` et réécrire `RELEASE.md`, puis pousser sur `main` :
  le workflow construit contre `windows-app-migration` d'Eraser et publie la Release
  `v<version>`. Sans incrément, rien n'est publié. Publier sans demander, comme les alpha d'Eraser.
- Si l'extension a besoin d'Eraser plus récent (nouveau module prêté, nouvelle API), publier Eraser
  d'abord, puis l'extension.
