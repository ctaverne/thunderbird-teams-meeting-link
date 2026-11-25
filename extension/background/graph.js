/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * (Code source soumis à la Mozilla Public License 2.0, texte officiel ci-dessus.) */

/*
 * Appels Microsoft Graph : création, recherche et mise à jour des réunions
 * en ligne (ressource /me/onlineMeetings).
 */

"use strict";

const URL_REUNIONS = "https://graph.microsoft.com/v1.0/me/onlineMeetings";

/**
 * Appel Graph authentifié ; renvoie le JSON de la réponse ou lève une erreur lisible.
 */
async function appelGraph(jeton, url, options = {}) {
  const reponse = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${jeton}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (reponse.status === 403) {
    throw new Error(
      "Accès refusé par Microsoft (403). Causes probables : compte personnel " +
        "(non pris en charge), licence sans Teams, ou consentement administrateur requis."
    );
  }
  if (!reponse.ok) {
    let detail = "";
    try {
      detail = (await reponse.json()).error?.message || "";
    } catch (e) {
      detail = await reponse.text().catch(() => "");
    }
    const erreur = new Error(`Erreur Microsoft Graph ${reponse.status} : ${detail}`);
    // Code HTTP conservé pour permettre un traitement particulier par l'appelant
    erreur.statut = reponse.status;
    throw erreur;
  }
  return reponse.status === 204 ? null : reponse.json();
}

/**
 * Crée une réunion Teams et renvoie { id, lien, idReunion, code, titre, debut, fin }.
 */
async function creerReunion(jeton, titre, debut, fin) {
  const reunion = await appelGraph(jeton, URL_REUNIONS, {
    method: "POST",
    body: JSON.stringify({ subject: titre, startDateTime: debut, endDateTime: fin }),
  });
  return normaliser(reunion);
}

/**
 * Recherche une réunion de l'utilisateur à partir de son lien.
 * Renvoie la réunion normalisée, ou null si le lien n'appartient pas à
 * l'utilisateur (invitation reçue d'un autre organisateur, par exemple).
 */
async function trouverReunion(jeton, lien) {
  // Les apostrophes sont doublées dans les chaînes de filtre OData
  const filtre = `JoinWebUrl eq '${lien.replace(/'/g, "''")}'`;
  let resultat;
  try {
    resultat = await appelGraph(jeton, `${URL_REUNIONS}?$filter=${encodeURIComponent(filtre)}`);
  } catch (e) {
    // Lien non reconnu par Microsoft (format inattendu, réunion d'un autre
    // organisateur) : Graph répond 400 ou 404, traité comme « réunion inconnue »
    if (e.statut === 400 || e.statut === 404) {
      return null;
    }
    throw e;
  }
  const liste = resultat.value || [];
  return liste.length ? normaliser(liste[0]) : null;
}

/**
 * Met à jour le titre et l'horaire d'une réunion existante.
 */
async function modifierReunion(jeton, id, titre, debut, fin) {
  const reunion = await appelGraph(jeton, `${URL_REUNIONS}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ subject: titre, startDateTime: debut, endDateTime: fin }),
  });
  return reunion ? normaliser(reunion) : null;
}

/**
 * Réduit une réponse Graph aux champs utiles à l'extension.
 */
function normaliser(reunion) {
  const ids = reunion.joinMeetingIdSettings || {};
  return {
    id: reunion.id,
    lien: reunion.joinWebUrl,
    idReunion: ids.joinMeetingId || undefined,
    code: ids.passcode || undefined,
    titre: reunion.subject || "",
    debut: reunion.startDateTime,
    fin: reunion.endDateTime,
  };
}
