"""
Pipeline complet : capture d'écran de roster -> JSON prêt à fusionner dans le profil.

1. box_character_finder : détecte la grille, extrait chaque case en crop.
2. image_splitter : découpe chaque case en zone constellation + zone nom/niveau.
3. CNN : prédit la constellation (0-6).
4. OCR (normal + inversé, on garde la variante la plus confiante) : lit nom + niveau.
5. Fuzzy matching : associe le nom OCR au personnage le plus proche de characters.json.
6. Construction du JSON final, avec drapeaux "à vérifier" par entrée + avertissements globaux.
"""

import argparse
import json
import sys
import tempfile
from pathlib import Path

from PIL import Image

import auto_box_config as cfg
import level_parsing as lvl
from cnn_inference import ConstellationPredictor
from name_matching import CharacterMatcher

sys.path.insert(0, str(cfg.BOX_CALCS_DIR))   # <- au lieu de cfg.CNN_PROJECT_DIR

import box_character_finder as bcf   # noqa: E402
import image_splitter as isp          # noqa: E402
import text_decoder as ocr_mod         # noqa: E402

def _best_ocr_variant(image_path: Path) -> list[dict]:
    """Lance l'OCR normal + inversé, garde la variante avec la meilleure confiance totale."""
    raw = Image.open(image_path).convert("RGB")
    normal_bw = ocr_mod.apply_threshold(raw, cfg.OCR_LUMINOSITY_THRESHOLD)
    inverted_bw = ocr_mod.invert_bw(normal_bw)

    normal_words = ocr_mod.extract_words(normal_bw)
    inverted_words = ocr_mod.extract_words(inverted_bw)

    def total_conf(words):
        return sum(w["conf"] for w in words)

    return normal_words if total_conf(normal_words) >= total_conf(inverted_words) else inverted_words


def _analyze_one_cell(cell_image_path: Path, split_dir: Path, predictor: ConstellationPredictor):
    img = Image.open(cell_image_path).convert("RGB")
    parts, _ = isp.split_box(img)

    constellation_path = split_dir / f"{cell_image_path.stem}_left_top_right.webp"
    name_level_path = split_dir / f"{cell_image_path.stem}_right_top.webp"

    parts["left_top_right"].save(constellation_path)
    parts["right_top"].save(name_level_path)

    constellation, cnn_confidence = predictor.predict(constellation_path)

    ocr_words = _best_ocr_variant(name_level_path)
    level = lvl.parse_level(ocr_words)
    name_text = lvl.extract_name_tokens(ocr_words)

    return constellation, cnn_confidence, level, name_text


def run_pipeline(image_path: str, work_dir: str | None = None) -> dict:
    matcher = CharacterMatcher()
    predictor = ConstellationPredictor()

    work_dir = Path(work_dir) if work_dir else Path(tempfile.mkdtemp(prefix="auto_box_"))
    split_dir = work_dir / "split"
    split_dir.mkdir(parents=True, exist_ok=True)

    out_dir, box_data = bcf.save_results(image_path, output_root=str(work_dir / "boxes"))
    crops_dir = out_dir / "crops"

    all_cells = box_data["left_crops"] + box_data["right_crops"]

    entries = []
    review_needed = []

    for cell in all_cells:
        cell_image_path = crops_dir / cell["file"]

        try:
            constellation, cnn_conf, level, name_text = _analyze_one_cell(
                cell_image_path, split_dir, predictor
            )
        except Exception as e:
            entry = {
                "source_crop": cell["file"],
                "grid_column": cell["column"],
                "grid_index": cell["index"],
                "character_id": None,
                "review_needed": True,
                "review_reasons": [f"erreur de traitement : {e}"],
            }
            entries.append(entry)
            review_needed.append(entry)
            continue

        character, name_score, name_needs_review = matcher.match(name_text)
        character_id = character["id"] if character else None

        reasons = []
        if character is None:
            reasons.append("nom non reconnu (aucune correspondance suffisante)")
        elif name_needs_review:
            reasons.append(
                f"nom retrouvé par correspondance approchée "
                f"('{name_text}' -> '{character['nom']}', score {name_score:.0f})"
            )

        if cnn_conf < cfg.CNN_CONFIDENCE_THRESHOLD:
            reasons.append(f"confiance basse sur la constellation ({cnn_conf:.0%})")

        if lvl.is_rare_level(level):
            reasons.append(f"niveau {level} : condition rare, pertinent pour l'équilibrage PvP")

        if character_id and character_id in cfg.KNOWN_ISSUES:
            reasons.append(cfg.KNOWN_ISSUES[character_id])

        entry = {
            "source_crop": cell["file"],
            "grid_column": cell["column"],
            "grid_index": cell["index"],
            "character_id": character_id,
            "character_name_detected": name_text,
            "character_name_matched": character["nom"] if character else None,
            "name_match_score": round(name_score, 1),
            "constellation": constellation,
            "constellation_confidence": round(cnn_conf, 3),
            "level": level,
            "review_needed": bool(reasons),
            "review_reasons": reasons,
        }

        entries.append(entry)
        if entry["review_needed"]:
            review_needed.append(entry)

    detected_ids = {e["character_id"] for e in entries if e.get("character_id")}
    missing_known_issues = {
        char_id: msg for char_id, msg in cfg.KNOWN_ISSUES.items() if char_id not in detected_ids
    }

    return {
        "source_image": str(image_path),
        "work_dir": str(work_dir),
        "characters_full": {
            e["character_id"]: e["constellation"] for e in entries if e.get("character_id")
        },
        "characters_levels": {
            e["character_id"]: e["level"]
            for e in entries if e.get("character_id") and e.get("level") is not None
        },
        "entries": entries,
        "review_needed_count": len(review_needed),
        "known_issues_not_detected": missing_known_issues,
        "global_warning": (
            "Résultat automatique (bêta) : vérifie manuellement chaque entrée signalée "
            "avant d'enregistrer, en particulier les personnages listés dans "
            "'known_issues_not_detected', à ajouter à la main."
        ),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Capture d'écran de roster -> JSON prêt à fusionner dans le profil."
    )
    parser.add_argument("image_path", help="Chemin vers la capture d'écran du roster")
    parser.add_argument("--output", default="auto_box_result.json", help="Fichier JSON de sortie")
    parser.add_argument("--work-dir", default=None, help="Dossier de travail (crops intermédiaires)")
    args = parser.parse_args()

    try:
        result = run_pipeline(args.image_path, work_dir=args.work_dir)
    except Exception as e:
        print(f"Erreur : {e}")
        sys.exit(1)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"{len(result['entries'])} cases analysées.")
    print(f"À vérifier manuellement : {result['review_needed_count']}")
    if result["known_issues_not_detected"]:
        print("Personnages connus à ajouter à la main :")
        for char_id, msg in result["known_issues_not_detected"].items():
            print(f"  - {char_id} : {msg}")
    print(f"Dossier de travail (crops intermédiaires) : {result['work_dir']}")
    print(f"Résultat : {args.output}")


if __name__ == "__main__":
    main()