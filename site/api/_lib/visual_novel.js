// Event visual novel : le serveur pilote l'histoire. Le navigateur reçoit les
// panneaux jusqu'au prochain arrêt (choix, fin), sans les destinations ni les
// suites possibles, et n'appelle le serveur qu'à ces arrêts.
//
// Format d'une histoire (cf. vn_histoire_essai.js) :
//   { id, nom, chapitres: [{ id, titre, namecard, sous_chapitres: [{ titre,
//     panneaux: [panneau] }] }] }
//   panneau : { id (unique dans le chapitre), fond, nom, texte,
//     persos: [{ image, x, y, hauteur, miroir }]  (calques : le dernier devant ;
//                x : milieu, y : bas, hauteur : en % de la scène),
//     police: { famille, taille, gras, italique },  (cf. commun/vn_polices.js)
//     ensuite }
//   ensuite :
//     absent ou { type: "suite", vers? }  panneau suivant dans l'ordre, ou "vers"
//     { type: "choix", options: [{ id, texte, vers }] }
//     { type: "fin", id, nom }            une fin du chapitre
//
// Partie d'un joueur (table vn_parties) : "panneau" est le début du segment
// en cours, le reste s'en déduit. Recharger la page redonne donc le même
// segment, sans pouvoir changer un choix déjà fait.
const { supabase } = require("./supabase");
const { estAdmin } = require("./admin");
const { lirePoliceVn } = require("../../commun/vn_polices.js");
const HISTOIRE_ESSAI = require("./vn_histoire_essai");

// Segment trop long ou boucle de panneaux : arrêt, puis appel au serveur.
const MAX_PANNEAUX_SEGMENT = 40;

const estId = valeur => typeof valeur === "string" && valeur.length > 0 && valeur.length <= 60;

// { id du panneau : { panneau, suivant, sousChapitre } }
function indexerChapitre(chapitre) {
  const liste = chapitre.sous_chapitres.flatMap(sc => sc.panneaux.map(panneau => ({ panneau, sousChapitre: sc.titre })));
  return new Map(liste.map((entree, i) => [entree.panneau.id, { ...entree, suivant: liste[i + 1]?.panneau.id ?? null }]));
}

// Panneaux depuis "depart" jusqu'au prochain arrêt.
function calculerSegment(chapitre, depart) {
  const index = indexerChapitre(chapitre);
  const entrees = [];
  const vus = new Set();
  let courant = depart;
  for (;;) {
    const entree = index.get(courant);
    if (!entree) throw new Error(`Visual novel : panneau inconnu (${courant}, chapitre ${chapitre.id})`);
    vus.add(courant);
    entrees.push(entree);
    const ensuite = entree.panneau.ensuite || { type: "suite" };
    if (ensuite.type !== "suite") return { entrees, arret: ensuite };
    const cible = ensuite.vers || entree.suivant;
    if (!cible) throw new Error(`Visual novel : panneau sans suite (${courant}, chapitre ${chapitre.id})`);
    if (vus.has(cible) || entrees.length >= MAX_PANNEAUX_SEGMENT) return { entrees, arret: { type: "continuer", vers: cible } };
    courant = cible;
  }
}

// Ce que voit le navigateur : ni les destinations, ni le nom de la fin avant
// de l'avoir atteinte.
function segmentPublic(chapitre, depart) {
  const { entrees, arret } = calculerSegment(chapitre, depart);
  return {
    depuis: depart,
    panneaux: entrees.map(({ panneau, sousChapitre }) => ({
      sous_chapitre: sousChapitre,
      fond: panneau.fond,
      nom: panneau.nom || "",
      texte: panneau.texte || "",
      persos: (panneau.persos || []).map(({ image, x, y, hauteur, miroir }) => ({ image, x, y, hauteur, miroir: miroir === true })),
      police: lirePoliceVn(panneau.police)
    })),
    arret: arret.type === "choix"
      ? { type: "choix", options: arret.options.map(({ id, texte }) => ({ id, texte })) }
      : { type: arret.type }
  };
}

function finsDuChapitre(chapitre) {
  return chapitre.sous_chapitres
    .flatMap(sc => sc.panneaux)
    .map(p => p.ensuite)
    .filter(ensuite => ensuite?.type === "fin");
}

const premierPanneau = chapitre => chapitre.sous_chapitres[0].panneaux[0].id;

function reponseTerminee(chapitre, partie, fin = null) {
  const fins = finsDuChapitre(chapitre);
  return {
    statut: "terminee",
    fin,
    fins_trouvees: fins.filter(f => partie.fins.includes(f.id)).length,
    fins_total: fins.length
  };
}

// Tant que l'option de visibilité n'existe pas : vrais admins seulement.
const peutLire = discordId => estAdmin(discordId);

async function lireParties(discordId, histoireId) {
  const { data, error } = await supabase.from("vn_parties").select("*").eq("discord_id", discordId).eq("histoire_id", histoireId);
  if (error) throw error;
  return data || [];
}

async function ecrirePartie(discordId, histoireId, chapitreId, champs) {
  const { data, error } = await supabase.from("vn_parties")
    .upsert({ discord_id: discordId, histoire_id: histoireId, chapitre_id: chapitreId, ...champs, maj: new Date().toISOString() })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// Page Événements : histoire et avancement du joueur, sans aucun panneau.
async function lireResume(discordId, histoire = HISTOIRE_ESSAI) {
  const parties = new Map((await lireParties(discordId, histoire.id)).map(p => [p.chapitre_id, p]));
  return {
    id: histoire.id,
    nom: histoire.nom,
    chapitres: histoire.chapitres.map(chapitre => {
      const partie = parties.get(chapitre.id);
      const fins = finsDuChapitre(chapitre);
      return {
        id: chapitre.id,
        titre: chapitre.titre,
        namecard: chapitre.namecard,
        sous_chapitres: chapitre.sous_chapitres.map(sc => sc.titre),
        statut: partie?.statut || "nouveau",
        termine: !!partie?.termine_le,
        fins_trouvees: fins.filter(f => partie?.fins?.includes(f.id)).length,
        fins_total: fins.length
      };
    })
  };
}

// Actions du lecteur : "ouvrir" (début ou reprise), "avancer" (choix, suite,
// fin atteinte), "recommencer" (seulement une fois le chapitre fini).
// -> { status, corps }
async function traiterAction(discordId, brut, histoire = HISTOIRE_ESSAI) {
  const chapitre = histoire.chapitres.find(c => c.id === brut?.chapitre);
  if (!chapitre) return { status: 404, corps: { error: "Chapitre introuvable" } };
  const titres = { chapitre: chapitre.titre };

  const { data: lue, error } = await supabase.from("vn_parties").select("*")
    .eq("discord_id", discordId).eq("histoire_id", histoire.id).eq("chapitre_id", chapitre.id).maybeSingle();
  if (error) throw error;

  const ecrire = champs => ecrirePartie(discordId, histoire.id, chapitre.id, champs);
  const envoyerSegment = panneau => ({ status: 200, corps: { ...titres, statut: "en_cours", segment: segmentPublic(chapitre, panneau) } });

  // Première ouverture, ou panneau retiré de l'histoire depuis : au début.
  let partie = lue;
  if (!partie || !indexerChapitre(chapitre).has(partie.panneau)) {
    partie = await ecrire({ panneau: premierPanneau(chapitre), statut: "en_cours", fins: partie?.fins || [], termine_le: partie?.termine_le || null });
  }

  if (brut.action === "recommencer") {
    if (partie.statut !== "terminee") return { status: 409, corps: { error: "Termine d'abord cette partie pour recommencer." } };
    partie = await ecrire({ panneau: premierPanneau(chapitre), statut: "en_cours", fins: partie.fins, termine_le: partie.termine_le });
    return envoyerSegment(partie.panneau);
  }

  if (partie.statut === "terminee") return { status: 200, corps: { ...titres, ...reponseTerminee(chapitre, partie) } };
  if (brut.action === "ouvrir") return envoyerSegment(partie.panneau);
  if (brut.action !== "avancer") return { status: 400, corps: { error: "Action inconnue" } };

  // Double clic ou 2e onglet : la partie a déjà avancé, on renvoie où elle en est.
  if (brut.depuis !== partie.panneau) return envoyerSegment(partie.panneau);

  const { arret } = calculerSegment(chapitre, partie.panneau);
  if (arret.type === "fin") {
    const fins = [...new Set([...partie.fins, arret.id])];
    partie = await ecrire({ panneau: partie.panneau, statut: "terminee", fins, termine_le: partie.termine_le || new Date().toISOString() });
    return { status: 200, corps: { ...titres, ...reponseTerminee(chapitre, partie, { nom: arret.nom }) } };
  }

  let cible = arret.vers;
  if (arret.type === "choix") {
    const option = estId(brut.option) ? arret.options.find(o => o.id === brut.option) : null;
    if (!option) return { status: 400, corps: { error: "Choix invalide" } };
    cible = option.vers;
  }
  partie = await ecrire({ panneau: cible, statut: "en_cours", fins: partie.fins, termine_le: partie.termine_le });
  return envoyerSegment(partie.panneau);
}

module.exports = { peutLire, lireResume, traiterAction, calculerSegment, segmentPublic };
