# Fiche de publication (addons.thunderbird.net)

Textes prêts à coller dans les champs de la fiche ATN. Le résumé est repris du manifeste (`description`).

## Nom

Lien MS Teams automatique

## Résumé (250 caractères maximum)

Ajoute un bouton « Lien Teams » à la fenêtre d'événement : un clic crée une réunion Microsoft Teams dédiée et insère son lien dans l'invitation. Titre et horaire restent à jour. Compte Microsoft 365 professionnel requis. Extension non officielle.

## Description (français)

Création d'une visio Microsoft Teams en un clic, directement depuis l'agenda de Thunderbird.

**Fonctionnement**

- Un bouton **Lien Teams** est ajouté dans la fenêtre « Nouvel événement ».
- Un clic crée une réunion Teams **unique** à partir du titre et de l'horaire de l'événement : chaque rendez-vous dispose de son propre lien, de sa propre conversation et de ses propres enregistrements.
- Le lien de connexion, l'ID de réunion et le code secret sont insérés à la fin de la description ; le champ Lieu reçoit « Visio MS Teams » s'il est vide.
- Les participants et l'ordre du jour restent gérés dans Thunderbird, avec le carnet d'adresses habituel ; l'invitation part comme d'habitude.
- À chaque enregistrement de l'événement (modification, déplacement dans l'agenda), le titre et l'horaire sont reportés sur la réunion Teams.
- Les réunions récurrentes utilisent un lien unique pour toute la série, comme dans Teams et Outlook.

**Connexion**

Au premier usage, un bandeau affiche dans la fenêtre d'événement un code à saisir sur la page de connexion Microsoft (mot de passe et MFA dans le navigateur). La connexion est ensuite mémorisée et renouvelée automatiquement.

**Prérequis**

- Compte Microsoft 365 professionnel avec Teams. Les comptes personnels (outlook.com, hotmail) ne sont pas pris en charge par Microsoft pour ce type de réunion.
- Selon la configuration du tenant, l'accord d'un administrateur peut être nécessaire.

**Accès complet**

Thunderbird ne propose pas encore d'API standard pour l'agenda. L'extension utilise donc une API expérimentale, ce qui déclenche l'avertissement « accès complet » à l'installation. Cette API se limite à l'ajout du bouton et du bandeau dans la fenêtre d'événement, à l'insertion du bloc dans la description et à la détection des événements enregistrés contenant un lien Teams. Le code source complet est lisible et commenté.

**Données**

Seuls le titre et l'horaire des événements concernés sont envoyés à Microsoft. Aucun autre service n'est contacté.

Extension non officielle, sans lien avec Microsoft. Microsoft Teams est une marque de Microsoft Corporation.

## Description (English)

Create a Microsoft Teams meeting in one click, right from the Thunderbird calendar.

**How it works**

- A **Lien Teams** button is added to the "New Event" window.
- One click creates a **unique** Teams meeting from the event title and time: each appointment gets its own link, chat and recordings.
- The join link, meeting ID and passcode are appended to the description; the Location field is set to "Visio MS Teams" when empty.
- Attendees and agenda stay in Thunderbird, with the usual address book; the invitation is sent as usual.
- Each time the event is saved (edited, moved in the calendar), its title and time are applied to the Teams meeting.
- Recurring events share a single link for the whole series, as in Teams and Outlook.

**Sign-in**

On first use, a notification bar in the event window shows a code to enter on the Microsoft sign-in page (password and MFA in the browser). The session is then kept and renewed automatically.

**Requirements**

- Microsoft 365 work or school account with Teams. Personal accounts (outlook.com, hotmail) are not supported by Microsoft for this kind of meeting.
- Depending on the tenant settings, administrator consent may be required.

**Full access**

Thunderbird does not offer a standard calendar API yet. The add-on therefore relies on an Experiment API, which triggers the "full access" warning at install time. This API only adds the button and the sign-in bar to the event window, inserts the block into the description and detects saved events containing a Teams link. The full source code is readable and commented.

**Data**

Only the title and time of the relevant events are sent to Microsoft. No other service is contacted.

Unofficial add-on, not affiliated with Microsoft. Microsoft Teams is a trademark of Microsoft Corporation.

## Notes aux relecteurs

The Experiment API (`api/implementation.js`) is required because no WebExtension API exposes the calendar event dialog or calendar item changes in Thunderbird 153:

- `onLoadWindow` listener on `calendar-event-dialog.xhtml`: adds the toolbar button, reads `#item-title`, `gStartTime`, `gEndTime`, inserts the block with the description editor (`insertHTML`) and shows the sign-in code in the dialog's own notification box;
- `cal.manager.addCalendarObserver`: detects added/modified events whose description contains a Teams join link and forwards title/start/end to the background script (debounced);
- `aomStartup.registerChrome` for the `icones/` folder only: the event dialog CSP (`default-src chrome:`) blocks `moz-extension:` and `data:` images.

All network traffic (OAuth device code flow on login.microsoftonline.com, Microsoft Graph `/me/onlineMeetings`) happens in the background script with standard `fetch`. No remote code, no minification, no third-party library.

## Captures d'écran

Fichiers prêts dans `publication/captures/` (nom du calendrier flouté, code de connexion masqué) :

1. `01-nouvel-evenement.png` : fenêtre « Nouvel événement » avec le bouton **Lien Teams** ;
2. `02-bloc-insere.png` : bloc Teams inséré dans la description, Lieu « Visio MS Teams » ;
3. `03-connexion-bandeau.png` : bandeau de connexion Microsoft avec le code.

## Politique de confidentialité (texte complet à saisir sur ATN)

L'extension « Lien MS Teams automatique » envoie à Microsoft (login.microsoftonline.com et graph.microsoft.com), uniquement pour les événements où le bouton est utilisé ou qui contiennent un lien Teams : le titre de l'événement, son horaire de début et de fin, et le lien de la réunion Teams. Ces données servent exclusivement à créer, retrouver et mettre à jour la réunion Teams correspondante.

Les jetons de connexion Microsoft, la configuration et un cache des réunions (identifiant, titre, horaire) sont conservés localement dans le stockage de l'extension, sur l'ordinateur de l'utilisateur, et supprimés à la désinstallation.

Aucune autre donnée (participants, description, autres événements, messages) n'est lue pour être transmise. Aucune donnée n'est envoyée à l'auteur de l'extension ni à un service tiers autre que Microsoft. Le traitement des données par Microsoft relève de la déclaration de confidentialité de Microsoft.
