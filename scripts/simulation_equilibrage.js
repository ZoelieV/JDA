// Simulations de drafts entre les vraies box (sortie de graphes_boxes.js),
// pour calibrer l'équilibrage. Équipes de 4 : 1 dps, 1 ou 2 supports, 1 ou 2
// sub dps si possible. Valeur d'un perso = points + arme signature (comme
// les bans d'équilibrage) ; force d'une équipe = somme de ses 4 persos.
//
//   node scripts/simulation_equilibrage.js boxes.json [rapport.json]
//
// IA des 2 joueurs (gloutonne, déterministe) :
//   ban  : le perso qui fait le plus baisser la meilleure équipe possible de
//          l'adversaire, moins ce que le ban coûte à la sienne (bans
//          globaux) ;
//   pick : le perso qui donne la meilleure équipe finale possible, plus la
//          moitié de ce qu'il retire à l'adversaire (picks exclusifs).
const fs = require("fs");
const path = require("path");
const persosCatalogue = require(path.join(__dirname, "..", "site", "DB", "characters.json"));

const ROLE = {};
persosCatalogue.forEach(p => { ROLE[p.groupe || p.id] = p.categorie; });

const NB_PERSOS_MIN_BOX = 16;
const COMPOS = [{ dps: 1, support: 1, subdps: 2 }, { dps: 1, support: 2, subdps: 1 }];
// Si aucune compo voulue n'est possible : n'importe quelles 4 cartes.
const COMPOS_SECOURS = [
  { dps: 2, support: 1, subdps: 1 }, { dps: 1, support: 3, subdps: 0 }, { dps: 1, support: 0, subdps: 3 },
  { dps: 2, support: 2, subdps: 0 }, { dps: 2, support: 0, subdps: 2 }, { dps: 3, support: 1, subdps: 0 },
  { dps: 0, support: 2, subdps: 2 }, { dps: 0, support: 3, subdps: 1 }, { dps: 0, support: 1, subdps: 3 },
  { dps: 4, support: 0, subdps: 0 }, { dps: 0, support: 4, subdps: 0 }, { dps: 0, support: 0, subdps: 4 },
  { dps: 3, support: 0, subdps: 1 }, { dps: 1, support: 1, subdps: 1 }
].filter(c => c.dps + c.support + c.subdps === 4);

// ---- Box ----
function preparerBox(b) {
  const valeurs = Object.fromEntries(b.persos.map(p => [p.id, p.points]));
  const parRole = { dps: [], support: [], subdps: [] };
  b.persos.forEach(p => parRole[ROLE[p.id] || "support"].push(p.id));
  Object.values(parRole).forEach(l => l.sort((a, c) => valeurs[c] - valeurs[a]));
  const tries = Object.values(valeurs).sort((a, c) => c - a);
  return { nom: b.nom, valeurs, parRole, tries };
}

// ---- Meilleure équipe : picks déjà faits + persos encore prenables ----
// exclus(id) : true si le perso n'est plus prenable par ce joueur.
function meilleureEquipe(box, picks, exclus) {
  const roles = { dps: 0, support: 0, subdps: 0 };
  let base = 0;
  picks.forEach(id => { roles[ROLE[id] || "support"]++; base += box.valeurs[id]; });
  const pris = new Set(picks);
  const tops = {};
  const top = (role, n) => {
    if (n <= 0) return 0;
    tops[role] ??= [];
    const liste = tops[role];
    if (liste.length < n) {
      liste.length = 0;
      for (const id of box.parRole[role]) {
        if (pris.has(id) || exclus(id)) continue;
        liste.push(box.valeurs[id]);
        if (liste.length >= 4) break;
      }
    }
    if (liste.length < n) return null;
    let s = 0;
    for (let i = 0; i < n; i++) s += liste[i];
    return s;
  };
  const essayer = compos => {
    let meilleur = null;
    compos.forEach(c => {
      const manque = { dps: c.dps - roles.dps, support: c.support - roles.support, subdps: c.subdps - roles.subdps };
      if (manque.dps < 0 || manque.support < 0 || manque.subdps < 0) return;
      const a = top("dps", manque.dps), s = top("support", manque.support), d = top("subdps", manque.subdps);
      if (a === null || s === null || d === null) return;
      const v = base + a + s + d;
      if (meilleur === null || v > meilleur) meilleur = v;
    });
    return meilleur;
  };
  return essayer(COMPOS) ?? essayer(COMPOS_SECOURS) ?? base;
}

// ---- Séquences (cf. sequenceTheatre, site/api/_lib/draft.js) ----
// bans : { j1: [tour 1, tour 2], j2: [...] } (asymétrique possible).
function sequence(bans) {
  const blocBans = (tour, premier) => {
    const second = premier === "j1" ? "j2" : "j1";
    const n = { [premier]: bans[premier][tour], [second]: bans[second][tour] };
    const res = [];
    let joueur = premier;
    while (n.j1 + n.j2 > 0) {
      if (n[joueur] > 0) { res.push({ joueur, type: "ban" }); n[joueur]--; }
      joueur = joueur === "j1" ? "j2" : "j1";
    }
    return res;
  };
  const picks = ordre => ordre.map(joueur => ({ joueur, type: "pick" }));
  return [...blocBans(0, "j1"), ...picks(["j1", "j2", "j2", "j1"]), ...blocBans(1, "j2"), ...picks(["j2", "j1", "j1", "j2"])];
}
const PALIERS = { carpe: [2, 2], dauphin: [3, 2], baleine: [3, 3] };

// ---- Draft ----
// options : { bannis (bans d'équilibrage, globaux), jokers ({ j1: [...] } :
// interdits à ce joueur seulement), bans ({ j1, j2 } par tour) }.
function simulerDraft(boxJ1, boxJ2, options = {}) {
  const box = { j1: boxJ1, j2: boxJ2 };
  const bannis = new Set(options.bannis || []);
  const jokers = { j1: new Set(options.jokers?.j1 || []), j2: new Set(options.jokers?.j2 || []) };
  const picks = { j1: [], j2: [] };
  const prisPar = new Set();
  const autre = j => (j === "j1" ? "j2" : "j1");
  const exclus = (j, extra) => id => bannis.has(id) || prisPar.has(id) || jokers[j].has(id) || id === extra;
  const meilleure = (j, extra = null, ajout = null) =>
    meilleureEquipe(box[j], ajout ? [...picks[j], ajout] : picks[j], exclus(j, extra));
  const candidats = () => {
    const ids = new Set([...Object.keys(boxJ1.valeurs), ...Object.keys(boxJ2.valeurs)]);
    return [...ids].filter(id => !bannis.has(id) && !prisPar.has(id));
  };

  sequence(options.bans || { j1: PALIERS.carpe, j2: PALIERS.carpe }).forEach(({ joueur, type }) => {
    const adv = autre(joueur);
    const moi0 = meilleure(joueur), adv0 = meilleure(adv);
    let choix = null, score = -Infinity;
    candidats().forEach(id => {
      let s;
      if (type === "ban") {
        s = (adv0 - meilleure(adv, id)) - (moi0 - meilleure(joueur, id));
      } else {
        if (!(id in box[joueur].valeurs) || jokers[joueur].has(id)) return;
        if (picks[joueur].length >= 4) return;
        s = meilleure(joueur, null, id) + 0.5 * (adv0 - meilleure(adv, id));
      }
      // Égalité : le perso le plus cher (puis ordre alphabétique).
      const v = (box[adv].valeurs[id] || 0) + (box[joueur].valeurs[id] || 0);
      s += v * 1e-6;
      if (s > score) { score = s; choix = id; }
    });
    if (!choix) return;
    if (type === "ban") bannis.add(choix);
    else { picks[joueur].push(choix); prisPar.add(choix); }
  });

  const force = j => picks[j].reduce((s, id) => s + box[j].valeurs[id], 0);
  return { j1: force("j1"), j2: force("j2"), picks };
}

// Match complet : les 2 placements J1 / J2 (tirés au hasard sur le site).
// -> { fort, faible } : forces moyennes des équipes.
function simulerMatch(fort, faible, options = {}) {
  const r = [];
  const opt = role => ({
    bannis: options.bannis,
    jokers: options.jokers ? { [role.faible]: [], [role.fort]: options.jokers } : undefined,
    bans: options.bansFaible ? { [role.faible]: options.bansFaible, [role.fort]: PALIERS.carpe } : undefined
  });
  const a = simulerDraft(fort, faible, opt({ fort: "j1", faible: "j2" }));
  const b = simulerDraft(faible, fort, opt({ fort: "j2", faible: "j1" }));
  r.push({ fort: a.j1, faible: a.j2, picks: { fort: a.picks.j1, faible: a.picks.j2 } });
  r.push({ fort: b.j2, faible: b.j1, picks: { fort: b.picks.j2, faible: b.picks.j1 } });
  return { fort: (r[0].fort + r[1].fort) / 2, faible: (r[0].faible + r[1].faible) / 2, details: r };
}

// ---- Bans d'équilibrage (avant la draft) : le faible bannit n persos ----
// Même IA que les bans de draft, équipes vides. joker : interdit au fort
// seulement.
function bansEquilibrage(fort, faible, n, { joker = false, dejaBannis = [] } = {}) {
  const bannis = new Set(dejaBannis);
  const choisis = [];
  for (let i = 0; i < n; i++) {
    const exclusFort = extra => id => bannis.has(id) || id === extra;
    const f0 = meilleureEquipe(fort, [], exclusFort(null));
    const m0 = meilleureEquipe(faible, [], exclusFort(null));
    let choix = null, score = -Infinity;
    Object.keys(fort.valeurs).forEach(id => {
      if (bannis.has(id)) return;
      const perteFort = f0 - meilleureEquipe(fort, [], exclusFort(id));
      // Joker : le faible garde le perso.
      const perteMoi = joker ? 0 : m0 - meilleureEquipe(faible, [], exclusFort(id));
      // À égalité de perte immédiate : le plus cher de la box forte.
      const s = perteFort - perteMoi + fort.valeurs[id] * 1e-3;
      if (s > score) { score = s; choix = id; }
    });
    if (!choix) break;
    bannis.add(choix);
    choisis.push(choix);
  }
  return choisis;
}

module.exports = { preparerBox, meilleureEquipe, simulerDraft, simulerMatch, bansEquilibrage, sequence, PALIERS, ROLE, NB_PERSOS_MIN_BOX };

if (require.main === module) {
  const boxes = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
    .filter(b => b.persos.length >= NB_PERSOS_MIN_BOX)
    .map(preparerBox);
  console.log(boxes.length, "box");
  const t0 = Date.now();
  const m = simulerMatch(boxes[5], boxes[0]);
  console.log(boxes[5].nom, "vs", boxes[0].nom, m.fort, m.faible, JSON.stringify(m.details.map(d => d.picks)), Date.now() - t0, "ms");
}
