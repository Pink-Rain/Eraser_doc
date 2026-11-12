# Eraser Doc 0.3.0 — Plusieurs pages, couvertures, titres en or, fonds à soi

Avec Eraser 0.1.1-alpha.291 ou plus récent :

- **Un document de plusieurs pages.** Une barre des pages, sous les outils, montre chaque page en
  vignette : un clic l'ouvre, les flèches (ou Page ↑ / Page ↓) passent à la précédente ou à la
  suivante. « + » ajoute une page juste après celle qui est ouverte, **sur le même fond** (ses
  zones de texte reviennent vides, au même endroit et dans le même style : la suite de la page)
  ou **sur un autre fond**. Une page se duplique, se déplace avant ou après sa voisine, et se
  retire (Ctrl+Z la remet). 30 pages au plus ; le bouton « Fond » change le fond de la page
  ouverte seulement.
- **Une couverture et une image de fin.** Deux boutons de la barre des pages : la couverture est
  toujours la première page, l'image de fin toujours la dernière. On y écrit comme sur une page ; la
  couverture arrive avec le titre du document, en or et en relief. Les fonds marqués « Couverture »
  (ou « Fin ») sont proposés en premier.
- **Les fonds rangés par mots-clés.** Partout où on choisit un fond (nouveau document, Fond, nouvelle
  page, couverture, fin), les fonds sont rangés en sections, une par mot-clé.
- **La roue de réglages** (Administration › Extensions, administrateurs) : la bibliothèque des
  fonds. On ajoute une image, on lui donne un nom et des mots-clés, on les change, on la retire (les
  documents qui s'en servent la gardent) ; on change aussi les mots-clés des trois fonds fournis.
- **Relief et métal** (bouton « Effets » d'une zone de texte) : un texte sortant ou gravé, avec la
  direction de la lumière, la profondeur, la douceur de l'ombre et le contraste ; un texte en or,
  argent, bronze ou cuivre. Le rendu donné aux joueurs dessine exactement la même chose.
- **Ça reste un seul document** : les joueurs le lisent page par page avec de petites flèches (la
  couverture et l'image de fin sont nommées), le PDF contient toutes les pages, Roll20 reçoit un
  handout (la première page) et le PDF complet.
- **« Donner à… » : joueurs, marchands, puis PNJ.** Chez un marchand (un magasin sauvegardé), le
  document est mis en vente : un prix, des exemplaires, et le voilà en rayon ; un joueur qui
  l'achète le reçoit prêt à être lu. Un PNJ le reçoit dans son Sac à dos.
- **Le journal de la session** : à côté de la session du document, un œil le montre aux joueurs
  dans le journal de cette session (catégorie Objets) ou le leur cache (caché au départ).

L'extension demande maintenant l'API 4 des extensions (Eraser alpha 290 ou plus récent). Avec un
Eraser qui ne garde pas encore une nouveauté, l'éditeur ne la propose pas.
