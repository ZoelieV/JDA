# Usage : décompresser le .odt dans un dossier, puis
#   python3 scripts/regles_odt_vers_html.py <dossier_odt> site/regles_simplifiees.html
# .odt décompressé (argv[1]) -> sommaire + sections repliables, insérés
# entre les marqueurs de la page HTML (argv[2]).
# Titres de 2e niveau = sections ; listes -> <ul> imbriquées ; gras -> <strong>.
# "[note] ..." ignoré, préfixe "[à valider] " retiré.
import sys, re, html, unicodedata, xml.etree.ElementTree as ET

O = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
T = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
S = "{urn:oasis:names:tc:opendocument:xmlns:style:1.0}"
FO = "{urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0}"

racine = ET.parse(sys.argv[1] + "/content.xml").getroot()
gras = {st.get(S + "name") for st in racine.iter(S + "style")
        if (tp := st.find(S + "text-properties")) is not None and tp.get(FO + "font-weight") == "bold"}

def texte(e, b=False):
    b = b or e.get(T + "style-name") in gras
    def w(t):
        if not t: return ""
        t = html.escape(t, quote=False)
        return f"<strong>{t}</strong>" if b else t
    s = w(e.text)
    for c in e:
        tag = c.tag.replace(T, "")
        if tag == "s": s += " " * int(c.get(T + "c", "1"))
        elif tag == "line-break": s += "<br>"
        elif tag in ("span", "a"): s += texte(c, b)
        s += w(c.tail)
    return s.replace("</strong><strong>", "")

# Coquilles du .odt corrigées à la volée.
CORRECTIONS = [("  :", " :"), ("J2 ,", "J2,"), ("tu est libre", "tu es libre"),
               ("Pour Le défi", "Pour le défi"), ("clip du combat si possible", "clip du combat si possible."),
               ("’", "'"), ("réussir a tuer", "réussir à tuer")]  # ’ absent de la police Classic

def nettoie(t):
    t = t.strip()
    for avant, apres in CORRECTIONS: t = t.replace(avant, apres)
    if re.match(r"(<strong>)?\[note\]", t): return None
    return re.sub(r"^(<strong>)?\[à valider\]\s*", r"\1", t)

def liste(e, ind):
    # [texte, sous-liste] par puce ; une sous-liste sans texte (OnlyOffice
    # la met dans sa propre puce) est rattachée à la puce d'au-dessus.
    items = []
    for li in e.findall(T + "list-item"):
        corps, sous = [], ""
        for c in li:
            if c.tag == T + "p":
                t = nettoie(texte(c))
                if t: corps.append(t)
            elif c.tag == T + "list":
                sous += liste(c, ind + 2)
        if not corps and sous and items:
            items[-1][1] += sous
        elif corps or sous:
            items.append(["<br>".join(corps), sous])
    lignes = "".join(" " * (ind + 2) + "<li>" + t + (("\n" + sl + " " * (ind + 2)) if sl else "") + "</li>\n" for t, sl in items)
    return (" " * ind + "<ul>\n" + lignes + " " * ind + "</ul>\n") if items else ""

def slug(t):
    t = unicodedata.normalize("NFD", re.sub("<[^>]+>", "", t).lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z]+", "-", re.sub(r"^\d+\.\s*", "", t)).strip("-")

# Sections : 2e niveau de titre du document (le 1er est le titre). Sans
# titres (OnlyOffice les enregistre parfois en simples paragraphes) : les
# paragraphes du 2e plus grand corps de texte.
corps_texte = {st.get(S + "name"): float(tp.get(FO + "font-size", "0pt").rstrip("pt") or 0)
               for st in racine.iter(S + "style") if (tp := st.find(S + "text-properties")) is not None}
contenu = racine.find(f".//{{{O}}}text")
niveaux = sorted({h.get(T + "outline-level") for h in racine.iter(T + "h")})
if niveaux:
    niveau = niveaux[1] if len(niveaux) > 1 else niveaux[0]
    est_titre = lambda e: e.tag == T + "h" and e.get(T + "outline-level") == niveau
else:
    tailles = sorted({corps_texte.get(e.get(T + "style-name"), 0) for e in contenu if e.tag == T + "p"}, reverse=True)
    est_titre = lambda e: e.tag == T + "p" and corps_texte.get(e.get(T + "style-name"), 0) == tailles[1]

sections = []
for e in contenu:
    if est_titre(e):
        sections.append([re.sub("</?strong>", "", texte(e)).strip(), ""])
    elif not sections:
        continue
    elif e.tag == T + "list":
        sections[-1][1] += liste(e, 8)
    elif e.tag == T + "p" and (t := nettoie(texte(e))):
        sections[-1][1] += f"        <p>{t}</p>\n"

sommaire = "".join(f'      <li><a href="#{slug(t)}">{t}</a></li>\n' for t, _ in sections)
corps = "".join(
    f'    <details class="section-regles" id="{slug(t)}" open>\n'
    f'      <summary><h2>{t}</h2></summary>\n'
    f'      <div class="section-regles-corps">\n{c}      </div>\n'
    f'    </details>\n' for t, c in sections)

page = open(sys.argv[2], encoding="utf-8").read()
def remplace(page, nom, contenu):
    return re.sub(rf"(<!-- {nom} -->\n).*?\s*?([ \t]*<!-- /{nom} -->)", lambda m: m.group(1) + contenu.rstrip("\n") + "\n" + m.group(2), page, flags=re.S)
page = remplace(page, "SOMMAIRE", sommaire)
page = remplace(page, "SECTIONS", corps)
open(sys.argv[2], "w", encoding="utf-8").write(page)
print(len(sections), "sections")
