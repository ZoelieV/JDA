// Event visual novel : le serveur pilote l'histoire. Le navigateur reçoit les
// panneaux jusqu'au prochain arrêt (choix, fin), sans les destinations ni les
// suites possibles, et n'appelle le serveur qu'à ces arrêts.
//
// Format d'une histoire (cf. vn_format.js, vn_histoire_essai.js) :
//   { id, nom, namecard, public, chapitres: [{ id, titre, namecard, public, sortie,
//     sous_chapitres: [{ id, titre, panneaux: [panneau] }] }] }
//   public : visible par tout le monde, l'event et le chapitre (sinon vrais admins)
//   sortie : date ISO à partir de laquelle le chapitre apparaît, ou null
//   panneau : { id (unique dans le chapitre), fond, nom,
//     texte  (mise en forme : decouperTexteVn de commun/vn_polices.js),
//     persos: [{ image, x, y, hauteur, miroir }]  (calques : le dernier devant ;
//                x : milieu, y : bas, hauteur : en % de la scène),
//     police: { famille, taille, gras, italique },  (cf. commun/vn_polices.js)
//     effets,             appliqués en arrivant sur le panneau
//     sauvegarde,         point de reprise après un game over
//     timer: { duree (s), vers, effets, message },  lancé en arrivant sur le
//                         panneau, arrêté par la prochaine réponse du joueur
//     musique,            chemin, ou "stop" ; absente : celle en cours continue
//     son,                joué une fois
//     ensuite }
//   ensuite :
//     absent ou { type: "suite", vers? }  panneau suivant dans l'ordre, ou "vers"
//     { type: "choix", options: [{ id, texte, vers, effets, message,
//        objet, consomme,                 (réponse montrée à qui possède l'objet)
//        de: { resultats: [{ min, max, vers, effets, message }] } }] }
//     { type: "texte", consigne, reponses: [{ id, valeurs: [texte], exact, vers,
//        effets, message }], defaut: { vers?, effets, message } }
//        (réponses jamais envoyées au navigateur ; sans "vers", une mauvaise
//         réponse laisse sur place)
//     { type: "fin", id, nom }            une fin du chapitre
//     { type: "game_over", id, nom, est_fin }  (est_fin : compte comme une fin)
//   Au niveau de l'histoire :
//     objets: [{ id, nom, description, image, limite }]
//     etats: [{ id, nom, description, valeur, fin_chapitre }]  (bonus ou malus aux dés)
//     sons: [{ chemin, nom }]             (sons importés, pour l'éditeur)
//   effet : { genre: "objet", id, quantite } ou { genre: "etat", id, actif }
//   Histoire en cours d'écriture : un panneau sans suite ou un choix sans
//   destination arrête la lecture sur un message, sans erreur.
//
// Partie d'un joueur (table vn_parties) : "panneau" est le début du segment
// en cours, le reste s'en déduit. Recharger la page redonne donc le même
// segment, sans pouvoir changer un choix déjà fait. Changer de sous-chapitre
// arrête aussi le segment : la partie est sauvegardée à chaque début de
// sous-chapitre, et un sous-chapitre fini une fois peut être refait depuis
// son début (jamais avant, pour ne pas pouvoir relancer un dé ou refaire un
// choix en cours de route). L'état de jeu (inventaire, timer...) : cf. vn_jeu.js.
//
// Accès : les vrais admins voient tout, à tout moment. Un joueur voit un chapitre
// public et sorti, jouable une fois terminés les chapitres précédents qu'il peut
// voir. Un chapitre déjà commencé reste jouable.
const { supabase } = require("./supabase");
const { estAdmin, getIdsAdmins } = require("./admin");
const { lirePoliceVn } = require("../../commun/vn_polices.js");
const HISTOIRE_ESSAI = require("./vn_histoire_essai");
const jeuVn = require("./vn_jeu");

const ID_HISTOIRE = "principale";

// Histoire enregistrée dans l'éditeur (table vn_histoires), sinon celle
// d'essai, réservée aux admins. null : pas ouverte à ce compte. Relue seulement
// si elle a changé : la date est bien plus légère que l'histoire entière.
let histoireEnCache = null;
async function histoirePour(admin) {
  const { data: ligne, error } = await supabase.from("vn_histoires").select("maj, public").eq("id", ID_HISTOIRE).maybeSingle();
  if (error) throw error;
  if (!ligne) return admin ? HISTOIRE_ESSAI : null;
  if (!admin && !ligne.public) return null;
  if (histoireEnCache?.maj !== ligne.maj) {
    const { data, error: erreur } = await supabase.from("vn_histoires").select("data, maj").eq("id", ID_HISTOIRE).single();
    if (erreur) throw erreur;
    histoireEnCache = { maj: data.maj, histoire: data.data };
  }
  return histoireEnCache.histoire;
}

// Segment trop long ou boucle de panneaux : arrêt, puis appel au serveur.
const MAX_PANNEAUX_SEGMENT = 40;
// Retard accepté sur le timer pour une réponse envoyée à la dernière seconde.
const MARGE_TIMER_MS = 1500;
// Sauts d'un même "passer" : une boucle de panneaux ne le retient pas sans fin.
const MAX_SAUTS = 200;

const estId = valeur => typeof valeur === "string" && valeur.length > 0 && valeur.length <= 60;

// { id du panneau : { panneau, suivant, sc } }
function indexerChapitre(chapitre) {
  const liste = chapitre.sous_chapitres.flatMap(sc => sc.panneaux.map(panneau => ({ panneau, sc })));
  return new Map(liste.map((entree, i) => [entree.panneau.id, { ...entree, suivant: liste[i + 1]?.panneau.id ?? null }]));
}

// Le serveur doit savoir qu'on arrive sur ces panneaux : ils commencent un segment.
const panneauAgit = panneau => panneau.sauvegarde || panneau.timer || panneau.effets?.length > 0;

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
    if (ensuite.type === "choix" && !ensuite.options?.length) return { entrees, arret: { type: "incomplet" } };
    if (ensuite.type === "texte" && !ensuite.reponses?.length) return { entrees, arret: { type: "incomplet" } };
    if (ensuite.type !== "suite") return { entrees, arret: ensuite };
    const cible = ensuite.vers || entree.suivant;
    if (!cible || !index.has(cible)) return { entrees, arret: { type: "incomplet" } };
    const suivant = index.get(cible);
    if (vus.has(cible) || suivant.sc !== entree.sc || panneauAgit(suivant.panneau) || entrees.length >= MAX_PANNEAUX_SEGMENT) return { entrees, arret: { type: "continuer", vers: cible } };
    courant = cible;
  }
}

// Ce que voit le navigateur : ni les destinations, ni les réponses attendues,
// ni le nom de la fin avant de l'avoir atteinte.
function arretPublic(histoire, arret, jeu) {
  if (arret.type === "choix") {
    const options = arret.options.filter(o => !o.objet || jeu.inventaire[o.objet]);
    if (!options.length) return { type: "incomplet" };
    return {
      type: "choix",
      options: options.map(({ id, texte, de, objet }) => ({
        id,
        texte,
        de: !!de,
        objet: objet ? (histoire.objets || []).find(o => o.id === objet)?.nom || null : null
      }))
    };
  }
  if (arret.type === "texte") return { type: "texte", consigne: arret.consigne || "", longueur: jeuVn.LONGUEUR_REPONSE };
  if (arret.type === "game_over") return { type: "fin" };
  return { type: arret.type };
}

function segmentPublic(histoire, chapitre, depart, jeu) {
  const { entrees, arret } = calculerSegment(chapitre, depart);
  return {
    depuis: depart,
    panneaux: entrees.map(({ panneau, sc }) => ({
      sous_chapitre: sc.titre,
      fond: panneau.fond,
      nom: panneau.nom || "",
      texte: panneau.texte || "",
      persos: (panneau.persos || []).map(({ image, x, y, hauteur, miroir }) => ({ image, x, y, hauteur, miroir: miroir === true })),
      police: lirePoliceVn(panneau.police),
      musique: panneau.musique || null,
      son: panneau.son || null
    })),
    arret: arretPublic(histoire, arret, jeu)
  };
}

// Fins qui comptent pour le 100 % : un game over seulement si l'admin le marque.
function finsDuChapitre(chapitre) {
  return chapitre.sous_chapitres
    .flatMap(sc => sc.panneaux)
    .map(p => p.ensuite)
    .filter(ensuite => ensuite?.type === "fin" || (ensuite?.type === "game_over" && ensuite.est_fin));
}

const premierPanneau = chapitre => chapitre.sous_chapitres[0].panneaux[0].id;

// Sous-chapitres montrés au joueur : ceux finis et celui en cours, pour ne pas
// dévoiler les titres des branches pas encore vues.
function sousChapitresVus(chapitre, partie) {
  const courant = partie.statut === "en_cours" ? indexerChapitre(chapitre).get(partie.panneau)?.sc.id : null;
  const finis = partie.sous_chapitres_finis || [];
  return chapitre.sous_chapitres
    .filter(sc => finis.includes(sc.id) || sc.id === courant)
    .map(sc => ({ id: sc.id, titre: sc.titre, fini: finis.includes(sc.id), courant: sc.id === courant }));
}

// Chapitre terminé ou game over : l'écran qui s'affiche à la place du panneau.
function reponseArretee(chapitre, partie, fin = null) {
  const fins = finsDuChapitre(chapitre);
  return {
    statut: partie.statut,
    sous_chapitres: sousChapitresVus(chapitre, partie),
    fin,
    fins_trouvees: fins.filter(f => partie.fins.includes(f.id)).length,
    fins_total: fins.length
  };
}

// Public et sorti : ce qu'un joueur a le droit de voir.
const chapitreOuvert = (chapitre, maintenant = Date.now()) => chapitre.public === true && (!chapitre.sortie || Date.parse(chapitre.sortie) <= maintenant);

// Un chapitre qu'un joueur ne peut pas voir ne peut pas lui être demandé.
function estVerrouille(histoire, chapitre, parties) {
  const finis = new Set(parties.filter(p => p.termine_le).map(p => p.chapitre_id));
  const rang = histoire.chapitres.indexOf(chapitre);
  return histoire.chapitres.slice(0, rang).some(c => chapitreOuvert(c) && !finis.has(c.id));
}

async function lireParties(discordId, histoireId, colonnes = "*") {
  const { data, error } = await supabase.from("vn_parties").select(colonnes).eq("discord_id", discordId).eq("histoire_id", histoireId);
  if (error) throw error;
  return data || [];
}

// { id du chapitre : joueurs l'ayant terminé }, sans les vrais admins, qui testent.
async function lireCompteurs(histoireId) {
  const { data, error } = await supabase.rpc("vn_compteurs", { p_histoire: histoireId, p_exclus: getIdsAdmins() });
  if (error) throw error;
  return new Map((data || []).map(ligne => [ligne.chapitre_id, Number(ligne.joueurs)]));
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
// Sans compte (discordId null) : ce que voit un joueur qui n'a encore rien lu.
// { visible: false } : rien à montrer à ce compte.
async function lireResume(discordId) {
  const admin = estAdmin(discordId);
  const histoire = await histoirePour(admin);
  const visibles = (histoire?.chapitres || []).filter(c => admin || chapitreOuvert(c));
  if (!visibles.length) return { visible: false };
  const [lignes, compteurs] = await Promise.all([
    discordId ? lireParties(discordId, histoire.id, "chapitre_id, statut, fins, termine_le") : [],
    lireCompteurs(histoire.id)
  ]);
  const parties = new Map(lignes.map(p => [p.chapitre_id, p]));
  return {
    visible: true,
    id: histoire.id,
    nom: histoire.nom,
    namecard: histoire.namecard || null,
    public: histoire.public === true,
    chapitres: visibles.map(chapitre => {
      const partie = parties.get(chapitre.id);
      const fins = finsDuChapitre(chapitre);
      const verrou = !partie && estVerrouille(histoire, chapitre, lignes);
      return {
        id: chapitre.id,
        titre: chapitre.titre,
        namecard: chapitre.namecard,
        statut: partie?.statut || "nouveau",
        termine: !!partie?.termine_le,
        fins_trouvees: fins.filter(f => partie?.fins?.includes(f.id)).length,
        fins_total: fins.length,
        joueurs: compteurs.get(chapitre.id) || 0,
        verrouille: verrou && !admin,
        // Ce qui s'applique aux joueurs : les admins passent outre, mais doivent le savoir.
        ...(admin ? { public: chapitre.public === true, sortie: chapitre.sortie || null, verrou_joueurs: verrou } : {})
      };
    })
  };
}

// Actions du lecteur : "ouvrir" (début ou reprise), "avancer" (choix, dé, texte,
// suite, fin atteinte, timer écoulé avec expire: true), "reprendre" (au dernier
// point après un game over), "recommencer" (après un game over ou une fin),
// "refaire" (un sous-chapitre déjà fini, depuis son début), "passer" (chapitre
// déjà terminé : jusqu'au prochain embranchement). admin : "ouvrir" avec
// "panneau" place la partie sur ce panneau (bouton Tester de l'éditeur).
// Le texte saisi n'est ni enregistré, ni renvoyé. -> { status, corps }
async function traiterAction(discordId, brut) {
  const admin = estAdmin(discordId);
  const histoire = await histoirePour(admin);
  const chapitre = histoire?.chapitres.find(c => c.id === brut?.chapitre);
  // Même réponse pour un chapitre caché que pour un chapitre qui n'existe pas.
  if (!chapitre || (!admin && !chapitreOuvert(chapitre))) return { status: 404, corps: { error: "Chapitre introuvable" } };
  const titres = { chapitre: chapitre.titre };

  const { data: lue, error } = await supabase.from("vn_parties").select("*")
    .eq("discord_id", discordId).eq("histoire_id", histoire.id).eq("chapitre_id", chapitre.id).maybeSingle();
  if (error) throw error;
  if (!lue && !admin && estVerrouille(histoire, chapitre, await lireParties(discordId, histoire.id, "chapitre_id, termine_le"))) {
    return { status: 403, corps: { titre: "Chapitre verrouillé", error: "Ce chapitre nécessite d'avoir terminé les chapitres précédents." } };
  }

  let partie = lue;
  let jeu = jeuVn.lireJeu(partie?.jeu);
  const index = indexerChapitre(chapitre);
  const scDe = panneauId => index.get(panneauId)?.sc.id;

  const ecrire = champs => ecrirePartie(discordId, histoire.id, chapitre.id, {
    statut: "en_cours",
    fins: partie?.fins || [],
    sous_chapitres_finis: partie?.sous_chapitres_finis || [],
    termine_le: partie?.termine_le || null,
    jeu,
    ...champs
  });

  const envoyerSegment = ({ annonces = [], message = null, reste = false, passe = false } = {}) => ({
    status: 200,
    corps: {
      ...titres,
      statut: "en_cours",
      sous_chapitres: sousChapitresVus(chapitre, partie),
      segment: segmentPublic(histoire, chapitre, partie.panneau, jeu),
      musique: jeu.musique,
      timer: jeu.timer ? { restant_ms: Math.max(0, jeu.timer.fin - Date.now()), duree: index.get(jeu.timer.panneau)?.panneau.timer?.duree ?? 0 } : null,
      lancer: jeu.lancer,
      ...jeuVn.jeuPublic(histoire, jeu),
      annonces,
      message,
      reste,
      passable: !!partie.termine_le,
      passe
    }
  });
  const envoyerArret = fin => ({
    status: 200,
    corps: {
      ...titres,
      ...reponseArretee(chapitre, partie, fin),
      ...jeuVn.jeuPublic(histoire, jeu),
      reprise: partie.statut === "game_over"
    }
  });

  // Arrivée sur un panneau. scQuitte : sous-chapitre d'où l'on vient (l'état
  // à l'entrée d'un sous-chapitre sert à le refaire).
  function entrer(cible, scQuitte, { sansEffets = false } = {}) {
    const { panneau, sc } = index.get(cible);
    if (sc.id !== scQuitte) jeu.instantanes[sc.id] = { ...jeuVn.instantane(jeu), point: jeu.point };
    const annonces = sansEffets ? [] : jeuVn.appliquerEffets(histoire, jeu, panneau.effets);
    if (panneau.sauvegarde || !jeu.point) jeu.point = { panneau: cible, ...jeuVn.instantane(jeu) };
    if (panneau.timer) jeu.timer = { fin: Date.now() + panneau.timer.duree * 1000, panneau: cible };
    return annonces;
  }

  // Début du chapitre : avec ce que la dernière partie terminée du chapitre
  // précédent le plus proche a transmis (un chapitre caché n'a pas été joué).
  async function demarrer() {
    const rang = histoire.chapitres.indexOf(chapitre);
    const parties = rang > 0 ? await lireParties(discordId, histoire.id) : [];
    const transmis = histoire.chapitres.slice(0, rang).reverse()
      .map(c => jeuVn.lireJeu(parties.find(p => p.chapitre_id === c.id)?.jeu).sortie)
      .find(Boolean);
    jeu = jeuVn.lireJeu({ ...transmis, sortie: jeu.sortie });
    const premier = premierPanneau(chapitre);
    const annonces = entrer(premier, null);
    partie = await ecrire({ panneau: premier });
    return annonces;
  }

  const finirSousChapitre = scId => {
    Object.keys(jeu.des).forEach(cle => { if (jeu.des[cle].sc === scId) delete jeu.des[cle]; });
    return [...new Set([...partie.sous_chapitres_finis, scId])];
  };

  // Quitte le segment en cours pour "cible", sans encore enregistrer.
  function deplacer(cible, { effets = [], repondu = false, lancer = null } = {}) {
    const { entrees } = calculerSegment(chapitre, partie.panneau);
    const scCourant = entrees[0].sc.id;
    entrees.forEach(({ panneau }) => {
      if (panneau.musique) jeu.musique = panneau.musique === "stop" ? null : panneau.musique;
    });
    if (repondu) jeu.timer = null;
    jeu.lancer = lancer;
    const annonces = jeuVn.appliquerEffets(histoire, jeu, effets);
    const finis = scDe(cible) !== scCourant ? finirSousChapitre(scCourant) : partie.sous_chapitres_finis;
    annonces.push(...entrer(cible, scCourant));
    partie = { ...partie, panneau: cible, sous_chapitres_finis: finis };
    return annonces;
  }

  async function partir(cible, { message = null, ...reglages } = {}) {
    const annonces = deplacer(cible, reglages);
    partie = await ecrire({ panneau: cible });
    return envoyerSegment({ annonces, message });
  }

  // Chapitre déjà terminé : jusqu'au prochain embranchement ou à la fin, en
  // appliquant les effets traversés. Un timer arrête le saut : il faut y répondre.
  async function passer() {
    if (!partie.termine_le) return { status: 409, corps: { error: "Termine d'abord ce chapitre pour pouvoir passer les dialogues." } };
    const annonces = [];
    for (let saut = 0; saut < MAX_SAUTS && !jeu.timer; saut++) {
      const { arret } = calculerSegment(chapitre, partie.panneau);
      if (arret.type !== "continuer") break;
      annonces.push(...deplacer(arret.vers));
    }
    partie = await ecrire({ panneau: partie.panneau });
    return envoyerSegment({ annonces, passe: true });
  }

  // Timer écoulé : ses conséquences, à la place de la réponse du joueur.
  async function expirer() {
    const reglage = index.get(jeu.timer.panneau)?.panneau.timer;
    jeu.timer = null;
    const message = reglage?.message || "Le temps est écoulé.";
    if (index.has(reglage?.vers)) return partir(reglage.vers, { effets: reglage.effets, message });
    const annonces = jeuVn.appliquerEffets(histoire, jeu, reglage?.effets);
    jeu.lancer = null;
    partie = await ecrire({ panneau: partie.panneau });
    return envoyerSegment({ annonces, message, reste: true });
  }

  const annoncesDepart = !partie || !index.has(partie.panneau) ? await demarrer() : [];

  if (admin && brut.action === "ouvrir" && estId(brut.panneau) && index.has(brut.panneau)) {
    jeu.timer = null;
    jeu.lancer = null;
    const annonces = entrer(brut.panneau, scDe(partie.panneau));
    partie = await ecrire({ panneau: brut.panneau });
    return envoyerSegment({ annonces });
  }

  if (brut.action === "recommencer") {
    if (partie.statut === "en_cours") return { status: 409, corps: { error: "Termine d'abord cette partie pour recommencer." } };
    return envoyerSegment({ annonces: await demarrer() });
  }

  if (brut.action === "reprendre") {
    if (partie.statut !== "game_over") return { status: 409, corps: { error: "Pas de game over à reprendre." } };
    const point = jeu.point;
    if (!point || !index.has(point.panneau)) return envoyerSegment({ annonces: await demarrer() });
    jeuVn.restaurer(jeu, point);
    jeu.timer = null;
    jeu.lancer = null;
    entrer(point.panneau, scDe(point.panneau), { sansEffets: true });
    partie = await ecrire({ panneau: point.panneau });
    return envoyerSegment();
  }

  if (brut.action === "refaire") {
    const sc = chapitre.sous_chapitres.find(s => s.id === brut.sous_chapitre);
    if (!sc || !partie.sous_chapitres_finis.includes(sc.id)) return { status: 409, corps: { error: "Termine d'abord ce sous-chapitre pour pouvoir le refaire." } };
    const copie = jeu.instantanes[sc.id];
    if (copie) {
      jeuVn.restaurer(jeu, copie);
      jeu.point = copie.point || null;
    }
    jeu.timer = null;
    jeu.lancer = null;
    const annonces = entrer(sc.panneaux[0].id, sc.id);
    partie = await ecrire({ panneau: sc.panneaux[0].id });
    return envoyerSegment({ annonces });
  }

  if (partie.statut !== "en_cours") return envoyerArret(null);

  if (brut.action === "ouvrir") {
    // Temps écoulé pendant que la page était fermée.
    if (jeu.timer && Date.now() > jeu.timer.fin) return expirer();
    return envoyerSegment({ annonces: annoncesDepart });
  }
  if (brut.action !== "avancer" && brut.action !== "passer") return { status: 400, corps: { error: "Action inconnue" } };

  // Double clic ou 2e onglet : la partie a déjà avancé, on renvoie où elle en est.
  if (brut.depuis !== partie.panneau) return envoyerSegment();

  const maintenant = Date.now();
  if (brut.expire === true) {
    if (jeu.timer && maintenant >= jeu.timer.fin - 500) return expirer();
    return envoyerSegment({ reste: true });
  }
  if (jeu.timer && maintenant > jeu.timer.fin + MARGE_TIMER_MS) return expirer();
  if (brut.action === "passer") return passer();

  const { arret, entrees } = calculerSegment(chapitre, partie.panneau);
  const scCourant = entrees[0].sc.id;

  if (arret.type === "fin" || arret.type === "game_over") {
    const compte = arret.type === "fin" || arret.est_fin;
    jeu.timer = null;
    jeu.lancer = null;
    jeu.des = {};
    const champs = { panneau: partie.panneau, statut: arret.type === "fin" ? "terminee" : "game_over" };
    if (compte) {
      jeu.sortie = jeuVn.sortieDe(histoire, jeu);
      champs.fins = [...new Set([...partie.fins, arret.id])];
      champs.sous_chapitres_finis = finirSousChapitre(scCourant);
      champs.termine_le = partie.termine_le || new Date().toISOString();
    }
    partie = await ecrire(champs);
    return envoyerArret({ nom: arret.nom });
  }

  const INCOMPLET = { status: 409, corps: { error: "La suite de ce passage n'est pas encore écrite." } };
  if (arret.type === "incomplet") return INCOMPLET;
  if (arret.type === "continuer") return partir(arret.vers);

  if (arret.type === "texte") {
    const saisie = typeof brut.reponse === "string" ? brut.reponse.trim() : "";
    if (!saisie || saisie.length > jeuVn.LONGUEUR_REPONSE) return { status: 400, corps: { error: "Réponse invalide" } };
    if (!jeuVn.compterEssai(jeu, maintenant)) return envoyerSegment({ message: "Trop d'essais : attends une minute avant de réessayer.", reste: true });
    const reponse = jeuVn.trouverReponse(arret.reponses, saisie);
    const suite = reponse || arret.defaut || {};
    if (index.has(suite.vers)) return partir(suite.vers, { effets: suite.effets, message: suite.message || null, repondu: true });
    if (reponse) return INCOMPLET;
    const annonces = jeuVn.appliquerEffets(histoire, jeu, suite.effets);
    jeu.lancer = null;
    partie = await ecrire({ panneau: partie.panneau });
    return envoyerSegment({ annonces, message: suite.message || "Ce n'est pas la bonne réponse.", reste: true });
  }

  // Choix : la réponse, et son dé s'il y en a un.
  const option = estId(brut.option) ? arret.options.find(o => o.id === brut.option) : null;
  if (!option || (option.objet && !jeu.inventaire[option.objet])) return { status: 400, corps: { error: "Choix invalide" } };
  const effets = [...(option.effets || [])];
  if (option.objet && option.consomme) effets.push({ genre: "objet", id: option.objet, quantite: -1 });

  if (option.de) {
    const cle = `${partie.panneau}:${option.id}`;
    const tirage = jeuVn.lancerDe(histoire, jeu, option.de, cle, partie.sous_chapitres_finis.includes(scCourant), scCourant);
    if (!index.has(tirage.resultat?.vers)) return INCOMPLET;
    if (tirage.garder) jeu.des[cle] = tirage.garder;
    return partir(tirage.resultat.vers, {
      effets: [...effets, ...(tirage.resultat.effets || [])],
      repondu: true,
      lancer: { base: tirage.base, modificateurs: tirage.modificateurs, total: tirage.total, message: tirage.resultat.message || "" }
    });
  }

  if (!index.has(option.vers)) return INCOMPLET;
  return partir(option.vers, { effets, repondu: true, message: option.message || null });
}

module.exports = { ID_HISTOIRE, lireResume, traiterAction, calculerSegment, segmentPublic };
