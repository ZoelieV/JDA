import torch.nn as nn

import config


class TinyDigitCNN(nn.Module):
    def __init__(self, num_classes: int = config.NUM_CLASSES):
        super().__init__()
        c1, c2, c3 = config.CONV_CHANNELS

        self.features = nn.Sequential(
            nn.Conv2d(1, c1, kernel_size=3, padding=1),
            nn.BatchNorm2d(c1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),

            nn.Conv2d(c1, c2, kernel_size=3, padding=1),
            nn.BatchNorm2d(c2),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),

            nn.Conv2d(c2, c3, kernel_size=3, padding=1),
            nn.BatchNorm2d(c3),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d(1),  # -> (c3, 1, 1) peu importe la taille d'entrée réelle
        )

        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(config.DROPOUT),
            nn.Linear(c3, num_classes),
        )

    def forward(self, x):
        x = self.features(x)
        return self.classifier(x)