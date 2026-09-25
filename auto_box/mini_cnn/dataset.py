from torchvision import datasets, transforms
from torch.utils.data import DataLoader

import config


def build_transforms(train: bool):
    w, h = config.IMAGE_SIZE
    ops = [
        transforms.Grayscale(num_output_channels=1),
        transforms.Resize((h, w)),  # torchvision attend (H, W)
    ]

    if train:
        ops.append(transforms.RandomAffine(
            degrees=config.AUG_ROTATION_DEGREES,
            translate=(config.AUG_TRANSLATE_FRACTION, config.AUG_TRANSLATE_FRACTION),
        ))
        ops.append(transforms.ColorJitter(
            brightness=config.AUG_BRIGHTNESS_JITTER,
            contrast=config.AUG_CONTRAST_JITTER,
        ))

    ops.append(transforms.ToTensor())                        # -> [0, 1]
    ops.append(transforms.Normalize(mean=[0.5], std=[0.5]))   # -> [-1, 1]

    return transforms.Compose(ops)


def build_dataloaders():
    train_ds = datasets.ImageFolder(config.TRAIN_DIR, transform=build_transforms(train=True))
    val_ds = datasets.ImageFolder(config.VAL_DIR, transform=build_transforms(train=False))

    # tes dossiers "0".."6" sont triés alphabétiquement par ImageFolder,
    # ce qui tombe pile sur l'ordre numérique ici -- rien à faire de spécial.
    assert train_ds.classes == val_ds.classes, (
        f"Classes différentes entre train et val : {train_ds.classes} vs {val_ds.classes}"
    )

    train_loader = DataLoader(train_ds, batch_size=config.BATCH_SIZE, shuffle=True, num_workers=2)
    val_loader = DataLoader(val_ds, batch_size=config.BATCH_SIZE, shuffle=False, num_workers=2)

    return train_loader, val_loader, train_ds.classes