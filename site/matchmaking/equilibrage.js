// Mode Équilibrage de l'entraînement (administrateurs et mini admins) :
// déroulé complet du calcul des bans d'équilibrage, montré avant les bans.
// Vertical : une fois l'analyse finie, chaque étape de l'optimiseur
// (draft.detail_equilibrage, cf. detailEquilibrage dans api/_lib/boxes.js et
// la trace de calculerEquilibrageFixe dans api/_lib/draft.js) : top 12 des
// 2 box, points de chaque perso, retraits essayés et choix fait.
// Horizontal : une fois les bans verticaux faits (draft.horizontal_calcule),
// persos horizontaux, sommes et nombre de bans (cf. calculerBansHorizontaux).
// Chaque déroulé s'ouvre une fois tout seul (par calcul, cf. id), puis à la
// demande (bouton « Déroulé de l'équilibrage »).
// Utilise les globales de matchmaking/match.js (draft, roomId,
// getPersonnageParId, personnagesBase, armesData, pseudoColore,
// ciblesHorizontales) et echapperHtml (commun/cartes.js).
(() => {
  const DUREE_LECTURE_MS = 3200;

  const TEXTES_CAS = {
    normal: l => `Petit joueur au-dessus du seuil bas (top 12 ≥ ${l.seuil_bas}) : un ban qui ferait passer son top 12 sous ${l.seuil_bas} est remplacé par 1 ban joker.`,
    petit: l => `Petit joueur sous le seuil bas (${l.seuil_bas}), adversaire au-dessus du seuil haut (${l.seuil_haut}) : dès qu'un ban toucherait un de ses propres persos, 1 ban joker à la place.`,
    plancher: l => `Petit joueur sous le seuil bas (${l.seuil_bas}), adversaire entre les 2 seuils : pas de joker, les 2 top 12 doivent rester au-dessus du plancher (${l.plancher}).`,
    deux_petits: l => `Les 2 box sous le seuil bas (${l.seuil_bas}) : pas de joker.`
  };
  const TEXTES_REFUS = {
    min_persos: d => `une box passerait sous ${d.limites.min_persos} persos`,
    apres_joker: () => "après le joker, plus aucun ban ne doit toucher le petit joueur",
    limites: d => ({
      normal: `le top 12 du petit joueur passerait sous ${d.limites.seuil_bas}`,
      petit: "le ban toucherait un perso du petit joueur",
      plancher: `un top 12 passerait sous le plancher (${d.limites.plancher})`,
      deux_petits: "limites du cas"
    })[d.cas]
  };
  const TEXTES_FIN = {
    marge: d => `Écart prévu ≤ ${d.marge} : objectif atteint.`,
    aucun_gain: () => "Plus aucun retrait ne réduit l'écart prévu.",
    joker_interdit: () => "Le meilleur ban est refusé et ce cas ne permet pas de joker : arrêt.",
    joker_deja_pris: () => "Le meilleur ban est refusé et le joker est déjà utilisé : arrêt.",
    joker_impossible: () => "Le meilleur ban est refusé et aucun joker n'est possible : arrêt."
  };

  const vus = new Set();
  let fenetre = null;
  let file = []; // déroulés à ouvrir ("vertical", "horizontal")
  let vue = null; // { genre, index, etapes, lecture }

  // ---- Utilitaires ----
  const cleVu = (genre, detail) => `equilibrage:${roomId}:${detail.id}:${genre}`;
  function dejaVu(cle) {
    if (vus.has(cle)) return true;
    try { return sessionStorage.getItem(cle) === "1"; } catch { return false; }
  }
  function marquerVu(cle) {
    vus.add(cle);
    try { sessionStorage.setItem(cle, "1"); } catch { /* stockage indisponible */ }
  }

  function perso(id) {
    return getPersonnageParId(id) || personnagesBase.find(p => p.groupe === id || p.id === id) || { nom: id, image: null };
  }
  const nomPerso = id => echapperHtml(perso(id).groupe ? "Voyageur" : perso(id).nom);
  const imagePerso = id => perso(id).image ? `<img class="eq-portrait" src="/DB/${perso(id).image}" alt="">` : `<span class="eq-portrait"></span>`;
  const nomArme = id => echapperHtml(armesData.find(a => a.id === id)?.nom || id || "");
  const total = ligne => ligne[1] + ligne[2] + ligne[3];
  const arrondi = n => Math.round(n * 100) / 100;
  const nomRole = role => pseudoColore(role);

  // Nombre qui défile de "depuis" à "vers".
  function animerNombre(el, depuis, vers, decimales = 0) {
    const debut = performance.now();
    const duree = 700;
    const pas = t => {
      const p = Math.min(1, (t - debut) / duree);
      const v = depuis + (vers - depuis) * (1 - Math.pow(1 - p, 3));
      el.textContent = v.toFixed(decimales).replace(".", ",");
      if (p < 1 && el.isConnected) requestAnimationFrame(pas);
    };
    requestAnimationFrame(pas);
  }
  const formater = (n, decimales = 0) => Number(n).toFixed(decimales).replace(".", ",");

  // ---- Fenêtre ----
  function creerFenetre() {
    fenetre = document.createElement("div");
    fenetre.className = "eq-fenetre cache";
    fenetre.setAttribute("role", "dialog");
    fenetre.setAttribute("aria-modal", "true");
    fenetre.innerHTML = `
      <div class="eq-contenu">
        <div class="eq-entete">
          <h2 class="eq-titre"></h2>
          <button type="button" class="eq-fermer" title="Fermer">✕</button>
        </div>
        <details class="eq-regles" open>
          <summary>Formules et règles</summary>
          <div class="eq-formules"></div>
        </details>
        <ol class="eq-frise"></ol>
        <div class="eq-etape"></div>
        <div class="eq-pied">
          <button type="button" class="eq-btn eq-precedent">◀ Précédent</button>
          <button type="button" class="eq-btn eq-lecture">▶ Lecture auto</button>
          <button type="button" class="eq-btn eq-suivant">Suivant ▶</button>
          <button type="button" class="eq-btn eq-continuer"></button>
        </div>
      </div>`;
    document.body.appendChild(fenetre);
    fenetre.querySelector(".eq-fermer").addEventListener("click", fermer);
    fenetre.querySelector(".eq-continuer").addEventListener("click", fermer);
    fenetre.querySelector(".eq-precedent").addEventListener("click", () => allerA(vue.index - 1));
    fenetre.querySelector(".eq-suivant").addEventListener("click", () => allerA(vue.index + 1));
    fenetre.querySelector(".eq-lecture").addEventListener("click", basculerLecture);
    document.addEventListener("keydown", e => {
      if (!vue || fenetre.classList.contains("cache")) return;
      if (e.key === "Escape") fermer();
      else if (e.key === "ArrowRight") allerA(vue.index + 1);
      else if (e.key === "ArrowLeft") allerA(vue.index - 1);
    });

    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "eq-rouvrir cache";
    bouton.textContent = "⚖ Déroulé de l'équilibrage";
    bouton.addEventListener("click", () => {
      const d = draft?.detail_equilibrage;
      if (!d) return;
      ouvrir(estHorizontalPret() ? "horizontal" : "vertical");
    });
    document.body.appendChild(bouton);
  }

  function estHorizontalPret() {
    return !!(draft?.horizontal_calcule && draft.detail_equilibrage?.horizontal);
  }

  function arreterLecture() {
    if (vue?.lecture) clearInterval(vue.lecture);
    if (vue) vue.lecture = null;
    const bouton = fenetre?.querySelector(".eq-lecture");
    if (bouton) bouton.textContent = "▶ Lecture auto";
  }

  function basculerLecture() {
    if (vue.lecture) return arreterLecture();
    if (vue.index >= vue.etapes.length - 1) allerA(0);
    fenetre.querySelector(".eq-lecture").textContent = "⏸ Pause";
    vue.lecture = setInterval(() => {
      if (vue.index >= vue.etapes.length - 1) return arreterLecture();
      allerA(vue.index + 1);
    }, DUREE_LECTURE_MS);
  }

  function fermer() {
    arreterLecture();
    fenetre.classList.add("cache");
    document.body.classList.remove("eq-ouverte");
    vue = null;
    const suivant = file.shift();
    if (suivant) ouvrir(suivant);
  }

  function ouvrir(genre) {
    const d = draft?.detail_equilibrage;
    if (!d) return;
    if (!fenetre) creerFenetre();
    arreterLecture();
    marquerVu(cleVu(genre, d));
    const etapes = genre === "vertical" ? d.etapes : etapesHorizontales(d);
    vue = { genre, index: -1, etapes, lecture: null };
    fenetre.querySelector(".eq-titre").textContent = genre === "vertical" ? "Équilibrage vertical" : "Équilibrage horizontal";
    fenetre.querySelector(".eq-continuer").textContent = genre === "vertical"
      ? (draft.phase === "bans_bonus" && draft.etape_bonus !== "horizontal" ? "Passer aux bans verticaux" : "Fermer")
      : (draft.phase === "bans_bonus" && draft.etape_bonus === "horizontal" ? "Passer aux bans horizontaux" : "Fermer");
    fenetre.querySelector(".eq-frise").innerHTML = etapes.map((e, i) =>
      `<li><button type="button" data-i="${i}">${libelleEtape(genre, e, i)}</button></li>`).join("");
    fenetre.querySelectorAll(".eq-frise button").forEach(b => b.addEventListener("click", () => {
      arreterLecture();
      allerA(Number(b.dataset.i));
    }));
    // Petit écran : règles repliées (place pour les étapes).
    if (window.innerHeight < 800 || window.innerWidth < 700) fenetre.querySelector(".eq-regles").open = false;
    fenetre.classList.remove("cache");
    document.body.classList.add("eq-ouverte");
    allerA(0);
  }

  function allerA(index) {
    if (!vue || index < 0 || index >= vue.etapes.length) return;
    vue.index = index;
    fenetre.querySelectorAll(".eq-frise button").forEach((b, i) => {
      b.classList.toggle("active", i === index);
      b.classList.toggle("passee", i < index);
    });
    fenetre.querySelector(".eq-frise button.active")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    fenetre.querySelector(".eq-precedent").disabled = index === 0;
    fenetre.querySelector(".eq-suivant").disabled = index === vue.etapes.length - 1;
    const d = draft.detail_equilibrage;
    if (vue.genre === "vertical") rendreEtapeVerticale(d, index);
    else rendreEtapeHorizontale(d, index);
    fenetre.querySelector(".eq-etape").scrollTop = 0;
  }

  function libelleEtape(genre, e, i) {
    if (genre === "horizontal") return `${i + 1}. ${e.titre}`;
    if (e.type === "depart") return "Départ";
    if (e.type === "ban") return `Ban ${nomPerso(e.choix)}`;
    if (e.type === "joker") return `Joker ${nomPerso(e.choix)}`;
    if (e.type === "refus") return `Refus ${nomPerso(e.refus.id)}`;
    return "Fin";
  }

  // Bans horizontaux prévus si les bans verticaux sont ceux de l'optimiseur
  // (cf. prevoirBansHorizontaux, api/_lib/draft.js) : nombre maximal.
  function htmlHorizontalPrevu(d) {
    const p = d.horizontal_prevu;
    if (!p) return "";
    const seuil = draft.seuil_horizontal || 200;
    const role = { faible: d.faible, fort: d.fort };
    return `<div class="eq-decision eq-prevu">
      <p><b>Bans horizontaux prévus</b> si ${nomRole(d.faible)} fait exactement ces bans : 
        S<sub>${nomRole(role.faible)}</sub> = <b>${p.sommes[role.faible]}</b>, S<sub>${nomRole(role.fort)}</sub> = <b>${p.sommes[role.fort]}</b> ;
        ⌊ ${Math.abs(p.ecart)} / ${seuil} ⌋ = <b>${p.brut}</b>${p.total < p.brut ? `, plafonné à <b>${p.total}</b> (cibles possibles : ${p.cibles})` : ""}
        → <b class="eq-gros" data-de="0" data-vers="${p.total}">${p.total}</b> ban${p.total > 1 ? "s" : ""} horizonta${p.total > 1 ? "ux" : "l"}${p.banneur ? ` pour ${nomRole(p.banneur)}` : ""}.</p>
      <p class="eq-note">Nombre maximal : d'autres bans verticaux changent les sommes, et il baisse s'il ne reste plus assez de cibles.</p>
    </div>`;
  }

  // ---- Vertical ----
  function formulesVerticales(d, etape) {
    const v = etape.verticalite || {};
    const ecart = etape.ecart;
    return `
      <div class="eq-formule"><span>valeur d'un perso</span> = points + arme signature + arme libre</div>
      <div class="eq-formule"><span>verticalité</span> = somme du top ${d.nb_top} / ${d.nb_top}</div>
      <div class="eq-formule eq-formule-chiffres"><span>écart prévu</span> = ${d.taille_equipe} × (V<sub>forte</sub> − V<sub>faible</sub>)${v.fort != null ? ` = ${d.taille_equipe} × (<b>${formater(v.fort, 2)}</b> − <b>${formater(v.faible, 2)}</b>) = <b class="eq-ecart-formule">${ecart}</b>` : ""}</div>
      <div class="eq-formule"><span>objectif</span> : écart ≤ ${d.marge} ; à la fin, au-delà de ${d.tolerance} : pas équilibrable</div>
      <div class="eq-formule"><span>à chaque étape</span> : retirer de la box forte le perso de son top ${d.nb_top} qui réduit le plus l'écart (à gain égal : celui qui vaut le plus) ; un perso que les 2 box ont est retiré des 2</div>
      <p class="eq-contexte">
        Box faible : ${nomRole(d.faible)} (top ${d.nb_top} : ${d.top_faible} pts) · box forte : ${nomRole(d.fort)} (top ${d.nb_top} : ${d.top_fort} pts).<br>
        ${(TEXTES_CAS[d.cas] || (() => ""))(d.limites)}${d.special ? " <b>Mode spécial</b> : autant de jokers que nécessaire." : ""}<br>
        Aucune box sous ${d.limites.min_persos} persos. Écart de points entre les box : ${Math.abs(d.ecart_points)} → l'arme signature d'un perso banni ${d.garder_armes ? `reste dans la box comme arme libre (moins de ${d.seuil_armes_bannies} pts d'écart)` : `part avec lui (${d.seuil_armes_bannies} pts d'écart ou plus)`}.
      </p>`;
  }

  // Top 12 d'une box : barres empilées (perso / signature / arme libre).
  function htmlTop(lignes, precedentes, max, nbTop) {
    const avant = new Set((precedentes || []).map(l => l[0]));
    const somme = lignes.reduce((s, l) => s + total(l), 0);
    return `
      <ol class="eq-top">
        ${lignes.map((l, rang) => {
          const [id, base, sig, libre, armeLibre] = l;
          const nouveau = precedentes && !avant.has(id);
          const largeur = v => `${Math.max(0, (v / max) * 100)}%`;
          const detail = [`${base} perso`, sig ? `${sig} signature` : "", libre ? `${libre} ${nomArme(armeLibre)} (libre)` : ""].filter(Boolean).join(" + ");
          return `
            <li class="eq-ligne${nouveau ? " eq-nouveau" : ""}" style="--i:${rang}" title="${detail} = ${total(l)}">
              <span class="eq-rang">${rang + 1}</span>
              ${imagePerso(id)}
              <span class="eq-nom">${nomPerso(id)}${nouveau ? ` <em>entre dans le top</em>` : ""}</span>
              <span class="eq-barre">
                <i class="eq-seg eq-seg-perso" style="--w:${largeur(base)}"></i><i class="eq-seg eq-seg-sig" style="--w:${largeur(sig)}"></i><i class="eq-seg eq-seg-libre" style="--w:${largeur(libre)}"></i>
              </span>
              <span class="eq-calcul">${base}${sig ? ` + <span class="eq-c-sig">${sig}</span>` : ""}${libre ? ` + <span class="eq-c-libre">${libre}</span>` : ""} = <b>${total(l)}</b></span>
            </li>`;
        }).join("")}
      </ol>
      <div class="eq-somme">Somme ${somme} / ${nbTop} = <b>${formater(somme / nbTop, 2)}</b></div>`;
  }

  function htmlCandidats(d, e) {
    if (!e.candidats?.length) return "";
    const choisi = e.type === "refus" ? e.refus.id : e.choix;
    const maxGain = Math.max(1, ...e.candidats.map(c => c[1]));
    const tries = [...e.candidats].sort((a, b) => b[1] - a[1]);
    return `
      <h3 class="eq-sous-titre">${e.type === "joker" ? "Jokers essayés (retirés de la box forte seulement)" : "Retraits essayés (top de la box forte)"}</h3>
      <ol class="eq-candidats">
        ${tries.map(([id, gain, commun, valide, persosOk], i) => {
          const etat = gain <= 0 ? "sans gain" : !persosOk ? "refusé : trop peu de persos" : !valide && e.type !== "joker" ? "refusé : limites" : "";
          return `
            <li class="eq-candidat${id === choisi ? " eq-choisi" : ""}${gain <= 0 ? " eq-nul" : ""}" style="--i:${i}">
              ${imagePerso(id)}
              <span class="eq-nom">${nomPerso(id)}</span>
              ${commun && e.type !== "joker" ? `<span class="eq-tag eq-tag-commun" title="Les 2 box l'ont : retiré des 2">commun</span>` : "<span></span>"}
              <span class="eq-barre eq-barre-gain"><i class="eq-seg eq-seg-gain" style="--w:${Math.max(0, gain / maxGain * 100)}%"></i></span>
              <span class="eq-gain">${gain > 0 ? "−" : ""}${Math.abs(gain)}</span>
              ${etat ? `<span class="eq-tag">${etat}</span>` : "<span></span>"}
              ${id === choisi ? `<span class="eq-tag eq-tag-choix">${e.type === "refus" ? "meilleur, mais refusé" : "choisi"}</span>` : "<span></span>"}
            </li>`;
        }).join("")}
      </ol>`;
  }

  function htmlDecision(d, e, ecartAvant) {
    if (e.type === "depart") {
      return `<div class="eq-decision">Situation de départ : écart prévu <b class="eq-gros" data-de="${e.ecart}" data-vers="${e.ecart}">${e.ecart}</b>
        ${e.ecart <= d.marge ? ` ≤ ${d.marge} : aucun ban d'équilibrage.` : ` &gt; ${d.marge} : l'optimiseur cherche des bans.`}</div>`;
    }
    if (e.type === "fin") {
      const liste = d.suggestion.map((id, i) => `<span class="eq-puce" style="--i:${i}">${imagePerso(id)}${nomPerso(id)}${i >= d.bans ? " <em>joker</em>" : ""}</span>`).join("");
      return `<div class="eq-decision eq-fin">
        <p>${(TEXTES_FIN[e.raison] || (() => ""))(d)}</p>
        <p>Écart prévu : ${d.ecart_avant} → <b class="eq-gros" data-de="${d.ecart_avant}" data-vers="${e.ecart}">${e.ecart}</b>
          ${e.equilibrable ? `≤ ${d.tolerance} : équilibrable.` : `&gt; ${d.tolerance} : <b class="eq-alerte">pas équilibrable</b>.`}</p>
        <p>${nomRole(d.faible)} a <b>${d.bans + d.jokers}</b> ban${d.bans + d.jokers > 1 ? "s" : ""} d'équilibrage${d.jokers ? ` (dont ${d.jokers} joker${d.jokers > 1 ? "s" : ""})` : ""} sur ${nomRole(d.fort)}. Il choisit librement lesquels ; ceux de l'optimiseur, dans l'ordre :</p>
        <div class="eq-suggestion">${liste || "<em>aucun</em>"}</div>
      </div>
      ${htmlHorizontalPrevu(d)}`;
    }
    if (e.type === "refus") {
      return `<div class="eq-decision eq-refus">Meilleur retrait : ${imagePerso(e.refus.id)} <b>${nomPerso(e.refus.id)}</b> (−${e.refus.gain}) refusé : ${(TEXTES_REFUS[e.refus.raison] || (() => ""))(d)}.</div>`;
    }
    const joker = e.type === "joker";
    return `<div class="eq-decision${joker ? " eq-joker" : ""}">
      ${joker ? `Ban refusé (${imagePerso(e.refus.id)} ${nomPerso(e.refus.id)} : ${(TEXTES_REFUS[e.refus.raison] || (() => ""))(d)}) → <b>ban joker</b> : ` : "Ban : "}
      <span class="eq-banni">${imagePerso(e.choix)}<b>${nomPerso(e.choix)}</b></span>
      ${joker ? "retiré de la box forte seulement (le petit joueur peut encore le picker)" : e.commun ? "retiré des 2 box (les 2 l'ont)" : "retiré de la box forte"}.
      Écart prévu : ${ecartAvant} → <b class="eq-gros" data-de="${ecartAvant}" data-vers="${e.ecart}">${e.ecart}</b> (−${e.gain}).
    </div>`;
  }

  function rendreEtapeVerticale(d, index) {
    const e = d.etapes[index];
    // Fin et refus : pas de nouveau top (celui de l'étape précédente).
    const avecTops = e.tops ? e : [...d.etapes.slice(0, index)].reverse().find(x => x.tops);
    const precedente = index > 0 ? [...d.etapes.slice(0, index)].reverse().find(x => x.tops) : null;
    fenetre.querySelector(".eq-formules").innerHTML = formulesVerticales(d, avecTops || {});
    const max = Math.max(1, ...["faible", "fort"].flatMap(c => (avecTops?.tops?.[c] || []).map(total)));
    const vPrec = precedente?.verticalite;
    const nbBans = d.etapes.slice(0, index + 1).filter(x => x.type === "ban" || x.type === "joker").length;
    fenetre.querySelector(".eq-etape").innerHTML = `
      ${htmlDecision(d, e, precedente?.ecart ?? e.ecart)}
      ${avecTops ? `
        <div class="eq-jauge" title="Écart prévu (objectif ${d.marge}, tolérance ${d.tolerance})">
          <i class="eq-jauge-valeur" style="--w:${Math.min(100, avecTops.ecart / Math.max(d.ecart_avant, d.tolerance * 1.5) * 100)}%"></i>
          <i class="eq-jauge-marque" style="--x:${d.marge / Math.max(d.ecart_avant, d.tolerance * 1.5) * 100}%" data-libelle="${d.marge}"></i>
          <i class="eq-jauge-marque eq-tolerance" style="--x:${d.tolerance / Math.max(d.ecart_avant, d.tolerance * 1.5) * 100}%" data-libelle="${d.tolerance}"></i>
        </div>
        <p class="eq-legende"><i class="eq-seg-perso"></i> points du perso <i class="eq-seg-sig"></i> arme signature <i class="eq-seg-libre"></i> arme libre · ${nbBans} retrait${nbBans > 1 ? "s" : ""} jusqu'ici</p>
        <div class="eq-colonnes">
          <section>
            <h3>${nomRole(d.faible)} <small>box faible</small></h3>
            <div class="eq-verticalite">V<sub>faible</sub> = <b data-de="${vPrec?.faible ?? avecTops.verticalite.faible}" data-vers="${avecTops.verticalite.faible}" data-dec="2">${formater(avecTops.verticalite.faible, 2)}</b></div>
            ${htmlTop(avecTops.tops.faible, precedente?.tops?.faible, max, d.nb_top)}
          </section>
          <section>
            <h3>${nomRole(d.fort)} <small>box forte</small></h3>
            <div class="eq-verticalite">V<sub>forte</sub> = <b data-de="${vPrec?.fort ?? avecTops.verticalite.fort}" data-vers="${avecTops.verticalite.fort}" data-dec="2">${formater(avecTops.verticalite.fort, 2)}</b></div>
            ${htmlTop(avecTops.tops.fort, precedente?.tops?.fort, max, d.nb_top)}
          </section>
        </div>` : ""}
      ${e.type === "ban" || e.type === "joker" || e.type === "refus" ? htmlCandidats(d, e) : ""}`;
    lancerAnimations();
  }

  // Nombres animés (data-de / data-vers) et barres qui se remplissent.
  function lancerAnimations() {
    const zone = fenetre.querySelector(".eq-contenu");
    zone.querySelectorAll("[data-vers]").forEach(el => {
      const de = Number(el.dataset.de), vers = Number(el.dataset.vers);
      if (Number.isFinite(de) && Number.isFinite(vers) && de !== vers) animerNombre(el, de, vers, Number(el.dataset.dec || 0));
    });
    zone.classList.remove("eq-anime");
    void zone.offsetWidth;
    zone.classList.add("eq-anime");
  }

  // ---- Horizontal ----
  function donneesHorizontales(d) {
    const disponibles = new Set(draft.pool_disponible || []);
    const roles = { faible: d.faible, fort: d.fort };
    return Object.fromEntries(["faible", "fort"].map(cote => {
      const role = roles[cote];
      const pool = new Set(draft[`pool_${role}`] || []);
      const lignes = [...(d.horizontal?.[cote] || [])]
        .map(l => ({ l, dispo: pool.has(l[0]) && disponibles.has(l[0]) }))
        .sort((a, b) => total(b.l) - total(a.l));
      // Somme du serveur (cf. calculerBansHorizontaux), sinon recalculée.
      const somme = draft[`somme_horizontale_${role}`] ?? lignes.filter(x => x.dispo).reduce((s, x) => s + total(x.l), 0);
      return [cote, { role, lignes, somme }];
    }));
  }

  function etapesHorizontales() {
    return [
      { titre: "Persos horizontaux" },
      { titre: "Bans verticaux retirés" },
      { titre: "Sommes" },
      { titre: "Nombre de bans" }
    ];
  }

  function formulesHorizontales() {
    const seuil = draft.seuil_horizontal || 200;
    return `
      <div class="eq-formule"><span>perso horizontal</span> = jamais entré dans le top 12 pendant le calcul des bans verticaux</div>
      <div class="eq-formule"><span>valeur horizontale</span> = points + arme signature + arme libre jamais entrée dans un top 12</div>
      <div class="eq-formule"><span>somme horizontale</span> = Σ valeurs des persos horizontaux encore disponibles après les bans verticaux</div>
      <div class="eq-formule"><span>bans horizontaux</span> = ⌊ |S<sub>1</sub> − S<sub>2</sub>| / ${seuil} ⌋, plafonné par les cibles possibles ; la plus petite somme bannit, parmi les persos horizontaux de l'adversaire</div>`;
  }

  function rendreEtapeHorizontale(d, index) {
    fenetre.querySelector(".eq-formules").innerHTML = formulesHorizontales();
    const h = donneesHorizontales(d);
    const max = Math.max(1, ...["faible", "fort"].flatMap(c => h[c].lignes.map(x => total(x.l))));
    const colonne = cote => {
      const { role, lignes, somme } = h[cote];
      let cumul = 0;
      return `
        <section>
          <h3>${nomRole(role)} <small>${lignes.length} perso${lignes.length > 1 ? "s" : ""} horizontaux</small></h3>
          ${index >= 2 ? `<div class="eq-verticalite">S = <b data-de="0" data-vers="${somme}">${somme}</b></div>` : ""}
          <ol class="eq-top">
            ${lignes.map(({ l, dispo }, rang) => {
              const [id, base, sig, libre, armeLibre] = l;
              const retire = index >= 1 && !dispo;
              if (index >= 2 && dispo) cumul += total(l);
              return `
                <li class="eq-ligne${retire ? " eq-retire" : ""}" style="--i:${rang}">
                  <span class="eq-rang">${rang + 1}</span>
                  ${imagePerso(id)}
                  <span class="eq-nom">${nomPerso(id)}${retire ? " <em>retiré (ban vertical ou joker)</em>" : ""}</span>
                  <span class="eq-barre">
                    <i class="eq-seg eq-seg-perso" style="--w:${base / max * 100}%"></i><i class="eq-seg eq-seg-sig" style="--w:${sig / max * 100}%"></i><i class="eq-seg eq-seg-libre" style="--w:${libre / max * 100}%" title="${nomArme(armeLibre)}"></i>
                  </span>
                  <span class="eq-calcul">${base}${sig ? ` + <span class="eq-c-sig">${sig}</span>` : ""}${libre ? ` + <span class="eq-c-libre">${libre}</span>` : ""} = <b>${total(l)}</b>${index >= 2 && dispo ? ` <small>Σ ${cumul}</small>` : ""}</span>
                </li>`;
            }).join("") || "<li class=\"eq-ligne\"><em>aucun</em></li>"}
          </ol>
        </section>`;
    };

    const seuil = draft.seuil_horizontal || 200;
    const s1 = h.faible.somme, s2 = h.fort.somme;
    const brut = Math.floor(Math.abs(s1 - s2) / seuil);
    const total_ = draft.bans_horizontaux_total || 0;
    const banneur = draft.bans_horizontaux_joueur;
    const cibles = banneur && typeof ciblesHorizontales === "function" ? ciblesHorizontales([]).length : 0;
    const textes = [
      "Persos de chaque box jamais entrés dans son top 12 pendant tout le calcul des bans verticaux (départ, puis après chaque retrait de l'optimiseur), avec leur valeur.",
      "Les persos retirés pendant les bans verticaux (choisis par le petit joueur, jokers compris) ne comptent plus.",
      "Somme des persos horizontaux encore disponibles de chaque box.",
      ""
    ];
    const resultat = index === 3 ? `
      <div class="eq-decision eq-fin">
        <p>|${s1} − ${s2}| = <b>${Math.abs(s1 - s2)}</b> ; ⌊ ${Math.abs(s1 - s2)} / ${seuil} ⌋ = <b class="eq-gros" data-de="0" data-vers="${brut}">${brut}</b> ban${brut > 1 ? "s" : ""} horizonta${brut > 1 ? "ux" : "l"}.</p>
        ${brut === 0 ? "<p>Écart sous le seuil : pas de ban horizontal.</p>" : `
          <p>${nomRole(s1 < s2 ? h.faible.role : h.fort.role)} (plus petite somme) bannit parmi les persos horizontaux de ${nomRole(s1 < s2 ? h.fort.role : h.faible.role)}.</p>
          <p>${total_ < brut ? `Plafonné à <b>${total_}</b> : plus assez de cibles (persos horizontaux encore jouables, sans faire passer une box sous ${draft.min_persos_equilibrage || 0} persos).` : `Nombre retenu : <b>${total_}</b>${cibles ? ` (${cibles} cibles possibles)` : ""}.`}</p>`}
        ${d.horizontal_prevu ? `<p>Prévu par l'optimiseur (si les bans verticaux avaient été les siens) : <b>${d.horizontal_prevu.total}</b> ; réel : <b>${total_}</b>${d.horizontal_prevu.total !== total_ ? " (bans verticaux différents de ceux de l'optimiseur, ou moins de cibles)" : ""}.</p>` : ""}
      </div>` : `<div class="eq-decision">${textes[index]}</div>`;
    fenetre.querySelector(".eq-etape").innerHTML = `
      ${resultat}
      <p class="eq-legende"><i class="eq-seg-perso"></i> points du perso <i class="eq-seg-sig"></i> arme signature <i class="eq-seg-libre"></i> arme libre</p>
      <div class="eq-colonnes">${colonne("faible")}${colonne("fort")}</div>`;
    lancerAnimations();
  }

  // ---- Appelé à chaque rendu de la draft (fin de rendrePhase, match.js) ----
  function verifier() {
    const d = draft?.detail_equilibrage;
    const actif = !!(d && draft.entrainement?.detail_equilibrage && !["choix_box", "analyse"].includes(draft.phase));
    if (!fenetre && actif) creerFenetre();
    if (!fenetre) return;
    document.querySelector(".eq-rouvrir")?.classList.toggle("cache", !actif);
    if (!actif) return;
    const aOuvrir = [];
    if (!dejaVu(cleVu("vertical", d))) aOuvrir.push("vertical");
    if (estHorizontalPret() && !dejaVu(cleVu("horizontal", d))) aOuvrir.push("horizontal");
    aOuvrir.forEach(genre => {
      marquerVu(cleVu(genre, d));
      if (vue) file.push(genre); else ouvrir(genre);
    });
    // Bouton du bas de la fenêtre : suit la phase.
    if (vue) {
      const bouton = fenetre.querySelector(".eq-continuer");
      const enCours = vue.genre === "vertical" ? draft.phase === "bans_bonus" && draft.etape_bonus !== "horizontal" : draft.phase === "bans_bonus" && draft.etape_bonus === "horizontal";
      bouton.textContent = enCours ? (vue.genre === "vertical" ? "Passer aux bans verticaux" : "Passer aux bans horizontaux") : "Fermer";
    }
  }

  window.DetailEquilibrage = { verifier, ouvrir };
})();
