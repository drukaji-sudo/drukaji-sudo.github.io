# Frost Tower Live

Jeu web inspiré du feeling vertical d'Icy Tower, jouable sur GitHub Pages avec amis en live via Supabase Realtime.

## Fonctionne avec

- HTML/CSS/JavaScript pur
- GitHub Pages
- Supabase Realtime Presence + Broadcast

## Installation rapide

1. Crée un projet Supabase.
2. Va dans Project Settings > API.
3. Copie :
   - Project URL
   - anon/public key
4. Ouvre `config.js` et ajoute tes infos :

```js
window.FROST_TOWER_CONFIG = {
  SUPABASE_URL: "https://TON-PROJET.supabase.co",
  SUPABASE_ANON_KEY: "TA_CLE_ANON_PUBLIC"
};
```

Tu peux aussi laisser vide et entrer les infos directement dans le menu du jeu.

## GitHub Pages

1. Crée un repo GitHub.
2. Upload ces fichiers à la racine :
   - index.html
   - style.css
   - game.js
   - config.js
3. Va dans Settings > Pages.
4. Source : Deploy from a branch.
5. Branche : main / root.
6. Ton jeu sera disponible sur `https://tonnom.github.io/nom-du-repo/`.

## Notes importantes

- La clé anon/public Supabase est faite pour être publique côté navigateur.
- Pour ce prototype, le live utilise Broadcast/Presence, donc pas besoin de table SQL.
- Les scores ne sont pas encore persistants en base de données.
- Pour une vraie version production, ajoute :
  - un système de compte
  - une table scores
  - des règles RLS
  - un anti-cheat serveur ou validation Edge Function

## Idées de futures features

- Skins de joueur
- Rooms privées avec mot de passe
- Classement permanent Supabase
- Replays
- Power-ups
- Sons et musique
- Mode spectateur


## Correctif gameplay

- Le joueur commence maintenant sur une vraie plateforme.
- Les premières plateformes sont rapprochées et atteignables.
- La gravité et la force de saut ont été ajustées pour un gameplay plus proche d'un tower jumper.


## Configuration Supabase ajoutée

La clé publishable Supabase a été ajoutée dans `config.js`.

Il reste à ajouter le Project URL Supabase :

```js
SUPABASE_URL: "https://TON-PROJET.supabase.co"
```

Sans le Project URL, le live/rooms ne peut pas se connecter.


## Mise à jour personnalisation

- Bouton visible `Config Supabase` retiré du menu joueur.
- Ajout personnalisation du personnage : couleur du corps, couleur des yeux et style.
- Les personnalisations sont envoyées en live aux autres joueurs dans la room.
