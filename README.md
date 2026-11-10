# Eraser Doc

Extension d'[Eraser](https://github.com/Pink-Rain/Eraser), l'application de JDR : les documents de campagne (lettres, affiches, parchemins à donner aux joueurs), avec texte, lignes, formes, images, dessin à la plume calligraphique, calques et modes de fusion, rangés en dossiers et en modèles.

L'éditeur des documents vit ici, à part de l'application principale, et se met à jour sans
réinstaller Eraser. Instructions de travail : `AGENTS.md`.

## Comment elle arrive dans Eraser

- Elle est liée à Eraser sous l'identifiant `doc` (`lib/extensions.ts` du dépôt Eraser). Une extension
  se lie dans le code d'Eraser, jamais depuis l'application.
- Chaque version publiée (une Release GitHub de ce dépôt) joint deux fichiers :
  `eraser-extension.json` (identifiant, version, version d'API, empreinte SHA-256) et
  `eraser-extension.pack.gz` (les fichiers de l'extension). Ils sont fabriqués par
  `scripts/pack-extension.mjs`, recopié depuis Eraser.
- Toutes les installations d'Eraser la téléchargent, la vérifient et la mettent à jour toutes
  seules (au lancement, toutes les six heures, et avec « Chercher les mises à jour »). Les droits
  se règlent par module : l'éditeur, les MJ et les administrateurs.
- Elle s'ouvre dans Eraser à l'adresse `/extension/doc/campagne/<id>`, avec la barre latérale d'Eraser.

Le contrat complet (module `Page`, pièces prêtées, partie serveur, données partagées, version d'API) est décrit
dans la section « Extensions » de l'[ARCHITECTURE.md d'Eraser](https://github.com/Pink-Rain/Eraser/blob/windows-app-migration/ARCHITECTURE.md).
