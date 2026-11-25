/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * (Code source soumis à la Mozilla Public License 2.0, texte officiel ci-dessus.) */

/*
 * Fenêtre de connexion par code d'appareil : affichage du code, copie dans
 * le presse-papiers, ouverture de la page Microsoft, annulation.
 */

"use strict";

const parametres = new URLSearchParams(location.search);
const code = parametres.get("code") || "";
const url = parametres.get("url") || "https://microsoft.com/devicelogin";

document.getElementById("code").textContent = code;

// Copie du code (geste utilisateur requis) puis ouverture de la page dans le navigateur
document.getElementById("ouvrir").addEventListener("click", async () => {
  const etat = document.getElementById("etat");
  try {
    await navigator.clipboard.writeText(code);
    etat.textContent = "Code copié. Le coller dans la page ouverte, puis se connecter.";
  } catch (e) {
    etat.textContent = "Copie impossible : saisir le code affiché ci-dessus.";
  }
  await browser.windows.openDefaultBrowser(url);
});

// Annulation : le script d'arrière-plan interrompt l'attente, puis la fenêtre se ferme
document.getElementById("annuler").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "connexion-annulee" }).catch(() => {});
  window.close();
});
