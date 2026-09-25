import json
import unicodedata
from pathlib import Path

from rapidfuzz import fuzz, process

import auto_box_config as cfg


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return text.lower().strip()


class CharacterMatcher:
    def __init__(self, characters_json_path: Path | None = None):
        path = characters_json_path or cfg.CHARACTERS_JSON_PATH
        with open(path, "r", encoding="utf-8") as f:
            self.characters = json.load(f)

        self._choices = {_normalize(c["nom"]): c for c in self.characters}

    def match(self, ocr_name: str):
        """
        Retourne (personnage | None, score 0-100, needs_review: bool).
        None si aucune correspondance suffisamment proche n'existe.
        """
        query = _normalize(ocr_name)
        if not query:
            return None, 0.0, True

        result = process.extractOne(query, self._choices.keys(), scorer=fuzz.token_sort_ratio)
        if result is None:
            return None, 0.0, True

        matched_key, score, _ = result

        if score < cfg.NAME_MATCH_MIN_SCORE:
            return None, score, True

        character = self._choices[matched_key]
        needs_review = score < cfg.NAME_MATCH_EXACT_SCORE

        return character, score, needs_review