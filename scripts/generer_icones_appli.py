"""Icônes et écrans de lancement de l'appli (site/manifest.webmanifest,
site/index.html).

- Écran d'accueil du téléphone : logo simplifié (logo_site.png), grand.
  appli_maskable_512 (Android, icônes adaptatives : logo dans la zone sûre,
  cercle de 80 %) et appli_apple_180 (iPhone).
- Écran de lancement : vrai logo (logo_detaille_jda_v2.webp).
  Android : construit par le navigateur avec les icônes "any" du manifest
  (appli_192, appli_512) et background_color ; iPhone : images de démarrage
  (appli_lancement_<l>x<h>.png, balises apple-touch-startup-image de
  index.html, une par taille d'écran).

Usage : python3 scripts/generer_icones_appli.py (depuis la racine du dépôt).
"""
from pathlib import Path

from PIL import Image

DOSSIER = Path(__file__).resolve().parent.parent / "site" / "DB" / "images" / "others"
FOND = (30, 30, 30, 255)  # #1e1e1e, background_color du manifest

# Écrans d'iPhone en portrait (pixels) : largeur, hauteur, largeur CSS,
# hauteur CSS, densité.
ECRANS_IPHONE = [
    (1320, 2868, 440, 956, 3),  # 16 Pro Max
    (1206, 2622, 402, 874, 3),  # 16 Pro
    (1290, 2796, 430, 932, 3),  # 14 Pro Max, 15 Plus / Pro Max, 16 Plus
    (1179, 2556, 393, 852, 3),  # 14 Pro, 15, 15 Pro, 16
    (1284, 2778, 428, 926, 3),  # 12 / 13 Pro Max, 14 Plus
    (1170, 2532, 390, 844, 3),  # 12, 13, 14
    (1080, 2340, 360, 780, 3),  # 12 / 13 mini
    (1125, 2436, 375, 812, 3),  # X, XS, 11 Pro
    (1242, 2688, 414, 896, 3),  # XS Max, 11 Pro Max
    (828, 1792, 414, 896, 2),   # XR, 11
    (750, 1334, 375, 667, 2),   # SE, 8
]


def logo(nom):
    """Logo détouré (sans marges transparentes)."""
    image = Image.open(DOSSIER / nom).convert("RGBA")
    return image.crop(image.split()[-1].point(lambda v: 255 if v > 40 else 0).getbbox())


def placer(source, largeur, hauteur, part):
    """Fond sombre largeur x hauteur, logo centré : sa hauteur (ou sa
    largeur si elle dépasse) = part du plus petit côté."""
    toile = Image.new("RGBA", (largeur, hauteur), FOND)
    cote = min(largeur, hauteur) * part
    echelle = min(cote / source.height, cote / source.width)
    image = source.resize((round(source.width * echelle), round(source.height * echelle)), Image.LANCZOS)
    toile.alpha_composite(image, ((largeur - image.width) // 2, (hauteur - image.height) // 2))
    return toile.convert("RGB")


def main():
    simple = logo("logo_site.png")
    detaille = logo("logo_detaille_jda_v2.webp")
    # Accueil du téléphone : plus grand qu'avant (maskable 54 % -> 64 %,
    # iPhone 67 % -> 78 %).
    placer(simple, 512, 512, 0.64).save(DOSSIER / "appli_maskable_512.png", optimize=True)
    placer(simple, 180, 180, 0.78).save(DOSSIER / "appli_apple_180.png", optimize=True)
    # Icônes "any" (écran de lancement Android, ordinateur) : vrai logo.
    placer(detaille, 512, 512, 0.84).save(DOSSIER / "appli_512.png", optimize=True)
    placer(detaille, 192, 192, 0.84).save(DOSSIER / "appli_192.png", optimize=True)
    # Lancement sur iPhone : vrai logo à 45 % de la largeur.
    for largeur, hauteur, *_ in ECRANS_IPHONE:
        placer(detaille, largeur, hauteur, 0.45).save(DOSSIER / f"appli_lancement_{largeur}x{hauteur}.png", optimize=True)
    for largeur, hauteur, l_css, h_css, densite in ECRANS_IPHONE:
        print(f'  <link rel="apple-touch-startup-image" href="/DB/images/others/appli_lancement_{largeur}x{hauteur}.png" '
              f'media="(device-width: {l_css}px) and (device-height: {h_css}px) and (-webkit-device-pixel-ratio: {densite}) and (orientation: portrait)">')


if __name__ == "__main__":
    main()
