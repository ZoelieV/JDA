"""Exporte le CNN des constellations pour la détection dans le navigateur.

Lit mini_cnn/checkpoints/final_model.pt (ou best_model.pt) SANS torch : un
.pt est une archive zip contenant un pickle + les tenseurs bruts. Les
BatchNorm sont fusionnées dans les convolutions (inférence uniquement), et
le résultat est écrit dans site/my_account/auto_box/modele_constellations.json,
lu par my_account/auto_box/detection.js.

À relancer après chaque réentraînement du modèle :
    python auto_box/exporter_modele_web.py
"""

import json
import pickle
import zipfile
from pathlib import Path

import numpy as np

AUTO_BOX_DIR = Path(__file__).resolve().parent
CHECKPOINTS = AUTO_BOX_DIR / "mini_cnn" / "checkpoints"
SORTIE = AUTO_BOX_DIR.parent / "my_account" / "auto_box" / "modele_constellations.json"

BN_EPS = 1e-5
DTYPES = {
    "FloatStorage": np.float32,
    "LongStorage": np.int64,
    "IntStorage": np.int32,
}


def charger_checkpoint(chemin):
    archive = zipfile.ZipFile(chemin)
    prefixe = archive.namelist()[0].split("/")[0]

    class Stockage:
        def __init__(self, type_nom, cle):
            self.dtype = DTYPES[type_nom]
            self.donnees = np.frombuffer(archive.read(f"{prefixe}/data/{cle}"), dtype=self.dtype)

    def reconstruire_tenseur(stockage, decalage, forme, pas, *_):
        if not forme:
            return stockage.donnees[decalage]
        taille = stockage.dtype().itemsize
        return np.lib.stride_tricks.as_strided(
            stockage.donnees[decalage:], shape=forme, strides=[p * taille for p in pas]
        ).copy()

    class Depickler(pickle.Unpickler):
        def find_class(self, module, nom):
            if module == "torch._utils" and nom == "_rebuild_tensor_v2":
                return reconstruire_tenseur
            if module == "torch" and nom.endswith("Storage"):
                return nom
            if module == "collections" and nom == "OrderedDict":
                from collections import OrderedDict
                return OrderedDict
            return super().find_class(module, nom)

        def persistent_load(self, pid):
            # ('storage', type_stockage, cle, emplacement, nb_elements)
            return Stockage(pid[1], pid[2])

    return Depickler(archive.open(f"{prefixe}/data.pkl")).load()


def fusionner_bn(poids, biais, etat, prefixe_bn):
    gamma = etat[f"{prefixe_bn}.weight"]
    beta = etat[f"{prefixe_bn}.bias"]
    moyenne = etat[f"{prefixe_bn}.running_mean"]
    variance = etat[f"{prefixe_bn}.running_var"]
    echelle = gamma / np.sqrt(variance + BN_EPS)
    return poids * echelle[:, None, None, None], (biais - moyenne) * echelle + beta


def main():
    chemin = CHECKPOINTS / "final_model.pt"
    if not chemin.exists():
        chemin = CHECKPOINTS / "best_model.pt"
    checkpoint = charger_checkpoint(chemin)
    etat = checkpoint["model_state"]

    # features : Conv(0) BN(1) ReLU Pool | Conv(4) BN(5) ReLU Pool | Conv(8) BN(9) ReLU AvgPool
    couches = []
    for conv, bn in ((0, 1), (4, 5), (8, 9)):
        poids, biais = fusionner_bn(
            etat[f"features.{conv}.weight"], etat[f"features.{conv}.bias"], etat, f"features.{bn}"
        )
        couches.append({
            "forme": list(poids.shape),
            "poids": [round(float(x), 7) for x in poids.ravel()],
            "biais": [round(float(x), 7) for x in biais.ravel()],
        })

    lineaire = {
        "forme": list(etat["classifier.2.weight"].shape),
        "poids": [round(float(x), 7) for x in etat["classifier.2.weight"].ravel()],
        "biais": [round(float(x), 7) for x in etat["classifier.2.bias"].ravel()],
    }

    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(json.dumps({
        "source": chemin.name,
        "classes": [int(c) for c in checkpoint["classes"]],
        "taille_entree": {"largeur": 32, "hauteur": 40},
        "convolutions": couches,
        "lineaire": lineaire,
    }), encoding="utf-8")
    print(f"{SORTIE} ({SORTIE.stat().st_size // 1024} Ko) depuis {chemin.name}")


if __name__ == "__main__":
    main()
