"""Met à jour les boss et les fonds du carnage chtonien (tous les 40 jours).

Boss : site/DB/images/boss/carnage_chtonien/ contient 3 images dont seul le
chiffre final compte ("..._1.webp", "..._2.webp", "..._3.webp" = salles 1 à
3). Le chemin de chacune est écrit dans l'entrée boss_1 / boss_2 / boss_3 de
site/DB/boss.json (les anciennes images peuvent aller dans le sous-dossier
archive_boss_carnage/, ignoré).

Fonds : site/DB/images/bg_web/carnage_chtonien/boss_<n>.webp, fond du match
quand le boss boss_<n> est tiré. Le script les liste dans
DB/images/cosmetiques.json (catégorie "carnage_chtonien") et crée leurs
miniatures (DB/images/bg_miniatures/carnage_chtonien/).

Noms ("Carnage 4 : Salle 1") et résistances : page admin, bouton Boss.

    python scripts/maj_carnage.py
(nécessite Pillow : pip install pillow)
"""

import json
import re
from pathlib import Path

from PIL import Image

RACINE_DB = Path(__file__).resolve().parent.parent / "site" / "DB"
RACINE_IMAGES = RACINE_DB / "images"
DOSSIER_BOSS = RACINE_IMAGES / "boss" / "carnage_chtonien"
DOSSIER_FONDS_WEB = RACINE_IMAGES / "bg_web" / "carnage_chtonien"
DOSSIER_MINIATURES = RACINE_IMAGES / "bg_miniatures" / "carnage_chtonien"
CATEGORIE = "carnage_chtonien"
SALLES = (1, 2, 3)
LARGEUR_MINIATURE = 400


def maj_images_boss():
    fichier = RACINE_DB / "boss.json"
    texte = fichier.read_text(encoding="utf-8")
    for salle in SALLES:
        images = sorted(f for f in DOSSIER_BOSS.glob(f"*_{salle}.webp") if f.is_file())
        if len(images) != 1:
            print(f"  boss_{salle} : {len(images)} image(s) finissant par _{salle}.webp, inchangé")
            continue
        chemin = images[0].relative_to(RACINE_DB).as_posix()
        # Remplacement dans le texte pour garder la mise en forme du JSON.
        motif = re.compile(r'("id": "boss_%d",(?:[^{}])*?"image": )"[^"]*"' % salle)
        texte, n = motif.subn(lambda m: f'{m.group(1)}{json.dumps(chemin, ensure_ascii=False)}', texte)
        print(f"  boss_{salle} : {chemin}" if n else f"  boss_{salle} : absent de boss.json")
    json.loads(texte)
    fichier.write_text(texte, encoding="utf-8")


def maj_fonds():
    fichier = RACINE_IMAGES / "cosmetiques.json"
    cosmetiques = json.loads(fichier.read_text(encoding="utf-8"))
    fonds = [f for f in cosmetiques["fonds"] if f["categorie"] != CATEGORIE]

    DOSSIER_MINIATURES.mkdir(parents=True, exist_ok=True)
    attendues = set()
    for salle in SALLES:
        web = DOSSIER_FONDS_WEB / f"boss_{salle}.webp"
        if not web.is_file():
            print(f"  fond boss_{salle} : absent")
            continue
        miniature = DOSSIER_MINIATURES / web.name
        attendues.add(miniature)
        if not miniature.exists() or miniature.stat().st_mtime < web.stat().st_mtime:
            with Image.open(web) as image:
                image = image.convert("RGB")
                if image.width > LARGEUR_MINIATURE:
                    hauteur = round(image.height * LARGEUR_MINIATURE / image.width)
                    image = image.resize((LARGEUR_MINIATURE, hauteur), Image.LANCZOS)
                image.save(miniature, "WEBP", quality=70, method=6)
        fonds.append({
            "id": f"bg/{CATEGORIE}/{web.name}",
            "categorie": CATEGORIE,
            "image": web.relative_to(RACINE_IMAGES).as_posix(),
            "miniature": miniature.relative_to(RACINE_IMAGES).as_posix()
        })
        print(f"  fond boss_{salle}")

    for miniature in DOSSIER_MINIATURES.glob("*.webp"):
        if miniature not in attendues:
            miniature.unlink()

    cosmetiques["fonds"] = fonds
    fichier.write_text(json.dumps(cosmetiques, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    print("Boss :")
    maj_images_boss()
    print("Fonds :")
    maj_fonds()


if __name__ == "__main__":
    main()
