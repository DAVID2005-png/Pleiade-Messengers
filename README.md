# Pleiade Messengers

Messagerie React + Vite + Firebase.

Guide détaillé de l'application, de son architecture et des étapes de monétisation : [Guide Pleiade Messengers (PDF)](./Guide_Pleiade_Messengers.pdf).
Pour régénérer ce guide après une mise à jour, exécuter `python scripts/generate_guide.py`.

## Démarrage local

1. Installer Node.js.
2. Créer `.env` à partir de `.env.example` et renseigner la configuration Firebase.
3. Exécuter `npm install` et `npm install --prefix functions`.
4. Exécuter `npm run dev`.

Le compte utilise une adresse e-mail et un mot de passe, sans SMS. Un pseudo public unique permet de trouver des amis. Firebase Auth conserve la session localement jusqu'à la déconnexion; un lien de vérification e-mail et la réinitialisation de mot de passe sont disponibles.

## Configuration et déploiement Firebase

Dans le projet `pleiade-tech-2185e` :

1. Activer le fournisseur **E-mail/Mot de passe** dans Authentication.
2. Créer Cloud Firestore et activer Firebase Storage.
3. Ajouter `localhost` et le domaine de production aux domaines autorisés dans Authentication.
4. Se connecter avec un compte qui a accès au projet, puis déployer :

```powershell
firebase login
firebase use pleiade-tech-2185e
firebase deploy --only firestore:rules,storage,functions
```

Les Cloud Functions et Firebase Storage peuvent demander le forfait Blaze et la facturation. Aucun envoi de SMS n'est utilisé par la nouvelle inscription.

Après toute modification des règles ou des index Firestore, déployer avec `npm run deploy:rules`. Le workflow GitHub `.github/workflows/deploy-firestore-rules.yml` les déploie automatiquement après un push sur `main` ou `master` qui modifie `firestore.rules`, `firestore.indexes.json` ou `firebase.json`. Pour l’activer, ajouter dans les secrets du dépôt GitHub le JSON d’un compte de service Firebase sous le nom `FIREBASE_SERVICE_ACCOUNT_PLEIADE_TECH_2185E`.
Après une modification des Cloud Functions, déployer avec `firebase deploy --only functions --project pleiade-tech-2185e --non-interactive`.

## Fonctions

- Comptes e-mail/mot de passe, lien de vérification et session persistante.
- Pseudos uniques, invitations d'amis avec acceptation, puis création automatique d'une conversation privée.
- Conversations en temps réel, indicateur de saisie, présence, dernière activité, reçus d'envoi/lecture et date/heure des messages.
- Notifications Firestore pour les nouveaux messages, compteur non lus, ouverture directe de la conversation et notifications système du navigateur après autorisation.
- Images, documents courants et notes vocales jusqu'à 15 Mo par fichier.
- Publications publiques pour les membres connectés, avec jusqu'à 4 photos compressées, mentions J’aime uniques, commentaires, réponses, partage, téléchargement et suppression des publications/commentaires par leur auteur.
- Statuts photo publics pendant 24 heures, avec compression sans Storage, vues, mentions J’aime uniques, partage, réponses privées, téléchargement et suppression par leur auteur.
- Profil avec photo de couverture et photo de profil, modification du nom, du pseudo, de la date de naissance et du genre.
- Blocage/déblocage de comptes : retrait des amis, refus des invitations et des conversations, et masquage des publications/statuts dans l’interface.
- Réinitialisation du mot de passe et déconnexion.

Les publications et statuts restent lisibles par tout compte authentifié via les règles actuelles de leurs collections. Le blocage les masque dans l’interface et empêche les interactions, mais ne constitue pas encore une confidentialité serveur absolue pour ces contenus publics.

Les photos de profil, conversation et publication sont automatiquement redimensionnées et compressées dans le navigateur, puis conservées dans Firestore sans utiliser Firebase Storage. Les images sources peuvent faire jusqu'à 50 Mo et sont ramenées à une taille compatible avec la limite des documents Firestore. Les documents et notes vocales jusqu'à 15 Mo utilisent Firebase Storage. Firestore crée automatiquement les collections au premier document écrit. L’inscription utilise une adresse e-mail et un mot de passe, sans SMS ni reCAPTCHA.

Les notifications système fonctionnent lorsque PLEIADE TECH est ouvert dans un navigateur autorisé, y compris si son onglet est en arrière-plan. La réception avec le navigateur complètement fermé nécessite une configuration Firebase Cloud Messaging (clé VAPID et envoi serveur) qui n'est pas activée dans ce projet.

Les anciennes sessions authentifiées uniquement par téléphone restent utilisables sur l'appareil où elles sont encore ouvertes; elles doivent être reliées à une adresse e-mail et un mot de passe avant de pouvoir être récupérées ultérieurement.
