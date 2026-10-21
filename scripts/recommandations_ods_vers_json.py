# Usage :
#   python3 scripts/recommandations_ods_vers_json.py <fichier.ods> site/DB/recommandations_stuff.json
# Feuille "box stuff" (lignes 4 à 40) -> recommandations par défaut de la
# box stuff (cf. site/commun/recommandations_stuff.js) : une ligne par DPS,
# puis ses supports par priorité ; "<nom> si C4+" = constellation minimale.
# Les administrateurs les modifient ensuite sur la page admin
# (config.recommandations_stuff).
import sys, re, json, zipfile, xml.etree.ElementTree as ET

TABLE = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
PREMIERE_LIGNE, DERNIERE_LIGNE = 4, 40
# Noms du tableau -> id du catalogue (sinon : id ou nom du perso).
ALIAS = {"wrio": "wriothesley", "rosalia": "rosaria", "ayaka": "ayaya", "mitya": "mitya"}

catalogue = json.load(open(sys.argv[2].rsplit("/", 1)[0] + "/characters.json", encoding="utf-8"))
ids = {}
for p in catalogue:
    ids[p["id"].lower()] = p["id"]
    ids[p["nom"].lower()] = p["id"]

def lire(texte):
    texte = texte.strip().lower()
    m = re.match(r"^(.*?)\s+si\s+c(\d)\+?$", texte)
    nom, constellation = (m.group(1), int(m.group(2))) if m else (texte, 0)
    perso = ALIAS.get(nom) or ids.get(nom)
    if not perso:
        sys.exit(f"Perso inconnu : {texte!r}")
    return {"id": perso, **({"constellation_min": constellation} if constellation else {})}

racine = ET.fromstring(zipfile.ZipFile(sys.argv[1]).read("content.xml"))
feuille = next(t for t in racine.iter(TABLE + "table") if t.get(TABLE + "name") == "box stuff")
lignes = []
numero = 0
for ligne in feuille.iter(TABLE + "table-row"):
    numero += int(ligne.get(TABLE + "number-rows-repeated", "1"))
    if numero < PREMIERE_LIGNE or numero > DERNIERE_LIGNE:
        continue
    cellules = []
    for cellule in ligne.findall(TABLE + "table-cell"):
        texte = "".join(cellule.itertext()).strip()
        cellules += [texte] * min(int(cellule.get(TABLE + "number-columns-repeated", "1")), 50)
    cellules = [c for c in cellules if c]
    if not cellules:
        continue
    lignes.append({"dps": lire(cellules[0])["id"], "supports": [lire(c) for c in cellules[1:]]})

with open(sys.argv[2], "w", encoding="utf-8") as sortie:
    json.dump(lignes, sortie, ensure_ascii=False, indent=2)
    sortie.write("\n")
print(f"{len(lignes)} DPS, {sum(len(l['supports']) for l in lignes)} supports")
