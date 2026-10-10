# Un graphe en bâtons par box (persos triés par points croissants, part
# perso + part arme signature), plus un bâton vert à droite : points des
# armes non comptées dans les bâtons (sans perso, copies), PNG dans le dossier donné. Entrée : sortie
# de scripts/graphes_boxes.js.
#   python scripts/graphes_boxes.py boxes.json scripts/sortie/graphes_boxes
import json, sys, re, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
boxes = json.load(open(sys.argv[1])); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
ymax = max([p["points"] for b in boxes for p in b["persos"]] + [b["autres"] for b in boxes]) * 1.08
PERSO, ARME, AUTRES = "#2a78d6", "#eb6834", "#008300"
for b in boxes:
    ps = b["persos"]; n = len(ps)
    fig, ax = plt.subplots(figsize=(max(10, (n + 2) * 0.17), 6), dpi=130)
    x = range(n)
    ax.bar(x, [p["perso"] for p in ps], color=PERSO, width=0.8, label="Personnage")
    ax.bar(x, [p["points"] - p["perso"] for p in ps], bottom=[p["perso"] for p in ps], color=ARME, width=0.8, label="Arme signature")
    # Bâton vert séparé des persos par un espace.
    xa = n + 1
    ax.bar([xa], [b["autres"]], color=AUTRES, width=0.8, label="Autres armes (sans perso, copies)")
    ax.text(xa, b["autres"], str(b["autres"]), ha="center", va="bottom", fontsize=8)
    total = b["total"]
    ax.set_title(f'{b["nom"]}  —  {n} persos, {total} pts', fontsize=14, loc="left", fontweight="bold")
    ax.set_xticks(list(x) + [xa]); ax.set_xticklabels([p["nom"] for p in ps] + ["Autres armes"], rotation=90, fontsize=7)
    ax.set_xlim(-0.6, xa + 0.6); ax.set_ylim(0, ymax); ax.set_ylabel("points")
    ax.grid(axis="y", color="#e6e5e0"); ax.set_axisbelow(True)
    for s in ("top", "right"): ax.spines[s].set_visible(False)
    ax.legend(frameon=False, loc="upper left", bbox_to_anchor=(0, 0.97))
    fig.tight_layout()
    fichier = re.sub(r"[^\w\-]+", "_", b["nom"]).strip("_") + ".png"
    fig.savefig(os.path.join(out, fichier)); plt.close(fig)
    print(fichier)
