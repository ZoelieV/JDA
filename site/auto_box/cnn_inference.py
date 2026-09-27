import sys
from pathlib import Path

import torch
from PIL import Image

import auto_box_config as cfg

sys.path.insert(0, str(cfg.CNN_PROJECT_DIR))

from model import TinyDigitCNN          # noqa: E402
from dataset import build_transforms    # noqa: E402


class ConstellationPredictor:
    def __init__(self, model_path: Path | None = None):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        if model_path is None:
            checkpoint_dir = cfg.CNN_PROJECT_DIR / "checkpoints"
            final_path = checkpoint_dir / "final_model.pt"
            best_path = checkpoint_dir / "best_model.pt"
            model_path = final_path if final_path.exists() else best_path

        if not model_path.exists():
            raise FileNotFoundError(
                f"Aucun modèle trouvé dans {model_path}. "
                f"Lance train.py ou train_final.py dans mini_cnn/ d'abord."
            )

        checkpoint = torch.load(model_path, map_location=self.device)
        self.classes = checkpoint["classes"]

        self.model = TinyDigitCNN(num_classes=len(self.classes)).to(self.device)
        self.model.load_state_dict(checkpoint["model_state"])
        self.model.eval()

        self.transform = build_transforms(train=False)

    def predict(self, image_path: Path) -> tuple[int, float]:
        image = Image.open(image_path).convert("RGB")
        tensor = self.transform(image).unsqueeze(0).to(self.device)

        with torch.no_grad():
            probs = torch.softmax(self.model(tensor), dim=1)[0]

        pred_idx = int(probs.argmax().item())
        confidence = float(probs[pred_idx].item())
        constellation = int(self.classes[pred_idx])

        return constellation, confidence