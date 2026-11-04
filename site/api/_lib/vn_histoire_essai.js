// Histoire d'essai du visual novel : montre ce que le lecteur sait afficher,
// en attendant l'éditeur de la page admin. Format : cf. visual_novel.js.
const zhongli = (x = 25, miroir = false) => ({ image: "characters/zhongli.webp", x, y: 30, hauteur: 42, miroir });
const venti = (x = 75, miroir = true) => ({ image: "characters/venti.webp", x, y: 30, hauteur: 42, miroir });
const nahida = (x = 50) => ({ image: "characters/nahida.webp", x, y: 30, hauteur: 36 });

module.exports = {
  id: "essai",
  nom: "Le pari des Archons (essai)",
  chapitres: [
    {
      id: "c1",
      titre: "Chapitre 1 : Une mise de trop",
      namecard: "namecards/Namecard_Background_Achievement_Adeptal_Valley.webp",
      sous_chapitres: [
        {
          titre: "Une invitation",
          panneaux: [
            { id: "c1a", fond: "bg_web/autres/temple_de_l_espace.webp", nom: "Narration", texte: "Ceci est une histoire d'essai. Clique, ou appuie sur Espace, pour avancer.", police: { italique: true } },
            { id: "c1b", fond: "bg_web/autres/temple_de_l_espace.webp", nom: "Venti", texte: "Dis-moi, vieil ami, tu paries combien que le prochain joueur tombe sur le carnage ?", persos: [venti()] },
            { id: "c1c", fond: "bg_web/autres/temple_de_l_espace.webp", nom: "Zhongli", texte: "Un contrat ne se signe pas à la légère.", persos: [venti(), zhongli()], police: { famille: "titre", taille: 5 } },
            { id: "c1d", fond: "bg_web/autres/temple_de_l_espace.webp", nom: "Nahida", texte: "Si vous êtes deux à parler, je peux bien passer devant vous, non ?", persos: [venti(60), zhongli(40), nahida()] },
            { id: "c1e", fond: "bg_web/autres/temple_de_l_espace.webp", nom: "Inscription ancienne", texte: "Le jugement attend celui qui lit", persos: [nahida(82)], police: { famille: "teyvat", taille: 6 } },
            { id: "c1f", fond: "bg_web/autres/temple_de_l_espace.webp", nom: "Nahida", texte: "Cette inscription est écrite en teyvat. Et toi, tu suis qui ?", persos: [nahida()], police: { gras: true },
              ensuite: { type: "choix", options: [
                { id: "venti", texte: "Je suis Venti à la taverne", vers: "c1v" },
                { id: "zhongli", texte: "J'écoute Zhongli jusqu'au bout", vers: "c1z" }
              ] } }
          ]
        },
        {
          titre: "La taverne",
          panneaux: [
            { id: "c1v", fond: "bg_web/autres/inazuma.webp", nom: "Venti", texte: "Excellent choix ! La première tournée est pour toi.", persos: [venti(50, false)] },
            { id: "c1v2", fond: "bg_web/autres/inazuma.webp", nom: "Narration", texte: "Le lendemain, tu ne te souviens de rien. Tes Rikoyns non plus.", ensuite: { type: "fin", id: "taverne", nom: "La gueule de bois" } }
          ]
        },
        {
          titre: "Le contrat",
          panneaux: [
            { id: "c1z", fond: "bg_web/autres/snezhnaya.webp", nom: "Zhongli", texte: "Sage décision. Commençons par l'histoire des contrats de Liyue, en quarante-sept volumes.", persos: [zhongli(50)], police: { taille: 3.5 } },
            { id: "c1z2", fond: "bg_web/autres/snezhnaya.webp", nom: "Narration", texte: "Quelques siècles plus tard, le Jugement commence enfin.", ensuite: { type: "fin", id: "contrat", nom: "Le contrat éternel" } }
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
          titre: "Le retour",
          panneaux: [
            { id: "c2a", fond: "bg_web/autres/mer_d_antan.webp", nom: "Narration", texte: "Ce deuxième chapitre sert à vérifier que l'avancement est suivi chapitre par chapitre.", police: { famille: "rubik" } },
            { id: "c2b", fond: "bg_web/autres/mer_d_antan.webp", nom: "Venti", texte: "À suivre !", persos: [venti(50, false)], ensuite: { type: "fin", id: "suite", nom: "À suivre" } }
          ]
        }
      ]
    }
  ]
};
