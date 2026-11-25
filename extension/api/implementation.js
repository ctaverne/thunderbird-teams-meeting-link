/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * (Code source soumis à la Mozilla Public License 2.0, texte officiel ci-dessus.) */

/*
 * API expérimentale « lienTeams » (côté parent, privilégié).
 *
 * Elle se limite à ce que les API WebExtension standard ne permettent pas :
 *   - ajouter un bouton « Lien Teams » dans la fenêtre popup d'événement,
 *     lire le titre et les horaires saisis, insérer le bloc Teams dans la
 *     description et renseigner le champ Lieu ;
 *   - observer les ajouts et modifications d'événements de tous les agendas
 *     pour signaler ceux qui contiennent un lien Teams.
 *
 * Toute la logique Microsoft (connexion, création, mise à jour) se trouve dans
 * le script d'arrière-plan, qui reçoit les événements de cette API.
 */

"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);
var { ExtensionUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);
var { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
var { setTimeout, clearTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs"
);

// Identifiants internes
const ID_BOUTON = "lien-teams-bouton";
const ID_ECOUTEUR = "lien-teams-fenetres";
// Fenêtre d'édition d'événement en mode popup (calendar.item.editInTab = false)
const URL_FENETRE = "chrome://calendar/content/calendar-event-dialog.xhtml";
// Libellés du bouton
const LIBELLE = "Lien Teams";
const LIBELLE_OCCUPE = "Lien Teams…";
// Texte inscrit dans le champ Lieu de l'événement
const LIBELLE_LIEU = "Visio MS Teams";
// Détection et extraction d'un lien de réunion Teams
const MOTIF_LIEN_TEAMS = "teams.microsoft.com/l/meetup-join";
const REGEX_LIEN_TEAMS = /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+/;
// Délai de regroupement des notifications d'un même événement (enregistrement + synchro)
const DELAI_ENREGISTREMENT_MS = 3000;
// La fenêtre d'événement n'accepte que les images chrome: (CSP « default-src chrome: ») :
// le dossier icones/ est enregistré comme paquet chrome au démarrage.
const PAQUET_CHROME = "lienteams";
const ICONE = `chrome://${PAQUET_CHROME}/content/teams-32.png`;

// ---------------------------------------------------------------------------
// État partagé entre les fenêtres et les contextes d'extension
// ---------------------------------------------------------------------------

// Auditeurs des événements de l'API (fonctions « fire » fournies par EventManager)
const auditeursClic = new Set();
const auditeursEnregistrement = new Set();
const auditeursAnnulation = new Set();
// Valeur identifiant le bandeau de connexion dans la zone de notification
const VALEUR_BANDEAU = "lien-teams-connexion";
// Fenêtres d'événement ouvertes, indexées par un identifiant numérique
const fenetres = new Map();
let prochainIdFenetre = 1;
// Minuteries de regroupement des enregistrements, par lien Teams
const enregistrementsEnAttente = new Map();

/**
 * Exécute une fonction de l'API en convertissant toute exception en
 * ExtensionError : sans cela, l'extension ne reçoit que le message générique
 * « An unexpected error occurred ». L'erreur d'origine est aussi journalisée.
 */
async function proteger(nom, fonction) {
  try {
    return await fonction();
  } catch (e) {
    console.error(`Lien Teams : échec de ${nom}`, e);
    if (e instanceof ExtensionUtils.ExtensionError) {
      throw e;
    }
    throw new ExtensionUtils.ExtensionError(`${nom} : ${e && e.message ? e.message : e}`);
  }
}

/**
 * Échappe un texte pour l'insérer dans du HTML.
 */
function echapper(texte) {
  return String(texte)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Bloc HTML inséré dans la description de l'événement.
 * Le lien court en tête reçoit le focus dans la fenêtre de résumé (évite le
 * défilement jusqu'à la fin de l'adresse) ; l'adresse complète reste présente
 * en texte simple pour les invités, la synchronisation et la mise à jour.
 */
function blocHtml(reunion) {
  let html =
    "<p><b>Réunion Microsoft Teams</b><br>" +
    `<a href="${echapper(reunion.lien)}">Rejoindre la réunion</a>`;
  if (reunion.idReunion) {
    html += `<br>ID de réunion : ${echapper(reunion.idReunion)}`;
  }
  if (reunion.code) {
    html += `<br>Code secret : ${echapper(reunion.code)}`;
  }
  html += `<br><small>Lien : ${echapper(reunion.lien)}</small>`;
  return html + "</p>";
}

/**
 * Renvoie l'éditeur d'événement (iframe) d'une fenêtre, ou null s'il n'est pas prêt.
 */
function editeurEvenement(fenetre) {
  const iframe = fenetre.document.getElementById("calendar-item-panel-iframe");
  const fen = iframe && iframe.contentWindow;
  if (!fen || !fen.gStartTime || !fen.gEndTime) {
    return null;
  }
  return fen;
}

/**
 * Renvoie une fenêtre d'événement encore ouverte à partir de son identifiant.
 */
function fenetreOuverte(idFenetre) {
  const fenetre = fenetres.get(idFenetre);
  if (!fenetre || fenetre.closed) {
    fenetres.delete(idFenetre);
    return null;
  }
  return fenetre;
}

// ---------------------------------------------------------------------------
// Bandeau de connexion Microsoft dans la fenêtre d'événement
// ---------------------------------------------------------------------------

/**
 * Renvoie la zone de notification de l'éditeur d'événement. Elle se trouve dans
 * l'iframe de l'éditeur (#event-dialog-notifications) et Thunderbird l'expose
 * sous le nom gEventNotification (créée à la première utilisation).
 */
function zoneNotification(fenetre) {
  const fen = editeurEvenement(fenetre);
  if (!fen || !fen.gEventNotification) {
    throw new ExtensionUtils.ExtensionError("Zone de notification de la fenêtre d'événement introuvable.");
  }
  return fen.gEventNotification;
}

/**
 * Copie un texte dans le presse-papiers du système.
 */
function copierTexte(texte) {
  Cc["@mozilla.org/widget/clipboardhelper;1"]
    .getService(Ci.nsIClipboardHelper)
    .copyString(texte);
}

/**
 * Ouvre une adresse dans le navigateur par défaut du système.
 */
function ouvrirNavigateur(url) {
  Cc["@mozilla.org/uriloader/external-protocol-service;1"]
    .getService(Ci.nsIExternalProtocolService)
    // Le principal déclencheur est obligatoire : sans lui, l'ouverture est
    // refusée sans message. Principal système, l'action venant de l'extension.
    .loadURI(Services.io.newURI(url), Services.scriptSecurityManager.getSystemPrincipal());
}

/**
 * Affiche le bandeau de connexion (code + boutons) dans une fenêtre d'événement.
 * Le bandeau fait partie de la fenêtre : il ne peut pas se retrouver masqué
 * derrière elle, contrairement à une fenêtre séparée.
 */
async function afficherBandeau(fenetre, idFenetre, code, url) {
  const zone = zoneNotification(fenetre);
  const existant = zone.getNotificationWithValue(VALEUR_BANDEAU);
  if (existant) {
    zone.removeNotification(existant);
  }
  await zone.appendNotification(
    VALEUR_BANDEAU,
    {
      label: `Connexion Microsoft requise : saisir le code ${code} sur ${url}, puis se connecter avec le compte Teams.`,
      priority: zone.PRIORITY_INFO_HIGH,
    },
    [
      {
        label: "Copier le code et ouvrir la page",
        callback: () => {
          try {
            copierTexte(code);
            ouvrirNavigateur(url);
          } catch (e) {
            console.error("Lien Teams : ouverture de la page de connexion impossible", e);
            Services.prompt.alert(
              fenetre,
              LIBELLE,
              `Ouverture automatique impossible. Ouvrir ${url} et saisir le code ${code}.`
            );
          }
          // true : le bandeau reste affiché jusqu'à la fin de la connexion
          return true;
        },
      },
      {
        // Pour ouvrir la page dans un autre navigateur ou un autre profil
        label: "Copier le lien",
        callback: () => {
          copierTexte(url);
          return true;
        },
      },
      {
        label: "Annuler",
        callback: () => {
          for (const fire of auditeursAnnulation) {
            fire.async(idFenetre);
          }
          return false;
        },
      },
    ]
  );
}

/**
 * Retire le bandeau de connexion d'une fenêtre d'événement.
 */
function masquerBandeau(fenetre) {
  const fen = editeurEvenement(fenetre);
  const zone = fen && fen.gEventNotification;
  const bandeau = zone && zone.getNotificationWithValue(VALEUR_BANDEAU);
  if (bandeau) {
    zone.removeNotification(bandeau);
  }
}

// ---------------------------------------------------------------------------
// Bouton de la fenêtre d'événement
// ---------------------------------------------------------------------------

/**
 * Clic sur le bouton : lecture des champs, garde-fou, puis transmission au
 * script d'arrière-plan qui se charge de la création de la réunion.
 */
function surClic(fenetre, idFenetre) {
  const fen = editeurEvenement(fenetre);
  if (!fen) {
    Services.prompt.alert(fenetre, LIBELLE, "Fenêtre d'événement non prête, réessayer dans un instant.");
    return;
  }
  const doc = fen.document;

  // Garde-fou : une réunion Teams figure déjà dans la description
  const descDoc = doc.getElementById("item-description").contentDocument;
  if (descDoc && descDoc.body && descDoc.body.innerHTML.includes(MOTIF_LIEN_TEAMS)) {
    const confirme = Services.prompt.confirm(
      fenetre,
      LIBELLE,
      "La description contient déjà un lien Teams.\nCréer quand même une nouvelle réunion ?"
    );
    if (!confirme) {
      return;
    }
  }

  if (auditeursClic.size === 0) {
    Services.prompt.alert(fenetre, LIBELLE, "Extension en cours de démarrage, réessayer dans un instant.");
    return;
  }

  // Titre provisoire si le champ est vide : le vrai titre est reporté à l'enregistrement
  const evenement = {
    titre: doc.getElementById("item-title").value.trim() || "Réunion",
    debut: fen.cal.dtz.dateTimeToJsDate(fen.gStartTime).toISOString(),
    fin: fen.cal.dtz.dateTimeToJsDate(fen.gEndTime).toISOString(),
  };
  for (const fire of auditeursClic) {
    fire.async(idFenetre, evenement);
  }
}

/**
 * Ajoute le bouton dans la barre d'outils d'une fenêtre d'événement.
 */
function ajouterBouton(fenetre) {
  const doc = fenetre.document;
  if (doc.getElementById(ID_BOUTON)) {
    return;
  }
  const barre = doc.getElementById("event-toolbar");
  if (!barre) {
    return;
  }
  const idFenetre = prochainIdFenetre++;
  fenetres.set(idFenetre, fenetre);

  const bouton = doc.createXULElement("toolbarbutton");
  bouton.id = ID_BOUTON;
  bouton.className = "cal-event-toolbarbutton toolbarbutton-1";
  bouton.setAttribute("label", LIBELLE);
  bouton.setAttribute(
    "tooltiptext",
    "Créer une réunion Teams unique (titre et horaires de l'événement) et l'insérer dans la description"
  );
  bouton.setAttribute("image", ICONE);
  bouton.style.listStyleImage = `url("${ICONE}")`;
  bouton.addEventListener("command", () => surClic(fenetre, idFenetre));

  // Placement juste après le bouton « Invitations » s'il est présent
  const ref = doc.getElementById("button-attendees");
  if (ref && ref.parentNode === barre) {
    ref.after(bouton);
  } else {
    barre.appendChild(bouton);
  }
}

/**
 * Nettoyage à la fermeture d'une fenêtre d'événement.
 */
function oublierFenetre(fenetre) {
  for (const [id, f] of fenetres) {
    if (f === fenetre) {
      fenetres.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Observation des agendas (mise à jour des réunions à l'enregistrement)
// ---------------------------------------------------------------------------

/**
 * Examine un événement ajouté ou modifié et, s'il contient un lien Teams,
 * le signale au script d'arrière-plan après un court délai de regroupement.
 */
function examinerEvenement(item) {
  try {
    if (!item || !item.isEvent() || auditeursEnregistrement.size === 0) {
      return;
    }
    // Occurrence d'une série : la série complète (événement parent) fait foi
    const evt = item.parentItem || item;
    const correspondance = (evt.descriptionText || "").match(REGEX_LIEN_TEAMS);
    if (!correspondance || !evt.startDate || !evt.endDate) {
      return;
    }
    const lien = correspondance[0];
    const details = {
      lien,
      titre: (evt.title || "").trim() || "Réunion",
      debut: cal.dtz.dateTimeToJsDate(evt.startDate).toISOString(),
      fin: cal.dtz.dateTimeToJsDate(evt.endDate).toISOString(),
    };
    // Seule la dernière notification d'une rafale est transmise
    clearTimeout(enregistrementsEnAttente.get(lien));
    enregistrementsEnAttente.set(
      lien,
      setTimeout(() => {
        enregistrementsEnAttente.delete(lien);
        for (const fire of auditeursEnregistrement) {
          fire.async(details);
        }
      }, DELAI_ENREGISTREMENT_MS)
    );
  } catch (e) {
    console.warn("Lien Teams : examen de l'événement impossible", e);
  }
}

// Observateur de tous les agendas (interface calIObserver)
const observateurAgendas = {
  QueryInterface: ChromeUtils.generateQI(["calIObserver"]),
  onStartBatch() {},
  onEndBatch() {},
  onLoad() {},
  onError() {},
  onPropertyChanged() {},
  onPropertyDeleting() {},
  onDeleteItem() {},
  onAddItem(item) {
    examinerEvenement(item);
  },
  onModifyItem(nouvelItem) {
    examinerEvenement(nouvelItem);
  },
};

// ---------------------------------------------------------------------------
// Déclaration de l'API
// ---------------------------------------------------------------------------

this.lienTeams = class extends ExtensionCommon.ExtensionAPI {
  // Appelé au démarrage de l'extension grâce à events: ["startup"]
  onStartup() {
    // Enregistrement du dossier icones/ sous chrome://lienteams/content/
    const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(
      Ci.amIAddonManagerStartup
    );
    const manifeste = Services.io.newURI("manifest.json", null, this.extension.rootURI);
    this.poigneeChrome = aomStartup.registerChrome(manifeste, [
      ["content", PAQUET_CHROME, "icones/"],
    ]);

    cal.manager.addCalendarObserver(observateurAgendas);
    ExtensionSupport.registerWindowListener(ID_ECOUTEUR, {
      chromeURLs: [URL_FENETRE],
      onLoadWindow: ajouterBouton,
      onUnloadWindow: oublierFenetre,
    });
  }

  // Nettoyage à la désactivation ou à la désinstallation (inutile à la fermeture)
  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    ExtensionSupport.unregisterWindowListener(ID_ECOUTEUR);
    cal.manager.removeCalendarObserver(observateurAgendas);
    for (const minuterie of enregistrementsEnAttente.values()) {
      clearTimeout(minuterie);
    }
    enregistrementsEnAttente.clear();
    for (const fenetre of Services.wm.getEnumerator(null)) {
      fenetre.document.getElementById(ID_BOUTON)?.remove();
    }
    fenetres.clear();
    if (this.poigneeChrome) {
      this.poigneeChrome.destruct();
      this.poigneeChrome = null;
    }
  }

  getAPI(context) {
    return {
      lienTeams: {
        // Clic sur le bouton d'une fenêtre d'événement
        onBoutonClique: new ExtensionCommon.EventManager({
          context,
          name: "lienTeams.onBoutonClique",
          register: fire => {
            auditeursClic.add(fire);
            return () => auditeursClic.delete(fire);
          },
        }).api(),

        // Événement enregistré contenant un lien Teams
        onEvenementEnregistre: new ExtensionCommon.EventManager({
          context,
          name: "lienTeams.onEvenementEnregistre",
          register: fire => {
            auditeursEnregistrement.add(fire);
            return () => auditeursEnregistrement.delete(fire);
          },
        }).api(),

        // Annulation de la connexion depuis le bandeau
        onConnexionAnnulee: new ExtensionCommon.EventManager({
          context,
          name: "lienTeams.onConnexionAnnulee",
          register: fire => {
            auditeursAnnulation.add(fire);
            return () => auditeursAnnulation.delete(fire);
          },
        }).api(),

        // Bandeau de connexion (code à saisir) dans la fenêtre d'événement
        async afficherCodeConnexion(idFenetre, code, url) {
          return proteger("afficherCodeConnexion", async () => {
            const fenetre = fenetreOuverte(idFenetre);
            if (fenetre) {
              await afficherBandeau(fenetre, idFenetre, code, url);
            }
          });
        },

        async masquerCodeConnexion(idFenetre) {
          return proteger("masquerCodeConnexion", async () => {
            const fenetre = fenetreOuverte(idFenetre);
            if (fenetre) {
              masquerBandeau(fenetre);
            }
          });
        },

        // Fenêtre d'événement toujours ouverte ? (sa fermeture annule la connexion)
        async estOuverte(idFenetre) {
          return proteger("estOuverte", async () => {
            return Boolean(fenetreOuverte(idFenetre));
          });
        },

        // Insertion du bloc Teams dans la description (+ Lieu s'il est vide)
        async insererBloc(idFenetre, reunion) {
          return proteger("insererBloc", async () => {
            const fenetre = fenetreOuverte(idFenetre);
            const fen = fenetre && editeurEvenement(fenetre);
            if (!fen) {
              return false;
            }
            const doc = fen.document;
            // L'éditeur HTML marque la description comme modifiée, ce qui
            // garantit son enregistrement avec l'événement
            const editeurElt = doc.getElementById("item-description");
            const editeur = editeurElt.getHTMLEditor(editeurElt.contentWindow);
            editeur.endOfDocument();
            editeur.insertHTML(blocHtml(reunion));

            const lieu = doc.getElementById("item-location");
            if (lieu && !lieu.value.trim()) {
              lieu.value = LIBELLE_LIEU;
              lieu.dispatchEvent(new fen.Event("input", { bubbles: true }));
            }
            return true;
          });
        },

        // Bouton désactivé pendant la création (connexion Microsoft comprise)
        async definirOccupe(idFenetre, occupe) {
          return proteger("definirOccupe", async () => {
            const fenetre = fenetreOuverte(idFenetre);
            const bouton = fenetre && fenetre.document.getElementById(ID_BOUTON);
            if (!bouton) {
              return;
            }
            if (occupe) {
              bouton.setAttribute("disabled", "true");
              bouton.setAttribute("label", LIBELLE_OCCUPE);
            } else {
              bouton.removeAttribute("disabled");
              bouton.setAttribute("label", LIBELLE);
            }
          });
        },

        // Message d'erreur affiché dans la fenêtre d'événement (si encore ouverte)
        async alerter(idFenetre, titre, message) {
          return proteger("alerter", async () => {
            const fenetre = fenetreOuverte(idFenetre);
            Services.prompt.alert(fenetre || null, titre, message);
          });
        },
      },
    };
  }
};
