# Eraser Doc 0.1.1 — Les documents s'enregistrent de nouveau

- **Enregistrer un document fonctionne à nouveau**, qu'il soit écrit sur un fond d'Eraser ou sur
  une image importée depuis l'ordinateur. Le serveur d'Eraser refuse tout envoi de fichiers de
  plus de 1 Mo, et un document (son image pour les joueurs, son impression pour le PDF, son fond
  importé) pèse bien davantage : l'enregistrement échouait à chaque fois.
- Le document part maintenant en plusieurs envois, chacun sous cette limite. Une image importée
  trop lourde est allégée avant l'envoi (même aspect, à la taille du rendu).
- Si un envoi échoue en route, le document déjà reçu reste dans la liste : « Enregistrer » le
  termine. Les messages d'erreur disent enfin ce qui s'est passé.
- Demande Eraser 0.1.1-alpha.278 ou plus récent (inchangé).
