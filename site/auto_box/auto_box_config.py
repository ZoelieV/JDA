from pathlib import Path

# Chemins calculés depuis l'emplacement de ce fichier, pas depuis le
# dossier courant -> fonctionne que tu lances le script depuis la racine
# ou depuis auto_box/.
AUTO_BOX_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = AUTO_BOX_DIR.parent

CNN_PROJECT_DIR = AUTO_BOX_DIR / "mini_cnn"
BOX_CALCS_DIR = AUTO_BOX_DIR / "box_max_calcs"
CHARACTERS_JSON_PATH = PROJECT_ROOT / "DB" / "characters.json"

# ============================================================
# OCR
# ============================================================

OCR_LUMINOSITY_THRESHOLD = 100

# ============================================================
# SEUILS DE CONFIANCE
# ============================================================

CNN_CONFIDENCE_THRESHOLD = 0.60
NAME_MATCH_MIN_SCORE = 55
NAME_MATCH_EXACT_SCORE = 95

# ============================================================
# NIVEAUX RARES
# ============================================================

RARE_LEVELS = {95, 100}

# ============================================================
# PROBLEMES CONNUS
# ============================================================

KNOWN_ISSUES = {
    "kokomi": "Sangonomiya Kokomi est mal détectée par le pipeline actuel : vérifie-la manuellement.",
}