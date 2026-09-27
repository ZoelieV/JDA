import argparse
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

import config
from dataset import build_transforms
from model import TinyDigitCNN


class GradCAM:
    def __init__(self, model: torch.nn.Module, target_layer: torch.nn.Module):
        self.model = model
        self.activations = None
        target_layer.register_forward_hook(self._save_activation)

    def _save_activation(self, module, input, output):
        self.activations = output
        self.activations.retain_grad()  # on demande explicitement le gradient sur cette activation

    def __call__(self, input_tensor: torch.Tensor, class_idx: int = None):
        self.model.zero_grad()
        output = self.model(input_tensor)

        if class_idx is None:
            class_idx = output.argmax(dim=1).item()

        score = output[0, class_idx]
        score.backward()

        gradients = self.activations.grad
        weights = gradients.mean(dim=(2, 3), keepdim=True)
        cam = F.relu((weights * self.activations.detach()).sum(dim=1, keepdim=True))

        cam = cam[0, 0].cpu().numpy()
        if cam.max() > 0:
            cam = cam / cam.max()

        return cam, class_idx, torch.softmax(output, dim=1)[0, class_idx].item()


def overlay_heatmap(image: Image.Image, cam: np.ndarray, alpha: float = 0.45) -> Image.Image:
    import matplotlib.cm as cm

    w, h = image.size
    cam_img = Image.fromarray((cam * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)
    cam_arr = np.array(cam_img) / 255.0

    colored = (cm.jet(cam_arr)[:, :, :3] * 255).astype(np.uint8)
    colored_img = Image.fromarray(colored).convert("RGB")

    return Image.blend(image.convert("RGB"), colored_img, alpha=alpha)


def run_gradcam(image_path: str, class_idx: int = None):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    checkpoint = torch.load(config.BEST_MODEL_PATH, map_location=device)
    classes = checkpoint["classes"]

    model = TinyDigitCNN(num_classes=len(classes)).to(device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    target_layer = model.features[config.GRADCAM_TARGET_LAYER_INDEX]
    cam_engine = GradCAM(model, target_layer)

    image = Image.open(image_path).convert("RGB")
    tensor = build_transforms(train=False)(image).unsqueeze(0).to(device)
    tensor.requires_grad_(True)

    cam, predicted_idx, confidence = cam_engine(tensor, class_idx=class_idx)
    predicted_class = classes[predicted_idx]
    print(f"{Path(image_path).name} -> classe {predicted_class} ({confidence:.1%})")

    overlay = overlay_heatmap(image, cam)
    config.GRADCAM_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = config.GRADCAM_OUTPUT_DIR / f"{Path(image_path).stem}_cam_{predicted_class}.png"
    overlay.save(out_path)
    print(f"Heatmap sauvegardée : {out_path}")


def main():
    parser = argparse.ArgumentParser(description="Grad-CAM : où le CNN regarde pour sa décision")
    parser.add_argument("image_path")
    parser.add_argument("--class-idx", type=int, default=None,
                         help="Classe à expliquer (défaut: la classe prédite)")
    args = parser.parse_args()

    try:
        run_gradcam(args.image_path, class_idx=args.class_idx)
    except Exception as e:
        print(f"Erreur : {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()