import argparse
import json
import sys
from pathlib import Path

import pytesseract
from PIL import Image, ImageOps

# ============================================================
# CONFIG GLOBALE
# ============================================================

# Dossier contenant les images à passer en OCR (celui généré par le script de split)
INPUT_DIR = "crops_split"

# Fichier JSON de sortie
OUTPUT_JSON = "ocr_results.json"

IMAGE_EXTENSIONS = {".webp", ".png", ".jpg", ".jpeg"}

# Seuil de luminosité (0-255). Un pixel devient BLANC si sa luminosité
# atteint ce seuil (>=), NOIR sinon. Baisse-le si trop de texte disparaît
# en noir, monte-le si trop de bruit de fond passe en blanc.
LUMINOSITY_THRESHOLD = 100

# Confiance minimale pour garder un mot (0 = tout garder sauf les -1 de Tesseract)
MIN_CONFIDENCE = 0

# Config Tesseract additionnelle (ex: "--psm 7" pour une ligne de texte isolée)
TESSERACT_CONFIG = ""

# Dossier de sortie du mode debug (images binarisées, avant OCR)
DEBUG_OUTPUT_DIR = "output_debug"


# ============================================================
# PRE-TRAITEMENT
# ============================================================

def apply_threshold(image: Image.Image, threshold: int) -> Image.Image:
    """
    Convertit en niveaux de gris puis binarise :
    pixel blanc (255) si luminosité >= threshold, noir (0) sinon.
    """
    gray = image.convert("L")
    return gray.point(lambda p: 255 if p >= threshold else 0)


def invert_bw(image: Image.Image) -> Image.Image:
    """Inverse une image déjà binarisée (mode 'L') : blanc <-> noir."""
    return ImageOps.invert(image)


# ============================================================
# OCR
# ============================================================

def extract_words(image: Image.Image, config: str = TESSERACT_CONFIG):
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT, config=config)

    words = []
    for i in range(len(data["text"])):
        word = data["text"][i].strip()
        conf = int(data["conf"][i])

        if word and conf > MIN_CONFIDENCE:
            words.append({
                "text": word,
                "conf": conf,
                "left": data["left"][i],
                "top": data["top"][i],
                "width": data["width"][i],
                "height": data["height"][i],
            })

    return words


def process_file(path: Path, threshold: int, debug_dirs: dict | None = None):
    image = Image.open(path).convert("RGB")

    normal_bw = apply_threshold(image, threshold)
    inverted_bw = invert_bw(normal_bw)

    if debug_dirs:
        debug_name = f"{path.stem}.png"  # PNG en debug : pas de compression avec perte sur du binaire
        normal_bw.save(debug_dirs["normal"] / debug_name)
        inverted_bw.save(debug_dirs["inverted"] / debug_name)

    normal_words = extract_words(normal_bw)
    inverted_words = extract_words(inverted_bw)

    return {"normal": normal_words, "inverted": inverted_words}


def process_directory(input_dir: Path, threshold: int, debug: bool = False, debug_output: str = DEBUG_OUTPUT_DIR):
    files = sorted(
        f for f in input_dir.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
    )

    if not files:
        raise ValueError(f"Aucune image trouvée dans {input_dir}")

    debug_dirs = None
    if debug:
        debug_root = Path(debug_output)
        debug_dirs = {
            "normal": debug_root / "normal",
            "inverted": debug_root / "inverted",
        }
        for d in debug_dirs.values():
            d.mkdir(parents=True, exist_ok=True)

    results = {}
    for f in files:
        results[f.name] = process_file(f, threshold, debug_dirs)

    return results


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="OCR (Tesseract) sur des images binarisées par seuil de luminosité, en normal et inversé"
    )
    parser.add_argument(
        "input_dir", nargs="?", default=INPUT_DIR,
        help=f"Dossier contenant les images à traiter (défaut: {INPUT_DIR})",
    )
    parser.add_argument("--output", default=OUTPUT_JSON, help="Fichier JSON de sortie")
    parser.add_argument(
        "--threshold", type=int, default=LUMINOSITY_THRESHOLD,
        help=f"Seuil de luminosité 0-255 (défaut: {LUMINOSITY_THRESHOLD})",
    )
    parser.add_argument("--debug", action="store_true", help="Sauvegarde les images binarisées (normal/inverted)")
    parser.add_argument("--debug-output", default=DEBUG_OUTPUT_DIR, help="Dossier de sortie du mode debug")
    args = parser.parse_args()

    try:
        results = process_directory(
            Path(args.input_dir),
            threshold=args.threshold,
            debug=args.debug,
            debug_output=args.debug_output,
        )
    except Exception as e:
        print(f"Erreur : {e}")
        sys.exit(1)

    with open(args.output, "w", encoding="utf-8") as fp:
        json.dump(results, fp, ensure_ascii=False, indent=2)

    total_normal = sum(len(r["normal"]) for r in results.values())
    total_inverted = sum(len(r["inverted"]) for r in results.values())

    print(f"{len(results)} images traitées (seuil={args.threshold})")
    print(f"Mots détectés (normal)   : {total_normal}")
    print(f"Mots détectés (inversé)  : {total_inverted}")
    print(f"Résultats : {args.output}")
    if args.debug:
        print(f"Images debug : {args.debug_output}/normal et {args.debug_output}/inverted")


if __name__ == "__main__":
    main()