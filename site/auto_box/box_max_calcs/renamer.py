import argparse
import sys
import uuid
from pathlib import Path

# ============================================================
# CONFIG GLOBALE
# ============================================================

IMAGE_EXTENSIONS = {".webp", ".png", ".jpg", ".jpeg"}

# Valeur de départ du compteur si --start n'est pas fourni
DEFAULT_START = 1


# ============================================================
# RENOMMAGE
# ============================================================

def list_images(folder: Path):
    return sorted(
        f for f in folder.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
    )


def rename_sequentially(folder: Path, start: int):
    files = list_images(folder)

    if not files:
        raise ValueError(f"Aucune image trouvée dans {folder}")

    # Passe 1 : renommage vers des noms temporaires uniques
    # (évite d'écraser un fichier si les plages de numéros se chevauchent)
    temp_names = []
    for f in files:
        temp_path = folder / f".tmp_{uuid.uuid4().hex}{f.suffix}"
        f.rename(temp_path)
        temp_names.append(temp_path)

    # Passe 2 : renommage vers les noms finaux numérotés
    renamed = []
    for i, temp_path in enumerate(temp_names):
        final_name = f"{start + i}{temp_path.suffix}"
        final_path = folder / final_name
        temp_path.rename(final_path)
        renamed.append(final_path.name)

    return renamed


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Renomme toutes les images d'un dossier en 1.ext, 2.ext, ... (ou à partir de --start)"
    )
    parser.add_argument("path", help="Dossier contenant les images à renommer")
    parser.add_argument(
        "--start", type=int, default=DEFAULT_START,
        help=f"Numéro de départ du comptage (défaut: {DEFAULT_START})",
    )
    args = parser.parse_args()

    folder = Path(args.path)
    if not folder.is_dir():
        print(f"Erreur : {folder} n'est pas un dossier")
        sys.exit(1)

    try:
        renamed = rename_sequentially(folder, args.start)
    except Exception as e:
        print(f"Erreur : {e}")
        sys.exit(1)

    print(f"{len(renamed)} images renommées dans {folder} (de {args.start} à {args.start + len(renamed) - 1})")


if __name__ == "__main__":
    main()