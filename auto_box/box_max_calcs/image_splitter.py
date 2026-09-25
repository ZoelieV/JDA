from PIL import Image, ImageDraw
import argparse
import json
import sys
from pathlib import Path

# ============================================================
# CONFIG GLOBALE
# ============================================================

# Ratio horizontal de la coupure gauche/droite — à ajuster à l'oeil avec --debug
SPLIT_X_RATIO = 0.5

# Ratio vertical de la coupure haut/bas dans la moitié droite
SPLIT_Y_RATIO = 0.5

# Dans la moitié gauche : fraction de sa LARGEUR gardée, ancrée sur le bord droit
# (= la frontière avec la moitié droite, à split_x). 0.5 = moitié de la largeur gauche.
LEFT_QUARTER_WIDTH_RATIO = 0.20

# Dans la moitié gauche : fraction de sa HAUTEUR gardée, ancrée en haut.
# 0.5 = moitié supérieure. Les deux ratios à 0.5 = un vrai quart.
LEFT_QUARTER_HEIGHT_RATIO = 0.25

IMAGE_EXTENSIONS = {".webp", ".png", ".jpg", ".jpeg"}


# ============================================================
# DECOUPE
# ============================================================

def split_box(img: Image.Image):
    """
    Découpe une case en 3 parties :
      - left_top_right : quart haut-droit de la moitié gauche
      - right_top       : moitié droite, partie haute
      - right_bottom    : moitié droite, partie basse
    """
    w, h = img.size
    split_x = int(round(w * SPLIT_X_RATIO))
    split_y = int(round(h * SPLIT_Y_RATIO))

    # Quart haut-droit de la moitié gauche, ancré sur le coin (split_x, 0)
    left_quarter_w = int(round(split_x * LEFT_QUARTER_WIDTH_RATIO))
    left_quarter_h = int(round(h * LEFT_QUARTER_HEIGHT_RATIO))
    left_quarter_x0 = split_x - left_quarter_w

    parts = {
        "left_top_right": img.crop((left_quarter_x0, 0, split_x, left_quarter_h)),
        "right_top": img.crop((split_x, 0, w, split_y)),
    }

    debug_info = {
        "split_x": split_x,
        "split_y": split_y,
        "left_quarter_x0": left_quarter_x0,
        "left_quarter_h": left_quarter_h,
    }
    return parts, debug_info


def save_debug_preview(img: Image.Image, debug_info: dict, out_path: Path):
    debug = img.copy()
    draw = ImageDraw.Draw(debug)
    w, h = img.size

    split_x = debug_info["split_x"]
    split_y = debug_info["split_y"]
    left_quarter_x0 = debug_info["left_quarter_x0"]
    left_quarter_h = debug_info["left_quarter_h"]

    # Frontière gauche/droite et coupure haut/bas de la moitié droite
    draw.line([(split_x, 0), (split_x, h)], fill=(255, 0, 0), width=2)
    draw.line([(split_x, split_y), (w, split_y)], fill=(0, 255, 0), width=2)

    # Rectangle du quart gardé à gauche
    draw.rectangle(
        [left_quarter_x0, 0, split_x, left_quarter_h],
        outline=(0, 128, 255), width=3,
    )

    debug.save(out_path)


def process_directory(input_dir: Path, output_dir: Path, debug: bool = False):
    output_dir.mkdir(parents=True, exist_ok=True)
    debug_dir = output_dir / "debug"
    if debug:
        debug_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(
        f for f in input_dir.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
    )
    if not files:
        raise ValueError(f"Aucune image trouvée dans {input_dir}")

    manifest = []

    for f in files:
        img = Image.open(f).convert("RGB")
        parts, debug_info = split_box(img)

        stem = f.stem
        entry = {"source": f.name, "parts": {}}

        for part_name, part_img in parts.items():
            out_name = f"{stem}_{part_name}.webp"
            part_img.save(output_dir / out_name)
            entry["parts"][part_name] = out_name

        if debug:
            save_debug_preview(img, debug_info, debug_dir / f"{stem}_debug.webp")

        manifest.append(entry)

    return manifest


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Découpe chaque crop de case en 3 sous-images (quart haut-droit gauche / droite-haut / droite-bas)"
    )
    parser.add_argument("input_dir", help="Dossier contenant les crops (ex: output_gray_runs/<image>/crops)")
    parser.add_argument("--output", default="crops_split", help="Dossier de sortie")
    parser.add_argument("--debug", action="store_true", help="Sauvegarde aussi un aperçu avec les lignes/rectangle de coupe")
    args = parser.parse_args()

    try:
        manifest = process_directory(Path(args.input_dir), Path(args.output), debug=args.debug)
    except Exception as e:
        print(f"Erreur : {e}")
        sys.exit(1)

    with open(Path(args.output) / "manifest.json", "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, ensure_ascii=False, indent=2)

    print(f"{len(manifest)} images découpées dans {args.output}")
    print(f"Manifest : {Path(args.output) / 'manifest.json'}")


if __name__ == "__main__":
    main()