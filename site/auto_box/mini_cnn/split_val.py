import argparse
import random
import shutil
import sys
from pathlib import Path

# ============================================================
# CONFIG GLOBALE
# ============================================================

TRAIN_DIR = Path("dataset/train")
VAL_DIR = Path("dataset/val")

VAL_RATIO = 0.20
SEED = 42

IMAGE_EXTENSIONS = {".webp", ".png", ".jpg", ".jpeg"}


# ============================================================
# SPLIT
# ============================================================

def list_images(folder: Path):
    return sorted(
        f for f in folder.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
    )


def split_class(class_dir: Path, val_dir: Path, ratio: float, rng: random.Random):
    files = list_images(class_dir)
    if not files:
        return 0, 0

    n_val = round(len(files) * ratio)
    # Sécurité : si la classe a au moins 2 images, on en garde au moins 1 en val
    # (sinon une petite classe à 3-4 images pourrait se retrouver avec 0 en val)
    if len(files) >= 2 and n_val == 0:
        n_val = 1

    val_files = rng.sample(files, n_val)

    val_class_dir = val_dir / class_dir.name
    val_class_dir.mkdir(parents=True, exist_ok=True)

    for f in val_files:
        shutil.move(str(f), str(val_class_dir / f.name))

    return len(files), len(val_files)


def split_all_classes(train_dir: Path, val_dir: Path, ratio: float, seed: int):
    rng = random.Random(seed)

    class_dirs = sorted(d for d in train_dir.iterdir() if d.is_dir())
    if not class_dirs:
        raise ValueError(f"Aucun sous-dossier de classe trouvé dans {train_dir}")

    results = {}
    for class_dir in class_dirs:
        total, moved = split_class(class_dir, val_dir, ratio, rng)
        results[class_dir.name] = (total, moved)

    return results


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Déplace un pourcentage aléatoire de chaque classe de train vers val"
    )
    parser.add_argument("--train-dir", default=str(TRAIN_DIR), help=f"Dossier train (défaut: {TRAIN_DIR})")
    parser.add_argument("--val-dir", default=str(VAL_DIR), help=f"Dossier val (défaut: {VAL_DIR})")
    parser.add_argument("--ratio", type=float, default=VAL_RATIO, help=f"Fraction à mettre en val (défaut: {VAL_RATIO})")
    parser.add_argument("--seed", type=int, default=SEED, help=f"Seed aléatoire, pour reproductibilité (défaut: {SEED})")
    args = parser.parse_args()

    train_dir = Path(args.train_dir)
    val_dir = Path(args.val_dir)

    if not train_dir.is_dir():
        print(f"Erreur : {train_dir} n'est pas un dossier")
        sys.exit(1)

    try:
        results = split_all_classes(train_dir, val_dir, args.ratio, args.seed)
    except Exception as e:
        print(f"Erreur : {e}")
        sys.exit(1)

    print(f"Split {args.ratio:.0%} -> {val_dir} (seed={args.seed})\n")
    total_all, moved_all = 0, 0
    for class_name, (total, moved) in results.items():
        print(f"  classe {class_name:>2} : {total:>4} images -> {moved:>3} déplacées en val ({total - moved} restent en train)")
        total_all += total
        moved_all += moved

    print(f"\nTotal : {total_all} images, {moved_all} déplacées en val, {total_all - moved_all} restées en train")


if __name__ == "__main__":
    main()