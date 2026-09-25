from pathlib import Path

# ============================================================
# CHEMINS
# ============================================================
TRAIN_DIR = Path("dataset/train")
VAL_DIR = Path("dataset/val")
CHECKPOINT_DIR = Path("checkpoints")
CHECKPOINT_DIR.mkdir(exist_ok=True)
BEST_MODEL_PATH = CHECKPOINT_DIR / "best_model.pt"
HISTORY_PATH = CHECKPOINT_DIR / "history.json"

# ============================================================
# IMAGES
# ============================================================
IMAGE_SIZE = (32, 40)  # (largeur, hauteur) -- ratio 4:5, proche de tes crops
NUM_CLASSES = 7        # constellations 0 à 6

# ============================================================
# AUGMENTATION (dataset minuscule -> nécessaire pour limiter l'overfit)
# ============================================================
AUG_ROTATION_DEGREES = 8
AUG_TRANSLATE_FRACTION = 0.08
AUG_BRIGHTNESS_JITTER = 0.25
AUG_CONTRAST_JITTER = 0.25

# ============================================================
# MODELE
# ============================================================
CONV_CHANNELS = (8, 16, 32)  # nb de filtres par bloc conv, du + petit au + gros
DROPOUT = 0.4

# ============================================================
# ENTRAINEMENT -- ce sont les valeurs à bouger en premier
# ============================================================
BATCH_SIZE = 16
LEARNING_RATE = 1e-3
WEIGHT_DECAY = 1e-4
EPOCHS = 120
SEED = 42
USE_CLASS_WEIGHTS = True
# ============================================================
# GRAD CAM
# ============================================================
GRADCAM_OUTPUT_DIR = Path("gradcam_output")
GRADCAM_TARGET_LAYER_INDEX = 10  # dernier ReLU avant AdaptiveAvgPool2d

# ============================================================
# FINAL TRAINING
# ============================================================
FINAL_MAX_EPOCHS = 150     # plafond de sécurité, l'early stopping arrêtera probablement avant
FINAL_PATIENCE = 15        # arrêt si la train loss ne s'améliore plus depuis N epochs
FINAL_MIN_DELTA = 1e-4     # amélioration minimale pour compter comme un progrès
FINAL_MODEL_PATH = CHECKPOINT_DIR / "final_model.pt"
FINAL_HISTORY_PATH = CHECKPOINT_DIR / "final_history.json"