# Eraser Doc

Extension d'[Eraser](https://github.com/Pink-Rain/Eraser), l'application de JDR : les documents de campagne (lettres, affiches, parchemins à donner aux joueurs).

Ce dépôt ne contient pas encore de code. L'extension sera construite ici, à part de l'application
principale, et publiée sans réinstaller Eraser.

## Comment elle arrive dans Eraser

- Elle est liée à Eraser sous l'identifiant `doc` (`lib/extensions.ts` du dépôt Eraser). Une extension
  se lie dans le code d'Eraser, jamais depuis l'application.
- Chaque version publiée (une Release GitHub de ce dépôt) joint deux fichiers :
  `eraser-extension.json` (identifiant, version, version d'API, empreinte SHA-256) et
  `eraser-extension.pack.gz` (les fichiers de l'extension). Ils sont fabriqués par
  `scripts/pack-extension.mjs`, recopié depuis Eraser.
- Toutes les installations d'Eraser la téléchargent, la vérifient et la mettent à jour toutes
  seules (au lancement, toutes les six heures, et avec « Chercher les mises à jour ») ; qui peut
  l'ouvrir est réglé dans Eraser (`openTo`).
- Elle s'ouvre dans Eraser à l'adresse `/extension/doc`, avec la barre latérale d'Eraser.

Le contrat complet (module `mount`, partie serveur, données partagées, version d'API) est décrit
dans la section « Extensions » de l'[ARCHITECTURE.md d'Eraser](https://github.com/Pink-Rain/Eraser/blob/windows-app-migration/ARCHITECTURE.md).
