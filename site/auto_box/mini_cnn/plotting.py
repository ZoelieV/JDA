import json
from pathlib import Path

import matplotlib.pyplot as plt

import config


def plot_history(history: dict, save_path: Path):
    epochs = range(1, len(history["train_loss"]) + 1)

    fig, axes = plt.subplots(1, 2, figsize=(11, 4.5))

    axes[0].plot(epochs, history["train_loss"], label="train")
    axes[0].plot(epochs, history["val_loss"], label="val")
    axes[0].set_title("Loss")
    axes[0].set_xlabel("epoch")
    axes[0].legend()
    axes[0].grid(alpha=0.3)

    axes[1].plot(epochs, history["train_acc"], label="train")
    axes[1].plot(epochs, history["val_acc"], label="val")
    axes[1].set_title("Accuracy")
    axes[1].set_xlabel("epoch")
    axes[1].legend()
    axes[1].grid(alpha=0.3)

    fig.tight_layout()
    fig.savefig(save_path, dpi=150)
    print(f"Courbes sauvegardées : {save_path}")


def load_and_plot(history_path: Path = config.HISTORY_PATH, save_path: Path = None):
    with open(history_path) as f:
        history = json.load(f)
    save_path = save_path or history_path.with_suffix(".png")
    plot_history(history, save_path)


if __name__ == "__main__":
    load_and_plot()