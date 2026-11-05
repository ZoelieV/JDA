// Histoire d'essai du visual novel : montre ce que le lecteur sait afficher,
// en attendant l'éditeur de la page admin. Format : cf. visual_novel.js.
const zhongli = (x = 25, miroir = false) => ({ image: "characters/zhongli.webp", x, y: 30, hauteur: 42, miroir });
const venti = (x = 75, miroir = true) => ({ image: "characters/venti.webp", x, y: 30, hauteur: 42, miroir });
const nahida = (x = 50) => ({ image: "characters/nahida.webp", x, y: 30, hauteur: 36 });

const TEMPLE = "bg_web/autres/temple_de_l_espace.webp";
const TAVERNE = "bg_web/autres/inazuma.webp";
const NEIGE = "bg_web/autres/snezhnaya.webp";
const MER = "bg_web/autres/mer_d_antan.webp";
const OASIS = "bg_web/autres/oasis_eternelle.webp";

module.exports = {
  id: "essai",
  nom: "Le pari des Archons (essai)",
  namecard: "namecards/Namecard_Background_Achievement_Adeptal_Valley.webp",
  objets: [
    { id: "cle", nom: "Clé ancienne", description: "Elle ouvre quelque chose, quelque part.", limite: 2 }
  ],
  etats: [
    { id: "mouille", nom: "Mouillé", description: "Tes vêtements trempés te rendent plus lourd.", valeur: -1 },
    { id: "benediction", nom: "Bénédiction de Nahida", description: "Elle ne dure que ce chapitre.", valeur: 2, fin_chapitre: true }
  ],
  chapitres: [
    {
      id: "c1",
      titre: "Chapitre 1 : Une mise de trop",
      namecard: "namecards/Namecard_Background_Achievement_Adeptal_Valley.webp",
      sous_chapitres: [
        {
          id: "invitation",
          titre: "Une invitation",
          panneaux: [
            { id: "c1a", fond: TEMPLE, nom: "Narration", texte: "Ceci est une histoire d'essai. Clique, ou appuie sur Espace, pour avancer.", police: { italique: true } },
            { id: "c1b", fond: TEMPLE, nom: "Venti", texte: "Dis-moi, vieil ami, tu paries combien que le prochain joueur tombe sur le carnage ?", persos: [venti()] },
            { id: "c1c", fond: TEMPLE, nom: "Zhongli", texte: "Un contrat ne se signe pas à la légère.", persos: [venti(), zhongli()], police: { famille: "titre", taille: 5 } },
            { id: "c1d", fond: TEMPLE, nom: "Nahida", texte: "Si vous êtes ~~deux à parler~~ *si bavards*, je peux bien passer **devant** vous, non ?", persos: [venti(60), zhongli(40), nahida()] },
            { id: "c1e", fond: TEMPLE, nom: "Inscription ancienne", texte: "Le jugement attend celui qui lit", persos: [nahida(82)], police: { famille: "teyvat", taille: 6 } },
            { id: "c1f", fond: TEMPLE, nom: "Nahida", texte: "Cette inscription est écrite en teyvat. Et toi, tu suis qui ?", persos: [nahida()], police: { gras: true },
              ensuite: { type: "choix", options: [
                { id: "venti", texte: "Je suis Venti à la taverne", vers: "c1v" },
                { id: "zhongli", texte: "J'écoute Zhongli jusqu'au bout", vers: "c1z" }
              ] } }
          ]
        },
        {
          id: "taverne",
          titre: "La taverne",
          panneaux: [
            { id: "c1v", fond: TAVERNE, nom: "Venti", texte: "Excellent choix ! La première tournée est pour toi.", persos: [venti(50, false)] },
            { id: "c1v2", fond: TAVERNE, nom: "Narration", texte: "Le lendemain, tu ne te souviens de rien. Tes Rikoyns non plus.", ensuite: { type: "suite", vers: "c1a2" } }
          ]
        },
        {
          id: "contrat",
          titre: "Le contrat",
          panneaux: [
            { id: "c1z", fond: NEIGE, nom: "Zhongli", texte: "Sage décision. Commençons par l'histoire des contrats de Liyue, en quarante-sept volumes.", persos: [zhongli(50)], police: { taille: 3.5 } },
            { id: "c1z2", fond: NEIGE, nom: "Narration", texte: "Quelques siècles plus tard, tu arrives enfin au volume 2.", ensuite: { type: "suite", vers: "c1a2" } }
          ]
        },
        {
          id: "addition",
          titre: "L'addition",
          panneaux: [
            { id: "c1a2", fond: OASIS, nom: "Nahida", texte: "Te voilà ! Ces deux-là ont parié sur toi, et ils attendent le résultat.", persos: [nahida()] },
            { id: "c1a3", fond: OASIS, nom: "Venti", texte: "Alors, carnage ou pas carnage ?", persos: [venti(), zhongli(), nahida()] },
            { id: "c1a4", fond: OASIS, nom: "Zhongli", texte: "Réfléchis bien. Tout pari engage celui qui le prononce.", persos: [venti(), zhongli(), nahida()], police: { famille: "titre", taille: 5 } }
          ]
        },
        {
          id: "verdict",
          titre: "Le verdict",
          panneaux: [
            { id: "c1b1", fond: MER, nom: "Narration", texte: "Le boss est tiré au sort. Toute la mer d'antan retient son souffle.", police: { italique: true } },
            { id: "c1b2", fond: MER, nom: "Nahida", texte: "Dernière chance. Tu annonces quoi ?", persos: [nahida()],
              ensuite: { type: "choix", options: [
                { id: "carnage", texte: "Carnage, évidemment", vers: "c1fa" },
                { id: "legende", texte: "Une légende locale", vers: "c1fb" }
              ] } },
            { id: "c1fa", fond: MER, nom: "Venti", texte: "Gagné ! Zhongli paiera... dès qu'il aura retrouvé sa bourse.", persos: [venti(50, false)], ensuite: { type: "fin", id: "bourse", nom: "La bourse introuvable" } },
            { id: "c1fb", fond: MER, nom: "Zhongli", texte: "Perdu. Selon le contrat, tu me dois les volumes 3 à 47.", persos: [zhongli(50)], ensuite: { type: "fin", id: "volumes", nom: "Le contrat éternel" } }
          ]
        }
      ]
    },
    {
      id: "c2",
      titre: "Chapitre 2 : La revanche",
      namecard: "namecards/Namecard_Background_Achievement_Blaze.webp",
      sous_chapitres: [
        {
          id: "retour",
          titre: "Le retour",
          panneaux: [
            { id: "c2a", fond: MER, nom: "Narration", texte: "Ce deuxième chapitre sert à vérifier que l'avancement est suivi chapitre par chapitre.", police: { famille: "rubik" } },
            { id: "c2b", fond: MER, nom: "Venti", texte: "Une revanche ? Je n'ai jamais refusé un pari !", persos: [venti(50, false)] }
          ]
        },
        {
          id: "revanche",
          titre: "La revanche",
          panneaux: [
            { id: "c2c", fond: NEIGE, nom: "Nahida", texte: "Cette fois, personne ne parie. Enfin, c'est ce qu'ils ont promis.", persos: [nahida()] },
            { id: "c2d", fond: NEIGE, nom: "Venti", texte: "À suivre !", persos: [venti(50, false)], ensuite: { type: "fin", id: "suite", nom: "À suivre" } }
          ]
        }
      ]
    },
    {
      id: "c3",
      titre: "Chapitre 3 : Les épreuves",
      namecard: "namecards/Namecard_Background_Achievement_Orbits.webp",
      sous_chapitres: [
        {
          id: "marais",
          titre: "Le marais",
          panneaux: [
            { id: "c3a", fond: OASIS, nom: "Narration", texte: "Ce chapitre montre les interactions. Ce panneau est un point de sauvegarde : un game over te ramènera ici.", sauvegarde: true },
            { id: "c3b", fond: OASIS, nom: "Nahida", texte: "Tiens, prends cette clé. Oh, et tu es tombé dans l'eau : te voilà **mouillé**. Regarde ton inventaire en haut à droite.", persos: [nahida()],
              effets: [{ genre: "objet", id: "cle", quantite: 1 }, { genre: "etat", id: "mouille", actif: true }] },
            { id: "c3c", fond: OASIS, nom: "Narration", texte: "Un ravin te barre la route. Comment passes-tu ?",
              ensuite: { type: "choix", options: [
                { id: "sauter", texte: "Sauter par-dessus", de: { resultats: [
                  { min: 11, vers: "c3d", message: "Tu atterris de l'autre côté." },
                  { max: 10, vers: "c3g", message: "Tu n'as pas sauté assez loin." }
                ] } },
                { id: "cle", texte: "Ouvrir la vieille porte du pont", objet: "cle", consomme: true, vers: "c3d", message: "La clé casse dans la serrure, mais la porte s'ouvre." }
              ] } },
            { id: "c3g", fond: OASIS, nom: "Narration", texte: "Tu tombes dans le ravin. Ni ton inventaire ni ta fierté ne s'en remettront.", ensuite: { type: "game_over", id: "ravin", nom: "Le ravin" } }
          ]
        },
        {
          id: "enigme",
          titre: "L'énigme",
          panneaux: [
            { id: "c3d", fond: TEMPLE, nom: "Zhongli", texte: "Une énigme, pour commencer. Quel est mon véritable nom ?", persos: [zhongli(50)], police: { famille: "titre", taille: 5 },
              ensuite: { type: "texte", consigne: "Écris ta réponse", reponses: [
                { id: "morax", valeurs: ["MORAX"], exact: true, vers: "c3m", message: "Tu l'as écrit comme il se doit." },
                { id: "morax2", valeurs: ["Morax", "Rex Lapis"], vers: "c3e" }
              ], defaut: { message: "Bien essayé, mais ton personnage ne connaît pas encore ce nom.", effets: [{ genre: "etat", id: "benediction", actif: true }] } } },
            { id: "c3m", fond: TEMPLE, nom: "Zhongli", texte: "En lettres capitales, comme sur les anciens contrats. Tu as trouvé une fin cachée.", persos: [zhongli(50)], ensuite: { type: "fin", id: "capitales", nom: "Les lettres capitales" } },
            { id: "c3e", fond: MER, nom: "Venti", texte: "Bravo ! Maintenant, vite : la mer monte. Tu as 20 secondes pour répondre, même si tu recharges la page.", persos: [venti(50, false)],
              timer: { duree: 20, vers: "c3t", message: "Trop tard !" } },
            { id: "c3f", fond: MER, nom: "Venti", texte: "Alors, on court ?", persos: [venti(50, false)],
              ensuite: { type: "choix", options: [
                { id: "courir", texte: "Je cours !", vers: "c3h" }
              ] } },
            { id: "c3h", fond: MER, nom: "Narration", texte: "Tu t'en sors, mouillé mais vivant.", ensuite: { type: "fin", id: "sauve", nom: "Sain et sauf" } },
            { id: "c3t", fond: MER, nom: "Narration", texte: "La mer t'a rattrapé. Ce game over compte comme une fin.", ensuite: { type: "game_over", id: "maree", nom: "La marée", est_fin: true } }
          ]
        }
      ]
    }
  ]
};
