from pathlib import Path
import textwrap

PAGE_WIDTH, PAGE_HEIGHT = 595, 842
NAVY = (16 / 255, 28 / 255, 75 / 255)
BLUE = (21 / 255, 85 / 255, 217 / 255)
blocks = []


def section(title):
    blocks.append(("h1", title))


def subheading(title):
    blocks.append(("h2", title))


def paragraph(text):
    blocks.append(("p", text))


def bullet(text):
    blocks.append(("bullet", text))


paragraph("Présentation fonctionnelle, architecture, logique technique et feuille de route pour lancer le service et construire un modèle économique durable.")
section("En bref")
paragraph("Pleiade Messengers est une application web React installable sur téléphone (PWA), connectée à Firebase. Elle réunit une messagerie privée, des invitations d’amis, des publications, des statuts temporaires et des réglages de profil.")
paragraph("Ce guide décrit les fonctions présentes dans le code et les limites à considérer avant un lancement public. Il explique aussi comment transformer une audience réelle en revenus : les connexions et les forfaits Internet ne sont pas automatiquement payés à l’éditeur de l’application.")
subheading("Produit et identité")
paragraph("Le nom affiché est Pleiade Messengers. Le logo PLEIADE TECH demeure la marque visuelle. Le site et l’application installée utilisent le même nom et le même logo.")

section("1. Fonctions disponibles")
for item in [
    "Créer un compte par e-mail et mot de passe, retrouver sa session sur le même appareil et réinitialiser son mot de passe.",
    "Choisir un pseudo, chercher un membre, envoyer une invitation d’ami, l’accepter ou la refuser; l’acceptation ouvre une conversation privée.",
    "Échanger des messages en direct, voir l’activité de conversation, les indicateurs de saisie et des états de lecture/envoi selon les données disponibles.",
    "Joindre des photos, documents et notes vocales. Une image est compressée dans le navigateur; les documents et audios passent par Firebase Storage.",
    "Publier un texte avec au plus quatre photos, réagir, commenter, répondre, partager et supprimer ses propres contenus.",
    "Publier un statut photo qui expire après 24 heures; les membres peuvent le voir, réagir, répondre et consulter les vues disponibles.",
    "Modifier le nom, le pseudo, la photo de profil et de couverture, gérer le mot de passe, bloquer ou débloquer un compte.",
]:
    bullet(item)
paragraph("Les appels audio/vidéo et les réunions sont hors du périmètre actuel; ils ne sont pas annoncés comme fonctions disponibles.")

section("2. Structure technique")
paragraph("Interface : src/pages/Auth.jsx gère l’accès et l’inscription; src/pages/Messenger.jsx compose les vues de conversation, amis et paramètres; src/components/Posts.jsx et Statuses.jsx gèrent les flux sociaux. src/index.css contient les styles.")
paragraph("Services : src/services/firebase.js initialise Firebase; friends.js orchestre les invitations; messages.js gère les conversations et pièces jointes; posts.js et statuses.js gèrent les publications; profile.js gère le profil et les blocages; images.js compresse les images.")
paragraph("Configuration : index.html fixe le titre web; vite.config.js définit la PWA et son manifeste; public/logo.png et public/icons portent le logo; firestore.rules, storage.rules et firestore.indexes.json configurent les accès, fichiers et index. Les paramètres Firebase côté navigateur viennent du fichier .env local.")
subheading("Données principales Firestore")
for item in [
    "users/{uid} : identité et profil; sous-collections friends, blocked, blockedBy et presence.",
    "usernames/{pseudo} : index de recherche des pseudos; friendRequests/{id} : demandes en attente et leur statut.",
    "conversations/{id} : participants et aperçu; sous-collections messages et typing.",
    "posts/{id} : publication; sous-collections likes et comments.",
    "statuses/{id} : statut, image, dates de création/expiration; sous-collections likes, views, shares et responses.",
    "users/{uid}/notifications : notifications affichées par l’application.",
]:
    bullet(item)
paragraph("Firestore crée une collection dès que l’application écrit son premier document. Les index composites nécessaires doivent être déclarés et déployés; le message « query requires an index » indique qu’un index manque.")

section("3. Logiques et algorithmes")
subheading("Inscription et ouverture de session")
paragraph("Firebase Authentication vérifie les identifiants. Le profil de l’utilisateur et son index de pseudo sont enregistrés dans Firestore. La persistance Firebase garde la session sur l’appareil; se déconnecter la termine. Une nouvelle installation ou un autre appareil peut demander une reconnexion.")
subheading("Devenir amis et discuter")
paragraph("La recherche interroge l’index des pseudos. À l’envoi, l’application crée une demande identifiée par expéditeur_destinataire. Le destinataire l’accepte ou la refuse. À l’acceptation, une écriture groupée ajoute les deux fiches d’amis et crée la conversation si elle n’existe pas. Les règles Firestore contrôlent les écritures; une conversation ne doit être accessible qu’à ses participants, sous réserve de règles actives et déployées.")
subheading("Envoyer des médias")
paragraph("Pour les photos, le navigateur vérifie le type, décode l’image, réduit ses dimensions et ajuste la qualité jusqu’à atteindre la taille cible; la version compressée est enregistrée dans le message ou le document. Les fichiers non-image passent par Firebase Storage avec progression. La configuration limite documents et vocaux à 15 Mo par fichier; l’image source peut aller jusqu’à 50 Mo avant compression.")
subheading("Publications, réactions et blocage")
paragraph("Les publications chargent une liste limitée et ordonnée par date; les identifiants de documents de réaction empêchent le même compte de liker plusieurs fois simultanément. Les statuts sont filtrés selon leur date d’expiration; une vue est enregistrée par membre. Le blocage met à jour les listes des deux comptes et enlève, le cas échéant, les liens d’amitié et demandes concernés.")

section("4. Sécurité, coûts et limites")
for item in [
    "Ne jamais publier .env, mots de passe, clés privées, jetons de service ou identifiants d’administration. Les clés Firebase client identifient le projet, mais la protection repose surtout sur Authentication, règles, quotas et validation.",
    "Les règles Firestore ont été déployées selon les travaux antérieurs. Les changements locaux de Cloud Functions n’ont pas été déployés : Firebase a exigé le forfait Blaze/Cloud Build. Une fonctionnalité dépendante d’une fonction serveur n’est donc pas garantie en production.",
    "Les publications et statuts sont lisibles par les comptes authentifiés selon les règles actuelles. Le masquage d’un utilisateur bloqué dans l’interface n’est pas une garantie de confidentialité serveur pour ces contenus publics.",
    "Les notifications système sont disponibles quand le navigateur autorisé est ouvert ou en arrière-plan. Les notifications push après fermeture complète nécessitent encore Firebase Cloud Messaging, une clé VAPID et un envoi serveur.",
    "Les images intégrées en base64 ne sont pas gratuites : elles augmentent la taille des lectures et écritures Firestore. Storage, Firestore, Functions, trafic réseau et sauvegardes peuvent entraîner des frais selon le forfait et l’usage.",
    "Les tests réels avec deux comptes, les tests de sécurité et les règles de confidentialité doivent précéder l’ouverture publique. Un build réussi ne prouve pas qu’un scénario Firebase fonctionne avec deux comptes.",
]:
    bullet(item)

section("5. Comment gagner de l’argent")
paragraph("Un opérateur mobile vend un forfait à son abonné. Le simple fait que cet abonné utilise une application ne transfère pas automatiquement une part du forfait à l’éditeur. Les grands réseaux gagnent principalement grâce à des modèles commerciaux (publicité, services, commerce, abonnements et partenariats), pas parce que chaque connexion Internet leur reverse directement une commission.")
subheading("Modèles à envisager")
for item in [
    "Publicité web : afficher des annonces conformes aux règles d’un réseau publicitaire après acceptation du compte. Les revenus dépendent des impressions visibles, du pays, du taux de remplissage et de la valeur publicitaire; ils ne sont jamais garantis. Éviter les annonces dans les conversations privées.",
    "Abonnement facultatif : proposer des options définies (espace supplémentaire, thèmes, outils de communauté), sans vendre les messages privés ni bloquer les fonctions essentielles de sécurité.",
    "Offre professionnelle : vendre des outils de communication ou de visibilité à des entreprises et associations, avec tarifs, support et facturation transparents.",
    "Partenariat opérateur : un accès sponsorisé ou « zero-rating » demande une négociation et un contrat avec l’opérateur, des mesures de trafic et le respect de la réglementation. Ce n’est ni automatique ni une conversion des forfaits personnels en revenu.",
    "Application mobile native : une application publiée peut envisager les solutions publicitaires et de paiement adaptées à sa plateforme, sous réserve des règles des boutiques et des fournisseurs.",
]:
    bullet(item)
subheading("Calcul illustratif, pas une promesse")
paragraph("Revenu publicitaire brut approximatif = impressions publicitaires valides / 1 000 x eCPM. Par exemple, 100 000 impressions à 0,30 USD d’eCPM donneraient environ 30 USD bruts. Ce chiffre est hypothétique; le vrai taux peut être plus bas ou nul, et il faut retrancher frais, taxes et coûts Firebase. Le nombre d’inscrits n’est pas le nombre d’impressions monétisables.")

section("6. Étapes avant le lancement")
for item in [
    "Stabiliser une bêta : tester inscription, récupération de compte, ajout/acceptation d’ami, textes et médias, blocage/déblocage, profil et affichage mobile avec au moins deux comptes.",
    "Configurer la production : domaine HTTPS, domaines Firebase autorisés, règles et index déployés, quotas/alertes de budget, sauvegarde et surveillance des erreurs. Ne pas ouvrir les règles à tous pour contourner une permission refusée.",
    "Préparer confiance et légalité : politique de confidentialité, conditions d’utilisation, modération/signalement, suppression/export de compte, consentement aux mesures si requis, coordonnées de contact et vérification des obligations du pays où le service opère.",
    "Valider l’utilité avant la publicité : recruter un petit groupe, mesurer les utilisateurs actifs et récurrents avec des données minimales et transparentes, interviewer les membres, calculer les coûts par utilisateur et vérifier la rapidité.",
    "Choisir un seul modèle de revenu pour un pilote. Vérifier les conditions du fournisseur publicitaire ou de paiement, le pays éligible, les seuils de versement, les taxes et les règles de données personnelles. Ajouter des publicités après avoir défini le consentement et l’expérience utilisateur.",
    "Suivre chaque mois : utilisateurs actifs, rétention, coût Firebase, impressions visibles, revenu net, signalements et temps de résolution. Des téléchargements sans rétention ou sans annonce visible ne suffisent pas.",
]:
    bullet(item)
subheading("Installer sur le téléphone")
paragraph("Servir le site en HTTPS avec le manifeste et les icônes PWA publiés. Sur Android/Chrome, ouvrir le site puis le menu et choisir « Installer l’application » ou « Ajouter à l’écran d’accueil ». Vérifier le nom Pleiade Messengers et l’icône PLEIADE TECH. Tester lancement autonome, navigation, connexion persistante et mises à jour. Une PWA installée reste une application web; sa présence sur l’écran d’accueil ne crée pas de revenus à elle seule.")
subheading("Ordre de priorité recommandé")
paragraph("1) Tester deux comptes et corriger toute erreur d’accès; 2) définir les politiques et la modération; 3) publier une bêta HTTPS et mesurer la rétention; 4) réduire les coûts médias et fixer des alertes Firebase; 5) décider entre publicité, abonnement ou offre professionnelle; 6) lancer un pilote légal, transparent et mesurable.")


def encode(text):
    return text.encode("cp1252").hex().upper()


def add_text(commands, text, x, y, size, font="F1", color=(0.16, 0.19, 0.27)):
    r, g, b = color
    commands.append(
        f"{r:.3f} {g:.3f} {b:.3f} rg BT /{font} {size} Tf "
        f"1 0 0 1 {x} {y} Tm <{encode(text)}> Tj ET"
    )


pages = [[]]
y = 744
add_text(pages[-1], "Guide de Pleiade Messengers", 46, y, 24, "F2", NAVY)
y -= 35

for kind, text in blocks:
    if kind == "h1":
        if y < 90:
            pages.append([])
            y = 744
        add_text(pages[-1], text, 46, y, 16, "F2", BLUE)
        pages[-1].append(
            f"{BLUE[0]:.3f} {BLUE[1]:.3f} {BLUE[2]:.3f} RG "
            f"46 {y - 7} m 549 {y - 7} l S"
        )
        y -= 25
        continue
    if kind == "h2":
        if y < 60:
            pages.append([])
            y = 744
        add_text(pages[-1], text, 48, y, 11, "F2", NAVY)
        y -= 16
        continue
    width = 94 if kind == "p" else 91
    lines = textwrap.wrap(text, width, break_long_words=False, break_on_hyphens=True) or [""]
    if y - len(lines) * 12 - 6 < 52:
        pages.append([])
        y = 744
    for index, line in enumerate(lines):
        if kind == "bullet":
            if index == 0:
                add_text(pages[-1], "-", 52, y, 9, "F2", BLUE)
            add_text(pages[-1], line, 64, y, 9)
        else:
            add_text(pages[-1], line, 50, y, 9.2)
        y -= 12
    y -= 4

objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
]
page_ids = []
for page_number, commands in enumerate(pages, 1):
    stream_lines = [
        "q",
        f"{NAVY[0]:.3f} {NAVY[1]:.3f} {NAVY[2]:.3f} rg 0 774 {PAGE_WIDTH} 68 re f",
        f"1 1 1 rg BT /F2 15 Tf 1 0 0 1 46 814 Tm <{encode('PLEIADE TECH')}> Tj ET",
        f"0.82 0.88 1 rg BT /F1 9 Tf 1 0 0 1 46 795 Tm <{encode('PLEIADE MESSENGERS')}> Tj ET",
        *commands,
        f"0.55 0.59 0.67 rg BT /F1 8 Tf 1 0 0 1 46 29 Tm <{encode('Guide de présentation - 06/11/2026')}> Tj ET",
        f"0.55 0.59 0.67 rg BT /F1 8 Tf 1 0 0 1 520 29 Tm <{encode(str(page_number))}> Tj ET",
        "Q",
    ]
    stream = "\n".join(stream_lines).encode("ascii")
    content_id = len(objects) + 1
    objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
    page_id = len(objects) + 1
    page_ids.append(page_id)
    objects.append(
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
        f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content_id} 0 R >>".encode()
    )
objects[1] = (
    f"<< /Type /Pages /Kids [{' '.join(f'{item} 0 R' for item in page_ids)}] "
    f"/Count {len(page_ids)} >>"
).encode()

pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
offsets = [0]
for number, obj in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(f"{number} 0 obj\n".encode())
    pdf.extend(obj)
    pdf.extend(b"\nendobj\n")
xref = len(pdf)
pdf.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
for offset in offsets[1:]:
    pdf.extend(f"{offset:010d} 00000 n \n".encode())
pdf.extend(
    f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
    f"startxref\n{xref}\n%%EOF\n".encode()
)

output = Path(__file__).resolve().parent.parent / "Guide_Pleiade_Messengers.pdf"
output.write_bytes(pdf)
print(f"Created {output} ({len(pages)} pages, {len(pdf)} bytes)")
