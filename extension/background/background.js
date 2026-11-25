/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * (Code source soumis à la Mozilla Public License 2.0, texte officiel ci-dessus.) */

/*
 * Script d'arrière-plan : relie l'API expérimentale (bouton, enregistrements)
 * à la connexion Microsoft et aux appels Graph.
 */

"use strict";

// Durée pendant laquelle un lien Teams « étranger » (réunion d'un autre
// organisateur) n'est plus revérifié auprès de Microsoft
const DUREE_LIEN_INCONNU_MS = 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

/**
 * Notification de bureau.
 */
function notifier(titre, message) {
  return browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("icones/teams-64.png"),
    title: titre,
    message,
  });
}

/**
 * Convertit une date ISO (éventuellement avec 7 décimales, format Graph) en millisecondes.
 */
function versMillisecondes(iso) {
  // Les fractions de seconde au-delà des millisecondes sont tronquées
  return Date.parse(String(iso).replace(/(\.\d{3})\d+/, "$1"));
}

/**
 * Compare deux dates ISO à la minute près.
 */
function memeInstant(a, b) {
  return Math.abs(versMillisecondes(a) - versMillisecondes(b)) < 60 * 1000;
}

/**
 * Format court d'un horaire pour les notifications (heure locale).
 */
function horaireLisible(debut, fin) {
  const d = new Date(debut);
  const f = new Date(fin);
  const jour = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  const heure = x => x.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${jour} ${heure(d)}-${heure(f)}`;
}

// Cache local des réunions connues, indexé par lien Teams :
//   { id, titre, debut, fin }      réunion de l'utilisateur
//   { inconnue: true, verifieLe }  lien d'un autre organisateur
// Le cache n'est qu'une optimisation : en son absence (réinstallation),
// la réunion est retrouvée auprès de Microsoft à partir de son lien.
async function lireCache(lien) {
  const { reunions } = await browser.storage.local.get("reunions");
  return (reunions || {})[lien] || null;
}

async function ecrireCache(lien, valeur) {
  const { reunions } = await browser.storage.local.get("reunions");
  const tout = reunions || {};
  tout[lien] = valeur;
  await browser.storage.local.set({ reunions: tout });
}

// ---------------------------------------------------------------------------
// État de connexion (infobulle du bouton)
// ---------------------------------------------------------------------------

/**
 * Transmet l'état de connexion à l'API expérimentale (infobulle du bouton).
 */
function signalerConnexion(etat) {
  browser.lienTeams.definirConnecte(etat).catch(e => console.warn("Lien Teams : état de connexion non transmis", e));
}

// État initial au démarrage, puis suivi de toute modification des jetons
// (connexion, renouvellement refusé, déconnexion, changement d'application)
estConnecte().then(signalerConnexion);
browser.storage.onChanged.addListener((changements, zone) => {
  if (zone === "local" && "jetons" in changements) {
    const jetons = changements.jetons.newValue;
    signalerConnexion(Boolean(jetons && jetons.actualisation));
  }
});

// ---------------------------------------------------------------------------
// Création d'une réunion (clic sur le bouton « Lien Teams »)
// ---------------------------------------------------------------------------

browser.lienTeams.onBoutonClique.addListener(async (idFenetre, evenement) => {
  await browser.lienTeams.definirOccupe(idFenetre, true);
  try {
    // Connexion éventuelle présentée dans un bandeau de la fenêtre d'événement
    const jeton = await obtenirJeton(true, presentationBandeau(idFenetre));
    // Statut visible pendant l'appel à Microsoft (après l'éventuelle connexion)
    await browser.lienTeams.afficherStatut(idFenetre, "encours", "⏳ Création de la réunion Teams en cours…", 0);
    const reunion = await creerReunion(jeton, evenement.titre, evenement.debut, evenement.fin);
    await ecrireCache(reunion.lien, {
      id: reunion.id,
      titre: evenement.titre,
      debut: evenement.debut,
      fin: evenement.fin,
    });
    const insere = await browser.lienTeams.insererBloc(idFenetre, {
      lien: reunion.lien,
      idReunion: reunion.idReunion,
      code: reunion.code,
    });
    if (insere) {
      await browser.lienTeams.afficherStatut(
        idFenetre,
        "succes",
        "✅ Réunion Teams créée : lien ajouté à la description.",
        5000
      );
    } else {
      // Fenêtre fermée pendant la création : la réunion existe mais n'est rattachée à rien
      notifier("Réunion Teams créée", "La fenêtre d'événement a été fermée avant l'insertion du lien.");
    }
  } catch (e) {
    if (e instanceof ConnexionAnnulee) {
      await browser.lienTeams.masquerStatut(idFenetre).catch(() => {});
    } else {
      // Erreur affichée dans le bandeau, sans interrompre la saisie ;
      // fenêtre d'alerte en dernier recours si le bandeau est indisponible
      const message = `⚠️ Échec de la création de la réunion Teams : ${e.message || e}`;
      try {
        await browser.lienTeams.afficherStatut(idFenetre, "erreur", message, 0);
      } catch (e2) {
        await browser.lienTeams.alerter(idFenetre, "Lien Teams : échec", String(e.message || e));
      }
    }
  } finally {
    await browser.lienTeams.definirOccupe(idFenetre, false);
  }
});

// ---------------------------------------------------------------------------
// Mise à jour d'une réunion à l'enregistrement de l'événement
// ---------------------------------------------------------------------------

browser.lienTeams.onEvenementEnregistre.addListener(async evenement => {
  const { lien, titre, debut, fin } = evenement;
  try {
    let connue = await lireCache(lien);

    // Lien d'un autre organisateur vérifié récemment : rien à faire, sans appel réseau
    if (connue && connue.inconnue && Date.now() - connue.verifieLe < DUREE_LIEN_INCONNU_MS) {
      return;
    }
    // Réunion connue et inchangée : rien à faire, sans appel réseau
    if (
      connue &&
      !connue.inconnue &&
      connue.titre === titre &&
      memeInstant(connue.debut, debut) &&
      memeInstant(connue.fin, fin)
    ) {
      return;
    }

    // Jeton obtenu sans fenêtre de connexion (traitement en arrière-plan)
    let jeton;
    try {
      jeton = await obtenirJeton(false);
    } catch (e) {
      if (e instanceof ConnexionRequise) {
        // Signalé uniquement pour une réunion de l'utilisateur, déjà identifiée
        if (connue && !connue.inconnue) {
          notifier("Réunion Teams non mise à jour", e.message);
        }
        return;
      }
      throw e;
    }

    // Réunion absente du cache : recherche auprès de Microsoft à partir du lien
    if (!connue || connue.inconnue) {
      const trouvee = await trouverReunion(jeton, lien);
      if (!trouvee) {
        await ecrireCache(lien, { inconnue: true, verifieLe: Date.now() });
        return;
      }
      connue = { id: trouvee.id, titre: trouvee.titre, debut: trouvee.debut, fin: trouvee.fin };
      await ecrireCache(lien, connue);
      if (connue.titre === titre && memeInstant(connue.debut, debut) && memeInstant(connue.fin, fin)) {
        return;
      }
    }

    // Report du titre et de l'horaire sur la réunion Teams
    await modifierReunion(jeton, connue.id, titre, debut, fin);
    await ecrireCache(lien, { id: connue.id, titre, debut, fin });
    notifier("Réunion Teams mise à jour", `${titre}, ${horaireLisible(debut, fin)}`);
  } catch (e) {
    notifier("Réunion Teams non mise à jour", String(e.message || e));
  }
});

// ---------------------------------------------------------------------------
// Messages de la page d'options
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener(async message => {
  switch (message && message.type) {
    case "etat":
      return { connecte: await estConnecte(), config: await lireConfig() };
    case "enregistrer-config":
      return { config: await ecrireConfig(message.config) };
    case "deconnecter":
      await deconnecter();
      return { connecte: false };
    case "connecter":
      await obtenirJeton(true);
      return { connecte: true };
    default:
      // Autres messages (fenêtre de connexion) : traités ailleurs
      return undefined;
  }
});
