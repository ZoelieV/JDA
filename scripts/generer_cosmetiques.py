"""Génère le manifeste des cosmétiques (bannières, fonds d'écran) du site.

Un site statique ne peut pas lister un dossier depuis le navigateur : la page
Mon compte lit donc site/DB/images/cosmetiques.json, produit par ce script.

Pour les fonds d'écran (PNG de plusieurs Mo), le script crée aussi :
  - une version web (WebP, résolution d'origine)     : DB/images/bg_web/...
  - une miniature pour le sélecteur (WebP, 400 px)  : DB/images/bg_miniatures/...
Les fichiers déjà générés et à jour sont ignorés.

À relancer après tout ajout / suppression d'image dans DB/images/namecards,
DB/images/namecards/banners ou DB/images/bg (n'importe quel sous-dossier) :
    python scripts/generer_cosmetiques.py
(nécessite Pillow : pip install pillow)
"""

import json
import re
import shutil
from pathlib import Path

from PIL import Image

RACINE_IMAGES = Path(__file__).resolve().parent.parent / "site" / "DB" / "images"
DOSSIER_BANNIERES = RACINE_IMAGES / "namecards"
DOSSIER_BANNIERES_2 = RACINE_IMAGES / "namecards" / "banners"
DOSSIER_FONDS = RACINE_IMAGES / "bg"
DOSSIER_FONDS_WEB = RACINE_IMAGES / "bg_web"
DOSSIER_FONDS_MINIATURES = RACINE_IMAGES / "bg_miniatures"

EXTENSIONS_IMAGES = {".png", ".jpg", ".jpeg", ".webp"}
LARGEUR_WEB = None  # None = résolution d'origine (4K)
QUALITE_WEB = 100  # WebP avec perte, qualité maximale (sans perte = ~6x plus lourd)
LARGEUR_MINIATURE = 400


def chemin_relatif(chemin):
    return chemin.relative_to(RACINE_IMAGES).as_posix()


def lister_images(dossier, prefixe):
    return sorted(
        chemin_relatif(f)
        for f in dossier.iterdir()
        if f.is_file() and f.suffix.lower() in EXTENSIONS_IMAGES and f.name.startswith(prefixe)
    )


def nom_fichier_sur(nom):
    # Nom sans espaces / accents / apostrophes, pour des URL sans surprise.
    return re.sub(r"[^A-Za-z0-9_-]+", "_", nom).strip("_") or "fond"


def generer_version(source, destination, largeur, qualite):
    if destination.exists() and destination.stat().st_mtime >= source.stat().st_mtime:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = image.convert("RGB")
        if largeur and image.width > largeur:
            hauteur = round(image.height * largeur / image.width)
            image = image.resize((largeur, hauteur), Image.LANCZOS)
        image.save(destination, "WEBP", quality=qualite, method=6)


def generer_fonds():
    fonds = []
    attendus = set()

    for source in sorted(DOSSIER_FONDS.rglob("*")):
        if not source.is_file() or source.suffix.lower() not in EXTENSIONS_IMAGES:
            continue

        sous_dossier = source.parent.relative_to(DOSSIER_FONDS)
        nom = nom_fichier_sur(source.stem) + ".webp"
        web = DOSSIER_FONDS_WEB / sous_dossier / nom
        miniature = DOSSIER_FONDS_MINIATURES / sous_dossier / nom

        generer_version(source, web, LARGEUR_WEB, QUALITE_WEB)
        generer_version(source, miniature, LARGEUR_MINIATURE, 70)
        attendus.update({web, miniature})

        fonds.append({
            "id": chemin_relatif(source),
            "categorie": sous_dossier.as_posix() if sous_dossier.parts else "",
            "image": chemin_relatif(web),
            "miniature": chemin_relatif(miniature)
        })
        print(f"  {chemin_relatif(source)}")

    # Supprime les versions générées dont l'image source a disparu.
    for dossier in (DOSSIER_FONDS_WEB, DOSSIER_FONDS_MINIATURES):
        if not dossier.exists():
            continue
        for fichier in dossier.rglob("*.webp"):
            if fichier not in attendus:
                fichier.unlink()
        for sous in sorted(dossier.rglob("*"), reverse=True):
            if sous.is_dir() and not any(sous.iterdir()):
                shutil.rmtree(sous)

    return fonds


def main():
    print("Fonds d'écran :")
    manifeste = {
        "bannieres": lister_images(DOSSIER_BANNIERES, "Namecard_Background_"),
        "bannieres2": lister_images(DOSSIER_BANNIERES_2, "Namecard_Banner_"),
        "fonds": generer_fonds()
    }

    sortie = RACINE_IMAGES / "cosmetiques.json"
    sortie.write_text(json.dumps(manifeste, ensure_ascii=False, indent=1), encoding="utf-8")
    print(
        f"{sortie} : {len(manifeste['bannieres'])} bannières, "
        f"{len(manifeste['bannieres2'])} bannières 2, {len(manifeste['fonds'])} fonds."
    )


if __name__ == "__main__":
    main()
