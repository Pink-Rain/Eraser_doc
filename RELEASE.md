# Eraser Doc 0.3.1 — Enregistrer, quitter, modèles : sans mauvaise surprise

Avec Eraser 0.1.1-alpha.293 ou plus récent :

- **Un modèle est maintenant un vrai modèle.** « Enregistrer comme modèle » en fait une **copie à
  part**, rangée dans le dossier **« Modèles »** : le document d'origine reste un document, et le
  retoucher ne change plus le modèle. Un document écrit à partir d'un modèle ne change ni le modèle
  ni l'original. Un modèle ouvert le dit en haut de l'éditeur, avec **« Écrire un document à partir
  de ce modèle »** ; « Retirer des modèles » en refait un simple document.
- **Corrigé : l'original écrasé par sa copie.** Après avoir écrit dans une copie (modèle,
  « Dupliquer »), rouvrir l'original affichait le texte de la copie, et la moindre retouche
  l'enregistrait dans l'original. Chaque document ouvert affiche désormais son propre texte (de
  même après « Le reprendre »).
- **Corrigé : « modifications non enregistrées » après avoir enregistré.** Une image posée puis
  retirée (ou annulée par Ctrl+Z) laissait le document « modifié » pour toujours : avertissement en
  le quittant, et un brouillon de secours à la réouverture.
- **Corrigé : le brouillon fantôme.** Le brouillon de secours s'efface dès que le document revient
  à son état enregistré (enregistré, ou modifications défaites), quand le document est supprimé, et
  il n'est plus proposé s'il ne contient rien de plus que le document enregistré. Un document neuf
  qu'on n'a pas encore touché ne demande plus « Abandonner les modifications ? ».
- **Une copie pas encore enregistrée ne rouvre plus l'original** si la page s'actualise (ou se
  recharge après une mise à jour d'Eraser) : son brouillon est proposé.
- **« Dupliquer » garde la session** du document.
