from PIL import Image, ImageDraw
import numpy as np
import argparse
import json
import sys
from pathlib import Path

# python3 testv3.py box_100.jpg --output output_test
# ============================================================
# CONFIG GLOBALE 
# ============================================================


# Largeur de la bande de scan verticale

PROBE_WIDTH = 6

# Nombre minimal de pixels matchant par ligne dans la bande

MIN_MATCHING_PIXELS_PER_ROW = 1

# Rebouchage des petits trous dans le masque vertical

MAX_HOLE_SIZE = 5

# Longueur minimale d'un run, relative à la largeur

MIN_RUN_LENGTH_RATIO = 0.05

# Header / footer : 30% de la largeur de l'image redimensionnée

HEADER_RATIO = 0.26
FOOTER_RATIO = 0.30

# Couleur cible EXACTE de l'encadrement gris

TARGET_GRAY_RGB = np.array([31, 31, 31], dtype=np.uint8)   # #1f1f1f

# Tolérance couleur
# 0 = match exact uniquement

COLOR_TOLERANCE = 10.95

# Zones finales de crop des deux colonnes

LEFT_CELL_X = (0.04, 0.4825)
RIGHT_CELL_X = (0.515, 0.955)

# Colonnes vecteurs de pixels : largeur = 1 pixel
# Tu règles ici la position X de la colonne de scan
LEFT_VECTOR_X_RATIO = 0.257
RIGHT_VECTOR_X_RATIO = 0.73
 
# Longueur minimale d'un run pour être gardé
# Laisse à 1 si tu veux du brut sans filtrage
MIN_RUN_LENGTH = 50
 
 
# ============================================================
# UTILITAIRES
# ============================================================
 
def clamp(v, lo, hi):
    return max(lo, min(hi, v))
 

def load_image(image_path: str):
    img = Image.open(image_path).convert("RGB")
    rgb = np.array(img)
    return img, rgb


def compute_layout_bounds(width: int, height: int):
    header_y = int(round(width * HEADER_RATIO))
    footer_guard = int(round(width * FOOTER_RATIO))
    scan_bottom = height - footer_guard
 
    if scan_bottom <= header_y:
        raise ValueError(
            f"Zone de scan invalide : header_y={header_y}, scan_bottom={scan_bottom}"
        )
 
    return header_y, scan_bottom, footer_guard


def fill_small_gaps(mask: np.ndarray, max_hole_size: int) -> np.ndarray:

    mask = mask.copy()

    n = len(mask)

    i = 0

 

    while i < n:

        if mask[i]:

            i += 1

            continue

 

        j = i

        while j < n and not mask[j]:

            j += 1

 

        gap_size = j - i

        left_ok = i > 0 and mask[i - 1]

        right_ok = j < n and mask[j]

 

        if left_ok and right_ok and gap_size <= max_hole_size:

            mask[i:j] = True

 

        i = j

 

    return mask


def color_match_mask(column_rgb: np.ndarray) -> np.ndarray:

    """

    column_rgb:

      - shape (N, 3) si largeur 1

      - shape (N, W, 3) si largeur > 1

 

    Retourne un masque booléen 1D sur l'axe Y.

    """

    if column_rgb.ndim == 2:

        diff = np.abs(column_rgb.astype(int) - TARGET_GRAY_RGB.astype(int))

        return np.all(diff <= COLOR_TOLERANCE, axis=1)

 

    diff = np.abs(column_rgb.astype(int) - TARGET_GRAY_RGB.astype(int))

    per_pixel_match = np.all(diff <= COLOR_TOLERANCE, axis=2)  # (N, W)

    row_match = per_pixel_match.sum(axis=1) >= MIN_MATCHING_PIXELS_PER_ROW

    return row_match
 
def extract_runs_from_mask(mask: np.ndarray, y_offset: int, min_run_length: int = 1):
    """
    Convertit un masque booléen 1D en liste de runs continus.
    """
    runs = []
    in_run = False
    start = 0
 
    for i, matched in enumerate(mask):
        if matched and not in_run:
            start = i
            in_run = True
        elif not matched and in_run:
            end = i - 1
            length = end - start + 1
            if length >= min_run_length:
                runs.append({
                    "start": int(y_offset + start),
                    "end": int(y_offset + end),
                    "length": int(length),
                })
            in_run = False
 
    if in_run:
        end = len(mask) - 1
        length = end - start + 1
        if length >= min_run_length:
            runs.append({
                "start": int(y_offset + start),
                "end": int(y_offset + end),
                "length": int(length),
            })
 
    return runs
 
 
def scan_vertical_band(rgb_arr: np.ndarray, x_center: int, y0: int, y1: int, width_ref: int):

    """

    Scanne une bande verticale de largeur PROBE_WIDTH centrée sur x_center.

    """

    h, w, _ = rgb_arr.shape

    y0 = clamp(y0, 0, h - 1)

    y1 = clamp(y1, y0 + 1, h)

 

    half = PROBE_WIDTH // 2

    x0 = clamp(x_center - half, 0, w - 1)

    x1 = clamp(x_center + half + 1, x0 + 1, w)

 

    band = rgb_arr[y0:y1, x0:x1, :]   # shape (N, band_width, 3)

 

    mask = color_match_mask(band)

    mask = fill_small_gaps(mask, MAX_HOLE_SIZE)

 

    min_run_length = max(1, int(round(width_ref * MIN_RUN_LENGTH_RATIO)))

    runs = extract_runs_from_mask(mask, y_offset=y0, min_run_length=min_run_length)

 

    return runs, mask
 
def ratios_to_pixels(width: int):
    left_x0 = int(round(width * LEFT_CELL_X[0]))
    left_x1 = int(round(width * LEFT_CELL_X[1]))
    right_x0 = int(round(width * RIGHT_CELL_X[0]))
    right_x1 = int(round(width * RIGHT_CELL_X[1]))
 
    left_probe_x = int(round(width * LEFT_VECTOR_X_RATIO))
    right_probe_x = int(round(width * RIGHT_VECTOR_X_RATIO))
 
    return {
        "left_cell": [left_x0, left_x1],
        "right_cell": [right_x0, right_x1],
        "left_probe_x": left_probe_x,
        "right_probe_x": right_probe_x,
    }
 
 
# ============================================================
# SEGMENTATION
# ============================================================
 
def build_cells_from_runs(runs, x0: int, x1: int, side: str):
    """
    Chaque run vertical correspond à une box.
    """
    cells = []
 
    for idx, run in enumerate(runs, start=1):
        y0 = run["start"]
        y1 = run["end"] + 1  # PIL crop: borne basse exclusive
 
        cells.append({
            "index": idx,
            "column": side,
            "run_start": run["start"],
            "run_end": run["end"],
            "run_length": run["length"],
            "bbox": [x0, y0, x1, y1],
        })
 
    return cells
 
 
def analyze_image(image_path: str):
    img, rgb = load_image(image_path)
    height, width, _ = rgb.shape
 
    header_y, scan_bottom, footer_guard = compute_layout_bounds(width, height)
    px = ratios_to_pixels(width)
 
    left_runs, left_mask = scan_vertical_band(
        rgb_arr=rgb,
        x_center=px["left_probe_x"],
        y0=header_y,
        y1=scan_bottom,
        width_ref=width,
    )

    right_runs, right_mask = scan_vertical_band(
        rgb_arr=rgb,
        x_center=px["right_probe_x"],
        y0=header_y,
        y1=scan_bottom,
        width_ref=width,
    )
 
    left_cells = build_cells_from_runs(
        runs=left_runs,
        x0=px["left_cell"][0],
        x1=px["left_cell"][1],
        side="left",
    )
 
    right_cells = build_cells_from_runs(
        runs=right_runs,
        x0=px["right_cell"][0],
        x1=px["right_cell"][1],
        side="right",
    )
 
    return {
        "img": img,
        "rgb": rgb,
        "width": width,
        "height": height,
        "header_y": header_y,
        "scan_bottom": scan_bottom,
        "footer_guard": footer_guard,
        "left_probe_x": px["left_probe_x"],
        "right_probe_x": px["right_probe_x"],
        "left_cell_x": px["left_cell"],
        "right_cell_x": px["right_cell"],
        "left_runs": left_runs,
        "right_runs": right_runs,
        "left_cells": left_cells,
        "right_cells": right_cells,
        "left_mask_length": int(len(left_mask)),
        "right_mask_length": int(len(right_mask)),
    }
 
 
# ============================================================
# SAUVEGARDE
# ============================================================
 
def save_crops(img: Image.Image, cells, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    saved = []
 
    for cell in cells:
        x0, y0, x1, y1 = cell["bbox"]
        crop = img.crop((x0, y0, x1, y1))
 
        filename = f"{cell['column']}_box_{cell['index']:03d}.webp"
        crop.save(out_dir / filename)
 
        item = dict(cell)
        item["file"] = filename
        saved.append(item)
 
    return saved
 
 
def build_debug_overlay(img: Image.Image, analysis: dict) -> Image.Image:
    debug = img.copy()
    draw = ImageDraw.Draw(debug)
 
    w = analysis["width"]
    h = analysis["height"]
 
    header_y = analysis["header_y"]
    scan_bottom = analysis["scan_bottom"]
 
    left_probe_x = analysis["left_probe_x"]
    right_probe_x = analysis["right_probe_x"]
 
    left_x0, left_x1 = analysis["left_cell_x"]
    right_x0, right_x1 = analysis["right_cell_x"]
 
    # Header / bas de scan
    draw.line([(0, header_y), (w - 1, header_y)], fill=(255, 255, 0), width=2)
    draw.line([(0, scan_bottom), (w - 1, scan_bottom)], fill=(255, 128, 0), width=2)
 
    # Colonnes de scan
    draw.line([(left_probe_x, header_y), (left_probe_x, scan_bottom)], fill=(0, 255, 255), width=2)
    draw.line([(right_probe_x, header_y), (right_probe_x, scan_bottom)], fill=(0, 255, 255), width=2)
 
    # Runs gauche
    for run in analysis["left_runs"]:
        y0 = run["start"]
        y1 = run["end"]
        draw.line([(left_probe_x, y0), (left_probe_x, y1)], fill=(255, 0, 255), width=3)
        draw.rectangle([left_x0, y0, left_x1, y1 + 1], outline=(0, 255, 0), width=3)
 
    # Runs droite
    for run in analysis["right_runs"]:
        y0 = run["start"]
        y1 = run["end"]
        draw.line([(right_probe_x, y0), (right_probe_x, y1)], fill=(255, 0, 255), width=3)
        draw.rectangle([right_x0, y0, right_x1, y1 + 1], outline=(255, 0, 0), width=3)
 
    return debug
 
 
def save_results(image_path: str, output_root: str = "output_gray_runs"):
    analysis = analyze_image(image_path)
    img = analysis["img"]

    image_name = Path(image_path).stem
    out_dir = Path(output_root) / image_name
    crops_dir = out_dir / "crops"          # <- au lieu de left_dir / right_dir

    out_dir.mkdir(parents=True, exist_ok=True)

    left_saved = save_crops(img, analysis["left_cells"], crops_dir)
    right_saved = save_crops(img, analysis["right_cells"], crops_dir)
 
    debug_img = build_debug_overlay(img, analysis)
    debug_img.save(out_dir / "debug_overlay.webp")
 
    # Fichiers texte simples
    with open(out_dir / "left_runs.json", "w", encoding="utf-8") as f:
        json.dump(analysis["left_runs"], f, ensure_ascii=False, indent=2)
 
    with open(out_dir / "right_runs.json", "w", encoding="utf-8") as f:
        json.dump(analysis["right_runs"], f, ensure_ascii=False, indent=2)
 
    data = {
        "source_image": str(image_path),
        "image_size": {
            "width": analysis["width"],
            "height": analysis["height"],
        },
        "config": {
            "HEADER_RATIO": HEADER_RATIO,
            "FOOTER_RATIO": FOOTER_RATIO,
            "TARGET_GRAY_RGB": TARGET_GRAY_RGB.tolist(),
            "COLOR_TOLERANCE": COLOR_TOLERANCE,
            "LEFT_CELL_X": LEFT_CELL_X,
            "RIGHT_CELL_X": RIGHT_CELL_X,
            "LEFT_VECTOR_X_RATIO": LEFT_VECTOR_X_RATIO,
            "RIGHT_VECTOR_X_RATIO": RIGHT_VECTOR_X_RATIO,
            "MIN_RUN_LENGTH": MIN_RUN_LENGTH,
        },
        "computed": {
            "header_y": analysis["header_y"],
            "scan_bottom": analysis["scan_bottom"],
            "footer_guard": analysis["footer_guard"],
            "left_probe_x": analysis["left_probe_x"],
            "right_probe_x": analysis["right_probe_x"],
            "left_cell_x": analysis["left_cell_x"],
            "right_cell_x": analysis["right_cell_x"],
        },
        "left_runs": analysis["left_runs"],
        "right_runs": analysis["right_runs"],
        "left_count": len(analysis["left_runs"]),
        "right_count": len(analysis["right_runs"]),
        "left_crops": left_saved,
        "right_crops": right_saved,
    }
 
    with open(out_dir / "segmentation.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
 
    return out_dir, data
 
 
# ============================================================
# MAIN
# ============================================================
 
def main():
    parser = argparse.ArgumentParser(
        description="Segmentation déterministe par runs verticaux exacts de gris #1f1f1f"
    )
    parser.add_argument("image_path", help="Chemin vers l'image à traiter")
    parser.add_argument("--output", default="output_gray_runs", help="Dossier de sortie")
    args = parser.parse_args()
 
    try:
        out_dir, data = save_results(args.image_path, args.output)
        print(f"Sortie : {out_dir}")
        print(f"Gauche : {data['left_count']} runs détectés")
        print(f"Droite : {data['right_count']} runs détectés")
        print(f"left_runs  : {data['left_runs']}")
        print(f"right_runs : {data['right_runs']}")
    except Exception as e:
        print(f"Erreur : {e}")
        sys.exit(1)
 
 
if __name__ == "__main__":
    main()