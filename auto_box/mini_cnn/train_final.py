import json
from collections import Counter

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import ConcatDataset, DataLoader
from torchvision import datasets

import config
from dataset import build_transforms
from model import TinyDigitCNN


def build_combined_loader():
    train_ds = datasets.ImageFolder(config.TRAIN_DIR, transform=build_transforms(train=True))
    val_ds = datasets.ImageFolder(config.VAL_DIR, transform=build_transforms(train=True))

    assert train_ds.classes == val_ds.classes, (
        f"Classes différentes entre train et val : {train_ds.classes} vs {val_ds.classes}"
    )

    combined = ConcatDataset([train_ds, val_ds])
    loader = DataLoader(combined, batch_size=config.BATCH_SIZE, shuffle=True, num_workers=2)

    labels = [label for _, label in train_ds.samples] + [label for _, label in val_ds.samples]
    return loader, labels, train_ds.classes


def compute_class_weights(labels, n_classes, device):
    counts = Counter(labels)
    total = sum(counts.values())
    weights = torch.tensor(
        [total / (n_classes * counts[i]) for i in range(n_classes)],
        dtype=torch.float32,
    )
    return weights.to(device)


def main():
    torch.manual_seed(config.SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    loader, labels, classes = build_combined_loader()
    print(f"Classes détectées : {classes}")
    print(f"Total images (train+val réunis) : {len(labels)}")

    model = TinyDigitCNN(num_classes=len(classes)).to(device)

    if config.USE_CLASS_WEIGHTS:
        class_weights = compute_class_weights(labels, len(classes), device)
        print(f"Poids par classe : {dict(zip(classes, [round(w, 2) for w in class_weights.tolist()]))}")
        criterion = nn.CrossEntropyLoss(weight=class_weights)
    else:
        criterion = nn.CrossEntropyLoss()

    optimizer = optim.Adam(model.parameters(), lr=config.LEARNING_RATE, weight_decay=config.WEIGHT_DECAY)
    scheduler = optim.lr_scheduler.StepLR(optimizer, step_size=20, gamma=0.5)

    history = {"train_loss": [], "train_acc": []}
    best_loss = float("inf")
    epochs_without_improvement = 0

    for epoch in range(1, config.FINAL_MAX_EPOCHS + 1):
        model.train()
        running_loss, correct, total = 0.0, 0, 0

        for images, targets in loader:
            images, targets = images.to(device), targets.to(device)

            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, targets)
            loss.backward()
            optimizer.step()

            running_loss += loss.item() * images.size(0)
            correct += (outputs.argmax(dim=1) == targets).sum().item()
            total += targets.size(0)

        scheduler.step()

        train_loss, train_acc = running_loss / total, correct / total
        history["train_loss"].append(train_loss)
        history["train_acc"].append(train_acc)

        print(f"epoch {epoch:03d} | train loss {train_loss:.4f} acc {train_acc:.3f}")

        if best_loss - train_loss > config.FINAL_MIN_DELTA:
            best_loss = train_loss
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1

        if epochs_without_improvement >= config.FINAL_PATIENCE:
            print(f"\nArrêt anticipé : train loss stable depuis {config.FINAL_PATIENCE} epochs (plateau atteint).")
            break

    torch.save({
        "model_state": model.state_dict(),
        "classes": classes,
        "epoch": epoch,
    }, config.FINAL_MODEL_PATH)

    with open(config.FINAL_HISTORY_PATH, "w") as f:
        json.dump(history, f)

    print(f"\nModèle final sauvegardé : {config.FINAL_MODEL_PATH}")
    print("Pas de val_acc affiché : tout le dataset a servi à l'entraînement, par design.")


if __name__ == "__main__":
    main()