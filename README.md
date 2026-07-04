# AzurMeet 💬

Site de chat vidéo aléatoire : connexion Google, matchs garçon ↔ fille obligatoires, filtre par pays, 3 signalements = ban 1 heure.

## Ce que fait le site

- **Connexion Google** obligatoire au début (vérifiée côté serveur, impossible à truquer)
- **Écran gauche** : ta caméra — le navigateur te demande la permission quand tu cliques « Activer ma caméra »
- **Écran droit** : la personne rencontrée (vraie vidéo WebRTC en direct, pas de simulation)
- **En bas** : choix du pays à rencontrer (ton pays est détecté automatiquement) + choix garçon/fille
- **Match obligatoire** garçon ↔ fille (jamais garçon-garçon ni fille-fille)
- **Signalements** : 3 signalements par 3 personnes différentes = ban automatique de 1 heure (même si la personne se reconnecte)
- **Caméra désactivable** à tout moment (bouton 📷), micro aussi (🎤)
- **Chat texte** + bouton Suivant

---

## ÉTAPE 1 — Créer ton Client ID Google (obligatoire, gratuit, ~5 min)

1. Va sur https://console.cloud.google.com et connecte-toi avec ton compte Google
2. En haut, clique sur le sélecteur de projet → **Nouveau projet** → nomme-le `AzurMeet` → Créer
3. Menu ☰ → **API et services** → **Écran de consentement OAuth** → choisis **Externe** → remplis le nom de l'app et ton email → Enregistrer
4. Menu ☰ → **API et services** → **Identifiants** → **+ Créer des identifiants** → **ID client OAuth**
5. Type d'application : **Application Web**
6. Dans **Origines JavaScript autorisées**, ajoute :
   - `http://localhost:3000` (pour tester chez toi)
   - l'adresse de ton site en ligne quand tu l'auras (ex. `https://azurmeet.onrender.com`)
7. Clique **Créer** → copie le **Client ID** (il finit par `.apps.googleusercontent.com`)

## ÉTAPE 2 — Tester sur ton ordi

Il faut Node.js (https://nodejs.org). Puis dans le dossier du projet :

```
set GOOGLE_CLIENT_ID=TON_CLIENT_ID.apps.googleusercontent.com
npm install
npm start
```

(Sur Mac/Linux : `GOOGLE_CLIENT_ID=... npm start`)

Ouvre http://localhost:3000 — ouvre 2 onglets avec 2 comptes Google différents pour tester un match (un en garçon, un en fille).

Tu peux aussi mettre ton Client ID directement dans `server.js` ligne 16 à la place de `REMPLACE_MOI...`.

## ÉTAPE 3 — Mettre en ligne sur Render (gratuit)

1. Mets le projet sur GitHub (crée un dépôt et envoie les fichiers)
2. Va sur https://render.com → crée un compte → **New** → **Web Service**
3. Connecte ton dépôt GitHub
4. Réglages :
   - **Build Command** : `npm install`
   - **Start Command** : `node server.js`
   - **Instance Type** : Free
5. Dans **Environment** → ajoute la variable :
   - `GOOGLE_CLIENT_ID` = ton Client ID
6. Déploie. Render te donne une adresse `https://ton-site.onrender.com`
7. **Important** : retourne dans Google Cloud (Étape 1, point 6) et ajoute cette adresse dans les Origines JavaScript autorisées

⚠️ La caméra ne marche qu'en **HTTPS** (Render le fait automatiquement) ou sur localhost.

---

## Bon à savoir

- **Vidéo** : elle passe en direct de navigateur à navigateur (WebRTC). Sur certains réseaux très stricts (4G, certaines écoles), il faut ajouter un serveur TURN (ex. gratuit : https://www.metered.ca/tools/openrelay/) dans `iceServers` du fichier `public/index.html`.
- **Bans** : ils sont gardés en mémoire. Si tu redémarres le serveur, les bans en cours sont effacés.
- **Légal** : un site de chat vidéo avec des inconnus doit prévoir des conditions d'utilisation, une limite d'âge (18+ recommandé) et de la modération. C'est ta responsabilité en le mettant en ligne.
