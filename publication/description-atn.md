# Fiche de publication (addons.thunderbird.net)

Textes prêts à coller dans les champs de la fiche ATN. Le résumé est repris du manifeste (`description`).

## Nom

Teams Meeting Link for Thunderbird

Adresse URL du module : `teams-meeting-link`. Site d'assistance : https://github.com/ctaverne/thunderbird-teams-meeting-link/issues (pas de courriel d'assistance public). Catégorie : Agenda et date/heure. Licence : MPL 2.0.

## Résumé (250 caractères maximum)

Ajoute un bouton « Lien Teams » à la fenêtre d'événement : un clic crée une réunion Microsoft Teams dédiée et insère son lien dans l'invitation. Titre et horaire restent à jour. Compte Microsoft 365 professionnel requis. Extension non officielle.

## Description (français)

Création d'une visio Microsoft Teams en un clic, depuis l'agenda de Thunderbird.

**Fonctionnement**

- Un bouton **Lien Teams** est ajouté dans la fenêtre « Nouvel événement ».
- Un clic crée une réunion Teams **unique** à partir du titre et de l'horaire de l'événement : chaque rendez-vous dispose de son propre lien, de sa propre conversation et de ses propres enregistrements.
- Le lien de connexion, l'ID de réunion et le code secret sont insérés à la fin de la description ; le champ Lieu reçoit « Visio MS Teams » s'il est vide.
- Les participants et l'ordre du jour restent gérés dans Thunderbird, avec le carnet d'adresses habituel, et l'invitation part de Thunderbird.
- À chaque enregistrement de l'événement (modification, déplacement dans l'agenda), le titre et l'horaire sont reportés sur la réunion Teams. Seuls les événements organisés par l'utilisateur sont concernés : un invité qui renvoie un événement retouché ne modifie pas la réunion.
- Les réunions récurrentes utilisent un lien unique pour toute la série, comme dans Teams et Outlook.

**Connexion**

Au premier usage, un bandeau affiche dans la fenêtre d'événement un code à saisir sur la page de connexion Microsoft (mot de passe et MFA dans le navigateur). La connexion est ensuite conservée et renouvelée sans nouvelle saisie.

**Prérequis**

- Thunderbird 128 à 153 (testé sur 153 ESR).
- Compte Microsoft 365 professionnel ou scolaire (organisation utilisant Teams). Les comptes personnels (outlook.com, hotmail), dont Teams gratuit, ne fonctionnent pas : l'API Microsoft ne les prend pas en charge.
- Selon la configuration du tenant, l'accord d'un administrateur peut être nécessaire.

**Accès complet**

Thunderbird ne propose pas encore d'API standard pour l'agenda. L'extension utilise donc une API expérimentale, ce qui déclenche l'avertissement « accès complet » à l'installation. Cette API se limite à l'ajout du bouton et du bandeau dans la fenêtre d'événement, à l'insertion du bloc dans la description et à la détection des événements enregistrés contenant un lien Teams. Le code source, lisible et commenté, est publié sur https://github.com/ctaverne/thunderbird-teams-meeting-link.

**Données**

Le titre, l'horaire et le lien Teams des événements concernés sont envoyés à Microsoft, et à aucun autre service. Les participants et le reste de la description restent sur le poste.

Extension non officielle, sans lien avec Microsoft. Microsoft Teams est une marque de Microsoft Corporation.

## Description (English)

Create a Microsoft Teams meeting in one click from the Thunderbird calendar.

**How it works**

- A **Lien Teams** button is added to the "New Event" window.
- One click creates a **unique** Teams meeting from the event title and time: each appointment gets its own link, chat and recordings.
- The join link, meeting ID and passcode are appended to the description; the Location field is set to "Visio MS Teams" when empty.
- Attendees and agenda stay in Thunderbird, with the usual address book, and Thunderbird sends the invitation.
- Each time the event is saved (edited, moved in the calendar), its title and time are applied to the Teams meeting. Only events organised by the user are affected: an attendee who sends back a modified event does not change the meeting.
- Recurring events share a single link for the whole series, as in Teams and Outlook.

**Sign-in**

On first use, a notification bar in the event window shows a code to enter on the Microsoft sign-in page (password and MFA in the browser). The session is then kept and renewed without signing in again.

**Requirements**

- Thunderbird 128 to 153 (tested on 153 ESR).
- Microsoft 365 work or school account (organisation using Teams). Personal accounts (outlook.com, hotmail), including Teams (free), do not work: Microsoft's API does not support them.
- Depending on the tenant settings, administrator consent may be required.

**Full access**

Thunderbird does not offer a standard calendar API yet. The add-on therefore relies on an Experiment API, which triggers the "full access" warning at install time. This API adds the button and the sign-in bar to the event window, inserts the block into the description and detects saved events containing a Teams link, nothing more. The readable, commented source code is published at https://github.com/ctaverne/thunderbird-teams-meeting-link.

**Data**

The title, time and Teams link of the relevant events are sent to Microsoft, and to no other service. Attendees and the rest of the description stay on your computer.

Unofficial add-on, not affiliated with Microsoft. Microsoft Teams is a trademark of Microsoft Corporation.

## Notes aux relecteurs

The Experiment API (`api/implementation.js`) is required because no WebExtension API exposes the calendar event dialog or calendar item changes in Thunderbird 153:

- `onLoadWindow` listener on `calendar-event-dialog.xhtml`: adds the toolbar button, reads `#item-title`, `gStartTime`, `gEndTime`, inserts the block with the description editor (`insertHTML`) and shows the sign-in code in the dialog's own notification box;
- `cal.manager.addCalendarObserver`: detects added/modified events whose description contains a Teams join link and forwards title/start/end to the background script (debounced). Read-only calendars, received invitations (`cal.itip.isInvitation`) and events whose organizer differs from the calendar `organizerId` are ignored, so an attendee cannot alter the user's meeting;
- `aomStartup.registerChrome` for the `icones/` folder only: the event dialog CSP (`default-src chrome:`) blocks `moz-extension:` and `data:` images.

Tested on Thunderbird 153 ESR; `strict_max_version` is set to `153.*` and will be raised after testing each new version.

All network traffic (OAuth device code flow on login.microsoftonline.com, Microsoft Graph `/me/onlineMeetings`) happens in the background script with standard `fetch`. No remote code, no minification, no third-party library.

## Notes aux relecteurs (version française, soumise sur ATN)

L'API expérimentale (api/implementation.js) est nécessaire, car aucune API WebExtension de Thunderbird 153 ne donne accès à la fenêtre d'édition d'événement ni aux modifications des événements d'agenda :

- écouteur onLoadWindow sur calendar-event-dialog.xhtml : ajout du bouton dans la barre d'outils, lecture de #item-title, gStartTime et gEndTime, insertion du bloc par l'éditeur de la description (insertHTML), et affichage du code de connexion dans la zone de notification de la fenêtre ;
- cal.manager.addCalendarObserver : détection des événements ajoutés ou modifiés dont la description contient un lien Teams, puis transmission du titre, du début et de la fin au script d'arrière-plan (avec regroupement des notifications). Les agendas en lecture seule, les invitations reçues (cal.itip.isInvitation) et les événements dont l'organisateur diffère du organizerId de l'agenda sont ignorés : un invité ne peut donc pas modifier la réunion de l'utilisateur ;
- aomStartup.registerChrome, limité au dossier icones/ : la politique CSP de la fenêtre d'événement (default-src chrome:) bloque les images moz-extension: et data:.

Extension testée sur Thunderbird 153 ESR. strict_max_version vaut 153.* et sera relevé après le test de chaque nouvelle version.

Tous les échanges réseau (connexion OAuth par code d'appareil sur login.microsoftonline.com, Microsoft Graph /me/onlineMeetings) passent par le script d'arrière-plan avec fetch. Aucun code distant, aucune minification, aucune bibliothèque tierce.

Le test nécessite un compte Microsoft 365 professionnel ou scolaire utilisant Teams. Les comptes Microsoft personnels ne sont pas pris en charge par l'API Graph onlineMeetings. Aucun compte de test ne peut être fourni. Des captures de chaque étape sont jointes à la fiche, et le code source complet est publié sur https://github.com/ctaverne/thunderbird-teams-meeting-link.

## Notes de version 3.0.1 (soumises sur ATN)

Première version publique.

- Bouton « Lien Teams » dans la fenêtre d'événement : création d'une réunion Microsoft Teams unique à partir du titre et de l'horaire de l'événement, et insertion du lien, de l'ID de réunion et du code secret dans la description.
- Titre et horaire reportés sur la réunion Teams à l'enregistrement de l'événement (événements organisés par l'utilisateur uniquement).
- Connexion Microsoft (code d'appareil) affichée dans la zone de notification de la fenêtre d'événement.
- Compte Microsoft 365 professionnel ou scolaire requis.

## Captures d'écran

Fichiers prêts dans `publication/captures/` (nom du calendrier flouté, code de connexion et identifiant de réunion masqués) :

1. `01-nouvel-evenement.png` : fenêtre « Nouvel événement » avec le bouton **Lien Teams** ;
2. `02-bloc-insere.png` : bloc Teams inséré dans la description, Lieu « Visio MS Teams » ;
3. `03-connexion-bandeau.png` : bandeau de connexion Microsoft avec le code.

## Politique de confidentialité (texte complet à saisir sur ATN)

L'extension « Teams Meeting Link for Thunderbird » envoie à Microsoft (login.microsoftonline.com et graph.microsoft.com), uniquement pour les événements où le bouton est utilisé ou qui contiennent un lien Teams : le titre de l'événement, son horaire de début et de fin, et le lien de la réunion Teams. Ces données servent à créer, retrouver et mettre à jour la réunion Teams correspondante, à aucune autre fin.

Les jetons de connexion Microsoft, la configuration et un cache des réunions (identifiant, titre, horaire) sont conservés dans le stockage de l'extension, sur l'ordinateur de l'utilisateur, et supprimés à la désinstallation.

Aucune autre donnée (participants, description, autres événements, messages) n'est lue pour être transmise. Aucune donnée n'est envoyée à l'auteur de l'extension ni à un service tiers autre que Microsoft. Le traitement des données par Microsoft relève de la déclaration de confidentialité de Microsoft.
