# Usage : python3 scripts/icones_roles.py site/DB/images/others
# Redessine les icônes de rôle Soin et Bouclier en grand (1024 px), puis 128 px.
import sys
from PIL import Image, ImageDraw
T = 1024
SORTIE = 128
dossier = sys.argv[1]

def croix(d, cx, cy, taille, epais, rayon, remplissage, contour, largeur):
    # Croix arrondie : contour (plus grand) puis intérieur.
    for (ep, coul) in ((epais + 2 * largeur, contour), (epais, remplissage)):
        t = taille + (ep - epais)
        d.rounded_rectangle([cx - t / 2, cy - ep / 2, cx + t / 2, cy + ep / 2], radius=rayon, fill=coul)
        d.rounded_rectangle([cx - ep / 2, cy - t / 2, cx + ep / 2, cy + t / 2], radius=rayon, fill=coul)

def coeur(d, cx, cy, l, remplissage, contour, largeur):
    def forme(echelle):
        r = l * 0.27 * echelle
        pts = []
        import math
        # Deux lobes et la pointe.
        for a in range(200, 361, 4):
            pts.append((cx - l * 0.25 * echelle + r * math.cos(math.radians(a)), cy - l * 0.08 * echelle + r * math.sin(math.radians(a))))
        for a in range(180, 341, 4):
            pts.append((cx + l * 0.25 * echelle + r * math.cos(math.radians(a)), cy - l * 0.08 * echelle + r * math.sin(math.radians(a))))
        pts.append((cx + l * 0.5 * echelle * 0.98, cy + l * 0.02 * echelle))
        pts.append((cx, cy + l * 0.48 * echelle))
        pts.append((cx - l * 0.5 * echelle * 0.98, cy + l * 0.02 * echelle))
        return pts
    d.polygon(forme(1 + largeur / l * 2), fill=contour)
    d.polygon(forme(1), fill=remplissage)

def soin():
    im = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    vert_fonce = (96, 140, 38, 255)
    # Croix de derrière (haut gauche, haut droite), un peu plus sombres.
    croix(d, 230, 230, 300, 105, 26, (150, 196, 64, 255), vert_fonce, 18)
    croix(d, 720, 300, 380, 130, 30, (150, 196, 64, 255), vert_fonce, 20)
    # Grande croix devant.
    croix(d, 420, 560, 640, 220, 40, (176, 222, 82, 255), vert_fonce, 24)
    coeur(d, 790, 770, 300, (255, 255, 255, 255), (150, 150, 150, 255), 18)
    return im

def bezier(p0, p1, p2, n=40):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in (k / n for k in range(n + 1))]

def ecusson(m):
    # Écusson large : haut droit, côtés droits, puis courbes jusqu'à la pointe.
    g, dr, haut, coude, pointe = 110 + m, 914 - m, 70 + m, 520, 985 - m * 1.35
    droite = bezier((dr, coude), (dr, coude + 330 - m * 0.4), (512, pointe))
    gauche = bezier((512, pointe), (g, coude + 330 - m * 0.4), (g, coude))
    return [(g, haut), (dr, haut)] + droite + gauche[1:]

def moitie_gauche(m):
    g, haut, coude, pointe = 110 + m, 70 + m, 520, 985 - m * 1.35
    gauche = bezier((512, pointe), (g, coude + 330 - m * 0.4), (g, coude))
    return [(512, haut), (512, pointe)] + gauche[1:] + [(g, haut)]

def bouclier():
    im = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.polygon(ecusson(0), fill=(46, 92, 190, 255))       # contour sombre
    d.polygon(ecusson(30), fill=(92, 146, 236, 255))     # bord
    d.polygon(ecusson(88), fill=(146, 198, 250, 255))    # intérieur clair
    d.polygon(moitie_gauche(150), fill=(86, 152, 224, 255))  # moitié gauche ombrée
    return im

for nom, dessin in (("heal", soin), ("shield", bouclier)):
    grand = dessin()
    grand.resize((SORTIE, SORTIE), Image.LANCZOS).save(f"{dossier}/{nom}.webp", "WEBP", lossless=True)
    print(nom, "ok")
