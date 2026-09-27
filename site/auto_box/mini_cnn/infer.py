import sys
import torch
from PIL import Image

import config
from dataset import build_transforms
from model import TinyDigitCNN


def predict(image_path: str):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    checkpoint = torch.load(config.BEST_MODEL_PATH, map_location=device)
    classes = checkpoint["classes"]

    model = TinyDigitCNN(num_classes=len(classes)).to(device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    image = Image.open(image_path).convert("RGB")
    tensor = build_transforms(train=False)(image).unsqueeze(0).to(device)

    with torch.no_grad():
        probs = torch.softmax(model(tensor), dim=1)[0]

    pred_idx = probs.argmax().item()
    print(f"prédiction : classe {classes[pred_idx]} ({probs[pred_idx]:.1%})")
    for c, p in sorted(zip(classes, probs.tolist()), key=lambda x: -x[1]):
        print(f"  {c:>2} : {p:.1%}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage : python infer.py <chemin_image>")
        sys.exit(1)
    predict(sys.argv[1])