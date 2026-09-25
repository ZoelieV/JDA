import re

import auto_box_config as cfg

LEVEL_PATTERN = re.compile(r"niv[.,]?\s*(\d{1,3})", re.IGNORECASE)


def parse_level(ocr_words: list[dict]) -> int | None:
    for word in ocr_words:
        match = LEVEL_PATTERN.search(word["text"])
        if match:
            return int(match.group(1))
    return None


def is_rare_level(level: int | None) -> bool:
    return level is not None and level in cfg.RARE_LEVELS


def extract_name_tokens(ocr_words: list[dict]) -> str:
    """Tous les mots qui ne matchent pas 'Niv.XX', concaténés (l'ordre n'a pas
    d'importance : le fuzzy matching côté name_matching.py est insensible à l'ordre)."""
    return " ".join(w["text"] for w in ocr_words if not LEVEL_PATTERN.search(w["text"]))