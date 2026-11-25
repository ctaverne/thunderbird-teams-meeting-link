/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * (Code source soumis à la Mozilla Public License 2.0, texte officiel ci-dessus.) */

/*
 * Page d'options : état de la connexion, connexion/déconnexion, choix de
 * l'application Microsoft et du tenant.
 */

"use strict";

const ID_DEFAUT = "14d82eec-204b-4c2f-b7e8-296a70dab67e";

/**
 * Rafraîchit l'affichage à partir de l'état transmis par l'arrière-plan.
 */
async function afficher() {
  const { connecte, config } = await browser.runtime.sendMessage({ type: "etat" });
  document.getElementById("etat").textContent = connecte
    ? "État : connecté à Microsoft."
    : "État : non connecté (la connexion sera proposée au premier clic sur « Lien Teams »).";
  document.getElementById("clientId").value = config.clientId;
  document.getElementById("tenant").value = config.tenant;
}

document.getElementById("connecter").addEventListener("click", async () => {
  document.getElementById("etat").textContent = "Connexion en cours…";
  try {
    await browser.runtime.sendMessage({ type: "connecter" });
  } catch (e) {
    // Annulation ou refus : l'état réel est réaffiché ci-dessous
  }
  await afficher();
});

document.getElementById("deconnecter").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "deconnecter" });
  await afficher();
});

document.getElementById("enregistrer").addEventListener("click", async () => {
  await browser.runtime.sendMessage({
    type: "enregistrer-config",
    config: {
      clientId: document.getElementById("clientId").value.trim() || ID_DEFAUT,
      tenant: document.getElementById("tenant").value.trim() || "organizations",
    },
  });
  await afficher();
});

document.getElementById("defaut").addEventListener("click", async () => {
  await browser.runtime.sendMessage({
    type: "enregistrer-config",
    config: { clientId: ID_DEFAUT, tenant: "organizations" },
  });
  await afficher();
});

afficher();
