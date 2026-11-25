/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * (Code source soumis à la Mozilla Public License 2.0, texte officiel ci-dessus.) */

/*
 * Configuration de l'extension (stockée dans storage.local, modifiable
 * depuis la page d'options).
 */

"use strict";

// Valeurs par défaut.
// client_id : application Microsoft publique « Microsoft Graph Command Line Tools ».
// À remplacer par l'identifiant d'une application inscrite dans Entra ID
// (client public, permission déléguée OnlineMeetings.ReadWrite) pour une diffusion.
const CONFIG_DEFAUT = {
  clientId: "14d82eec-204b-4c2f-b7e8-296a70dab67e",
  tenant: "organizations",
};

// Permissions Microsoft demandées : création/modification des réunions en ligne,
// et offline_access pour obtenir un jeton d'actualisation (connexion durable).
const PORTEES = "OnlineMeetings.ReadWrite offline_access";

/**
 * Renvoie la configuration courante (valeurs par défaut complétées).
 */
async function lireConfig() {
  const { config } = await browser.storage.local.get("config");
  return { ...CONFIG_DEFAUT, ...(config || {}) };
}

/**
 * Enregistre la configuration ; un changement d'application ou de tenant
 * invalide la connexion en cours.
 */
async function ecrireConfig(nouvelle) {
  const actuelle = await lireConfig();
  const config = { ...actuelle, ...nouvelle };
  await browser.storage.local.set({ config });
  if (config.clientId !== actuelle.clientId || config.tenant !== actuelle.tenant) {
    await browser.storage.local.remove("jetons");
  }
  return config;
}
