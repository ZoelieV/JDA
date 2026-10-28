"""Importe des namecards et bannières comme cosmétiques cachés.

Images téléchargées à la main (ex. depuis la galerie du wiki :
https://genshin-impact.fandom.com/wiki/Namecard/Gallery), déposées dans un
dossier, noms d'origine gardés :
    Namecard_Background_<Nom>.png  -> DB/images/namecards/<même nom>.webp (840 px de large)
    Namecard_Banner_<Nom>.png      -> DB/images/namecards/banners/<même nom>.webp (1000 px)
Les images déjà présentes sur le site sont ignorées. Les nouvelles sont
ajoutées à DB/images/namecards/caches.json (cosmétiques cachés : ni en vente
ni dans le tirage normal, cf. generer_cosmetiques.py), puis le manifeste est
régénéré.

    python scripts/importer_namecards.py <dossier>
(nécessite Pillow : pip install pillow)
"""

import json
import sys
from pathlib import Path

from PIL import Image

import generer_cosmetiques as generateur

LARGEURS = {"Namecard_Background_": 840, "Namecard_Banner_": 1000}
DOSSIERS = {"Namecard_Background_": generateur.DOSSIER_BANNIERES, "Namecard_Banner_": generateur.DOSSIER_BANNIERES_2}
CHOIX = {"Namecard_Background_": "banniere", "Namecard_Banner_": "banniere2"}


def main():
    if len(sys.argv) != 2 or not Path(sys.argv[1]).is_dir():
        sys.exit(__doc__)
    caches = json.loads(generateur.FICHIER_CACHES.read_text(encoding="utf-8")) if generateur.FICHIER_CACHES.exists() else []
    ajoutes = 0
    for source in sorted(Path(sys.argv[1]).iterdir()):
        prefixe = next((p for p in LARGEURS if source.name.startswith(p)), None)
        if not prefixe or source.suffix.lower() not in generateur.EXTENSIONS_IMAGES:
            continue
        destination = DOSSIERS[prefixe] / (generateur.nom_fichier_sur(source.stem) + ".webp")
        if destination.exists():
            continue
        with Image.open(source) as image:
            image = image.convert("RGBA")
            largeur = LARGEURS[prefixe]
            if image.width != largeur:
                image = image.resize((largeur, round(image.height * largeur / image.width)), Image.LANCZOS)
            image.save(destination, "WEBP", quality=85, method=6)
        caches.append(f"{CHOIX[prefixe]}:{generateur.chemin_relatif(destination)}")
        ajoutes += 1
        print(f"  {generateur.chemin_relatif(destination)}")
    generateur.FICHIER_CACHES.write_text(json.dumps(sorted(set(caches)), ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{ajoutes} image(s) ajoutée(s) comme cosmétiques cachés.")
    generateur.main()


if __name__ == "__main__":
    main()
