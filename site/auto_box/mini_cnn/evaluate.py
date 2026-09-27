from collections import defaultdict

import torch

import config
from dataset import build_dataloaders
from model import TinyDigitCNN


def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    checkpoint = torch.load(config.BEST_MODEL_PATH, map_location=device)
    classes = checkpoint["classes"]

    _, val_loader, _ = build_dataloaders()

    model = TinyDigitCNN(num_classes=len(classes)).to(device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    per_class_correct = defaultdict(int)
    per_class_total = defaultdict(int)
    predicted_total = defaultdict(int)      # <- nouveau : nb de fois où la classe est PRÉDITE
    predicted_correct = defaultdict(int)    # <- nouveau : parmi ces prédictions, combien sont justes
    confusion = defaultdict(lambda: defaultdict(int))

    with torch.no_grad():
        for images, labels in val_loader:
            images, labels = images.to(device), labels.to(device)
            preds = model(images).argmax(dim=1)

            for pred, label in zip(preds.tolist(), labels.tolist()):
                true_c, pred_c = classes[label], classes[pred]
                per_class_total[true_c] += 1
                predicted_total[pred_c] += 1
                confusion[true_c][pred_c] += 1
                if pred == label:
                    per_class_correct[true_c] += 1
                    predicted_correct[pred_c] += 1

    print(f"Modèle epoch {checkpoint['epoch']}, val_acc {checkpoint['val_acc']:.3f}\n")
    print("Rappel par classe (vrai -> combien retrouvés) :")
    for c in classes:
        total = per_class_total[c]
        acc = per_class_correct[c] / total if total else 0.0
        print(f"  classe {c:>2} : {per_class_correct[c]}/{total} ({acc:.1%})")

    print("\nPrécision par classe (prédit -> combien étaient justes) :")
    for c in classes:
        total = predicted_total[c]
        acc = predicted_correct[c] / total if total else 0.0
        print(f"  classe {c:>2} : {predicted_correct[c]}/{total} ({acc:.1%})")

    print("\nConfusions (vrai -> prédit: nb) :")
    for true_c in classes:
        wrong = {k: v for k, v in confusion[true_c].items() if k != true_c}
        if wrong:
            print(f"  {true_c} -> {wrong}")

if __name__ == "__main__":
    main()