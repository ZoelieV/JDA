import json

import torch
import torch.nn as nn
import torch.optim as optim

import config
from dataset import build_dataloaders, build_transforms
from model import TinyDigitCNN
from plotting import plot_history
from torchvision import datasets
from torch.utils.data import DataLoader
from collections import Counter


def evaluate(model, loader, device):
    model.eval()
    correct, total, loss_sum = 0, 0, 0.0
    criterion = nn.CrossEntropyLoss()

    with torch.no_grad():
        for images, labels in loader:
            images, labels = images.to(device), labels.to(device)
            outputs = model(images)
            loss_sum += criterion(outputs, labels).item() * images.size(0)
            correct += (outputs.argmax(dim=1) == labels).sum().item()
            total += labels.size(0)

    return loss_sum / total, correct / total


def build_clean_train_loader():
    """Train set relu sans augmentation/dropout, pour comparer équitablement à val."""
    ds = datasets.ImageFolder(config.TRAIN_DIR, transform=build_transforms(train=False))
    return DataLoader(ds, batch_size=config.BATCH_SIZE, shuffle=False, num_workers=2)


def compute_class_weights(dataset, device):
    counts = Counter(label for _, label in dataset.samples)
    n_classes = len(dataset.classes)
    total = sum(counts.values())

    weights = torch.tensor(
        [total / (n_classes * counts[i]) for i in range(n_classes)],
        dtype=torch.float32,
    )
    return weights.to(device)


def main():
    torch.manual_seed(config.SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    train_loader, val_loader, classes = build_dataloaders()
    print(f"Classes détectées : {classes}")

    model = TinyDigitCNN(num_classes=len(classes)).to(device)

    if config.USE_CLASS_WEIGHTS:
        class_weights = compute_class_weights(train_loader.dataset, device)
        print(f"Poids par classe : {dict(zip(classes, [round(w, 2) for w in class_weights.tolist()]))}")
        criterion = nn.CrossEntropyLoss(weight=class_weights)
    else:
        criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=config.LEARNING_RATE, weight_decay=config.WEIGHT_DECAY)
    scheduler = optim.lr_scheduler.StepLR(optimizer, step_size=20, gamma=0.5)

    best_val_acc = 0.0
    history = {"train_loss": [], "train_acc": [], "val_loss": [], "val_acc": []}

    for epoch in range(1, config.EPOCHS + 1):
        model.train()
        running_loss, correct, total = 0.0, 0, 0

        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)

            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

            running_loss += loss.item() * images.size(0)
            correct += (outputs.argmax(dim=1) == labels).sum().item()
            total += labels.size(0)

        scheduler.step()

        train_loss, train_acc = running_loss / total, correct / total
        val_loss, val_acc = evaluate(model, val_loader, device)

        history["train_loss"].append(train_loss)
        history["train_acc"].append(train_acc)
        history["val_loss"].append(val_loss)
        history["val_acc"].append(val_acc)

        print(f"epoch {epoch:03d} | train loss {train_loss:.4f} acc {train_acc:.3f} "
              f"| val loss {val_loss:.4f} acc {val_acc:.3f}")

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save({
                "model_state": model.state_dict(),
                "classes": classes,
                "val_acc": val_acc,
                "epoch": epoch,
            }, config.BEST_MODEL_PATH)

    with open(config.HISTORY_PATH, "w") as f:
        json.dump(history, f)
    plot_history(history, config.HISTORY_PATH.with_suffix(".png"))

    clean_train_loss, clean_train_acc = evaluate(model, build_clean_train_loader(), device)
    print(f"\nTrain accuracy SANS augmentation/dropout : {clean_train_acc:.3f} (loss {clean_train_loss:.4f})")
    print(f"À comparer au meilleur val_acc : {best_val_acc:.3f}")
    print("Si l'écart est grand (ex: train ~0.99 vs val ~0.90), c'est du surapprentissage réel.")

    print(f"\nMeilleur val_acc : {best_val_acc:.3f} -> {config.BEST_MODEL_PATH}")


if __name__ == "__main__":
    main()