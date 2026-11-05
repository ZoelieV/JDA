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
    }
  ]
};
