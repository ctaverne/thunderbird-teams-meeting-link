/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * (Code source soumis à la Mozilla Public License 2.0, texte officiel ci-dessus.) */

/*
 * Connexion Microsoft (OAuth 2.0, Microsoft Entra ID).
 *
 * - Connexion interactive par code d'appareil : un code est affiché dans une
 *   petite fenêtre de l'extension, à saisir sur microsoft.com/devicelogin
 *   (mot de passe + MFA dans le navigateur).
 * - Le jeton d'actualisation est conservé dans storage.local, puis utilisé
 *   pour renouveler silencieusement le jeton d'accès.
 *
 * Toute la logique d'authentification passe par obtenirJeton(), ce qui permet
 * de remplacer plus tard le flux par code d'appareil (code d'autorisation + PKCE).
 */

"use strict";

/**
 * Erreur signalant qu'une connexion interactive est nécessaire.
 */
class ConnexionRequise extends Error {
  constructor() {
    super("Connexion Microsoft requise : cliquer sur « Lien Teams » pour se connecter.");
    this.name = "ConnexionRequise";
  }
}

/**
 * Erreur signalant l'annulation de la connexion par l'utilisateur.
 */
class ConnexionAnnulee extends Error {
  constructor() {
    super("Connexion Microsoft annulée.");
    this.name = "ConnexionAnnulee";
  }
}

// Connexion interactive en cours (partagée si plusieurs demandes arrivent en même temps)
let connexionEnCours = null;

/**
 * Point d'accès OAuth du tenant configuré.
 */
function urlOAuth(config, chemin) {
  return `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/${chemin}`;
}

/**
 * Requête POST encodée en formulaire vers le point d'accès OAuth ; renvoie le JSON.
 */
async function postOAuth(url, parametres) {
  const reponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parametres),
  });
  return reponse.json();
}

/**
 * Mémorise les jetons reçus de Microsoft.
 */
async function memoriserJetons(reponse, ancienActualisation) {
  const jetons = {
    acces: reponse.access_token,
    // Marge de 60 s pour ne jamais utiliser un jeton sur le point d'expirer
    expireA: Date.now() + (Number(reponse.expires_in) - 60) * 1000,
    // Microsoft renvoie en général un nouveau jeton d'actualisation (rotation)
    actualisation: reponse.refresh_token || ancienActualisation,
  };
  await browser.storage.local.set({ jetons });
  return jetons.acces;
}

/**
 * Renouvellement silencieux à partir du jeton d'actualisation.
 * Renvoie le jeton d'accès, ou null si le renouvellement est impossible.
 */
async function renouveler(config, actualisation) {
  const reponse = await postOAuth(urlOAuth(config, "token"), {
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: actualisation,
    scope: PORTEES,
  });
  if (!reponse.access_token) {
    // Jeton révoqué ou expiré : il est oublié pour forcer une reconnexion
    await browser.storage.local.remove("jetons");
    return null;
  }
  return memoriserJetons(reponse, actualisation);
}

/**
 * Pause asynchrone.
 */
function attendre(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Présentation du code dans une fenêtre séparée de l'extension (connexion
 * lancée depuis la page d'options, sans fenêtre d'événement associée).
 */
function presentationFenetre() {
  let idFenetre = null;
  let annulee = false;
  const surFermeture = id => {
    if (id === idFenetre) {
      annulee = true;
    }
  };
  const surMessage = message => {
    if (message && message.type === "connexion-annulee") {
      annulee = true;
    }
  };
  return {
    async afficher(code, url) {
      const page = browser.runtime.getURL(
        "connexion/connexion.html?" + new URLSearchParams({ code, url })
      );
      const fenetre = await browser.windows.create({ url: page, type: "popup", width: 460, height: 320 });
      idFenetre = fenetre.id;
      browser.windows.onRemoved.addListener(surFermeture);
      browser.runtime.onMessage.addListener(surMessage);
    },
    async estAnnulee() {
      return annulee;
    },
    async fermer() {
      browser.windows.onRemoved.removeListener(surFermeture);
      browser.runtime.onMessage.removeListener(surMessage);
      if (idFenetre !== null) {
        await browser.windows.remove(idFenetre).catch(() => {});
      }
    },
  };
}

/**
 * Présentation du code dans un bandeau de la fenêtre d'événement : le code
 * reste visible au premier plan, sans fenêtre supplémentaire.
 */
function presentationBandeau(idFenetreEvenement) {
  let annulee = false;
  // Présentation de secours (fenêtre séparée) si le bandeau ne peut pas s'afficher
  let secours = null;
  const surAnnulation = id => {
    if (id === idFenetreEvenement) {
      annulee = true;
    }
  };
  return {
    async afficher(code, url) {
      browser.lienTeams.onConnexionAnnulee.addListener(surAnnulation);
      try {
        await browser.lienTeams.afficherCodeConnexion(idFenetreEvenement, code, url);
      } catch (e) {
        console.warn("Lien Teams : bandeau indisponible, fenêtre de connexion utilisée", e);
        secours = presentationFenetre();
        await secours.afficher(code, url);
      }
    },
    async estAnnulee() {
      if (secours && (await secours.estAnnulee())) {
        return true;
      }
      // La fermeture de la fenêtre d'événement vaut annulation
      return annulee || !(await browser.lienTeams.estOuverte(idFenetreEvenement));
    },
    async fermer() {
      browser.lienTeams.onConnexionAnnulee.removeListener(surAnnulation);
      if (secours) {
        await secours.fermer();
      }
      await browser.lienTeams.masquerCodeConnexion(idFenetreEvenement).catch(() => {});
    },
  };
}

/**
 * Connexion interactive par code d'appareil, avec la présentation fournie.
 */
async function connexionCodeAppareil(config, presentation) {
  const flux = await postOAuth(urlOAuth(config, "devicecode"), {
    client_id: config.clientId,
    scope: PORTEES,
  });
  if (!flux.device_code) {
    throw new Error(`Impossible de démarrer la connexion : ${flux.error_description || flux.error}`);
  }

  await presentation.afficher(flux.user_code, flux.verification_uri);
  try {
    let intervalle = Number(flux.interval || 5) * 1000;
    const limite = Date.now() + Number(flux.expires_in || 900) * 1000;
    // Interrogation périodique jusqu'à validation, expiration ou annulation
    while (Date.now() < limite) {
      await attendre(intervalle);
      if (await presentation.estAnnulee()) {
        throw new ConnexionAnnulee();
      }
      const reponse = await postOAuth(urlOAuth(config, "token"), {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: config.clientId,
        device_code: flux.device_code,
      });
      if (reponse.access_token) {
        return memoriserJetons(reponse, null);
      }
      if (reponse.error === "authorization_pending") {
        continue;
      }
      if (reponse.error === "slow_down") {
        intervalle += 5000;
        continue;
      }
      throw new Error(`Connexion refusée : ${reponse.error_description || reponse.error}`);
    }
    throw new Error("Code de connexion expiré, recommencer.");
  } finally {
    await presentation.fermer();
  }
}

/**
 * Renvoie un jeton d'accès Microsoft Graph valide.
 * interactif = false : aucune connexion n'est proposée (usage en arrière-plan),
 * l'erreur ConnexionRequise est levée si aucune connexion n'est disponible.
 * presentation : affichage du code (bandeau d'une fenêtre d'événement) ; par
 * défaut, fenêtre séparée de l'extension.
 */
async function obtenirJeton(interactif, presentation = null) {
  const config = await lireConfig();
  const { jetons } = await browser.storage.local.get("jetons");

  if (jetons && jetons.acces && Date.now() < jetons.expireA) {
    return jetons.acces;
  }
  if (jetons && jetons.actualisation) {
    const acces = await renouveler(config, jetons.actualisation);
    if (acces) {
      return acces;
    }
  }
  if (!interactif) {
    throw new ConnexionRequise();
  }
  // Une seule connexion interactive à la fois
  if (!connexionEnCours) {
    connexionEnCours = connexionCodeAppareil(config, presentation || presentationFenetre()).finally(() => {
      connexionEnCours = null;
    });
  }
  return connexionEnCours;
}

/**
 * Déconnexion : oubli des jetons mémorisés.
 */
async function deconnecter() {
  await browser.storage.local.remove("jetons");
}

/**
 * Indique si une connexion est mémorisée (sans appel réseau).
 */
async function estConnecte() {
  const { jetons } = await browser.storage.local.get("jetons");
  return Boolean(jetons && jetons.actualisation);
}
