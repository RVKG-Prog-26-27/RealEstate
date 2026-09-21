import glob
import os
import random

import joblib
import numpy as np
import pandas as pd
import torch
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error
from sklearn.metrics import mean_squared_error
from sklearn.metrics import r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader
from torch.utils.data import TensorDataset


# Этот файл обучает модель один раз.
# Перед запуском сначала запусти
# scrape_king_county_real_sales.py.

work_dir = os.path.dirname(
    os.path.abspath(__file__)
)


csv_file = f"{work_dir}/king_county_real_house_sales.csv"

model_file = f"{work_dir}/house_price_model.pt"
preprocessor_file = f"{work_dir}/house_preprocessor.joblib"


# Если CSV был добавлен как Kaggle Dataset,
# код попробует найти его автоматически.

if not os.path.exists(csv_file):
    uploaded_files = glob.glob(
        "/kaggle/input/**/king_county_real_house_sales.csv",
        recursive=True,
    )

    if len(uploaded_files) == 0:
        raise FileNotFoundError(
            "Сначала запусти скрапер или добавь CSV "
            "в Kaggle Dataset."
        )

    csv_file = uploaded_files[0]


print("Читаю данные:")
print(csv_file)

data = pd.read_csv(
    csv_file,
    low_memory=False,
)


# Дата нужна, чтобы модель понимала
# изменение рынка со временем.

data["SaleDate"] = pd.to_datetime(
    data["SaleDate"],
    errors="coerce",
)

data["SaleYear"] = data["SaleDate"].dt.year
data["SaleMonth"] = data["SaleDate"].dt.month


# Возраст дома на момент продажи.

data["PropertyAge"] = (
    data["SaleYear"]
    - data["YrBuilt"]
)


# Если дом не ремонтировался,
# используем его обычный возраст.

data["YearsSinceRenovation"] = np.where(
    data["YrRenovated"] > 0,
    data["SaleYear"] - data["YrRenovated"],
    data["PropertyAge"],
)


numeric_features = [
    "SqFtTotLiving",
    "Bedrooms",
    "Bathrooms",
    "YrBuilt",
    "YrRenovated",
    "PropertyAge",
    "YearsSinceRenovation",
    "Stories",
    "BldgGrade",
    "Condition",
    "SqFtLot",
    "SqFtTotBasement",
    "SqFtFinBasement",
    "GarageSqFt",
    "Topography",
    "TrafficNoise",
    "AirportNoise",
    "PowerLines",
    "WfntLocation",
    "WfntFootage",
    "SeattleSkyline",
    "PugetSound",
    "LakeWashington",
    "LakeSammamish",
    "SaleMonth",
    "SaleYear",
]


category_features = [
    "ZipCode",
    "DistrictName",
    "HeatSystem",
    "HeatSource",
    "PresentUse",
]


feature_columns = (
    numeric_features
    + category_features
)


# Категории приводим к строкам.
# Иначе ZIP-коды могут ошибочно восприниматься
# как обычные числа.

for column in category_features:
    data[column] = (
        data[column]
        .astype("string")
        .str.strip()
    )


# Цена должна быть положительной.

data["SalePrice"] = pd.to_numeric(
    data["SalePrice"],
    errors="coerce",
)

data = data[
    data["SalePrice"] > 0
].copy()


# Проверяем модель на 2025 году.
# Так мы не перемешиваем прошлое и будущее
# случайным образом.

train_rows = data["SaleYear"] <= 2024
valid_rows = data["SaleYear"] == 2025

X_train = data.loc[
    train_rows,
    feature_columns,
].copy()

X_valid = data.loc[
    valid_rows,
    feature_columns,
].copy()


# Логарифм цены уменьшает влияние
# очень дорогих домов.

y_train_log = np.log1p(
    data.loc[train_rows, "SalePrice"].values
).astype("float32")

y_valid_log = np.log1p(
    data.loc[valid_rows, "SalePrice"].values
).astype("float32")


number_pipeline = Pipeline(
    [
        (
            "fill_missing",
            SimpleImputer(strategy="median"),
        ),
        (
            "scale",
            StandardScaler(),
        ),
    ]
)


category_pipeline = Pipeline(
    [
        (
            "fill_missing",
            SimpleImputer(strategy="most_frequent"),
        ),
        (
            "one_hot",
            OneHotEncoder(
                handle_unknown="ignore",
                min_frequency=20,
                sparse_output=False,
            ),
        ),
    ]
)


preprocessor = ColumnTransformer(
    [
        (
            "numbers",
            number_pipeline,
            numeric_features,
        ),
        (
            "categories",
            category_pipeline,
            category_features,
        ),
    ]
)


print("Подготавливаю признаки...")

X_train_ready = preprocessor.fit_transform(
    X_train
).astype("float32")

X_valid_ready = preprocessor.transform(
    X_valid
).astype("float32")


# Нормализуем целевую переменную.

target_mean = float(
    y_train_log.mean()
)

target_std = float(
    y_train_log.std()
)

y_train_scaled = (
    (y_train_log - target_mean)
    / target_std
).astype("float32")


X_train_tensor = torch.tensor(
    X_train_ready
)

y_train_tensor = torch.tensor(
    y_train_scaled
)


train_dataset = TensorDataset(
    X_train_tensor,
    y_train_tensor,
)

train_loader = DataLoader(
    train_dataset,
    batch_size=512,
    shuffle=True,
)


seed = 42

random.seed(seed)
np.random.seed(seed)
torch.manual_seed(seed)


device = torch.device(
    "cuda"
    if torch.cuda.is_available()
    else "cpu"
)

print("Устройство:", device)
print("Строк для обучения:", len(X_train))
print("Строк для проверки:", len(X_valid))
print(
    "Количество признаков после обработки:",
    X_train_ready.shape[1],
)


X_valid_tensor = torch.tensor(
    X_valid_ready
).to(device)


model = nn.Sequential(
    nn.Linear(
        X_train_ready.shape[1],
        256,
    ),
    nn.BatchNorm1d(256),
    nn.LeakyReLU(0.1),
    nn.Dropout(0.15),

    nn.Linear(256, 128),
    nn.BatchNorm1d(128),
    nn.LeakyReLU(0.1),
    nn.Dropout(0.10),

    nn.Linear(128, 64),
    nn.LeakyReLU(0.1),

    nn.Linear(64, 1),
).to(device)


loss_function = nn.SmoothL1Loss()

optimizer = torch.optim.AdamW(
    model.parameters(),
    lr=0.0008,
    weight_decay=0.0002,
)

scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
    optimizer,
    mode="min",
    factor=0.5,
    patience=8,
)


best_rmse = float("inf")
best_epoch = 0
best_weights = None

epochs_without_improvement = 0


for epoch in range(200):
    model.train()

    for batch_X, batch_y in train_loader:
        batch_X = batch_X.to(device)
        batch_y = batch_y.to(device)

        prediction = model(
            batch_X
        ).squeeze(1)

        loss = loss_function(
            prediction,
            batch_y,
        )

        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

    model.eval()

    with torch.no_grad():
        valid_scaled = model(
            X_valid_tensor
        ).squeeze(1)

        valid_scaled = (
            valid_scaled
            .cpu()
            .numpy()
        )

    valid_log_prediction = (
        valid_scaled * target_std
        + target_mean
    )

    valid_rmse = mean_squared_error(
        y_valid_log,
        valid_log_prediction,
    ) ** 0.5

    scheduler.step(valid_rmse)

    if valid_rmse < best_rmse - 0.0001:
        best_rmse = valid_rmse
        best_epoch = epoch + 1

        best_weights = {
            name: value.detach().cpu().clone()
            for name, value in model.state_dict().items()
        }

        epochs_without_improvement = 0

    else:
        epochs_without_improvement += 1

    if (epoch + 1) % 10 == 0:
        print(
            "Эпоха",
            epoch + 1,
            "log-RMSE:",
            round(valid_rmse, 5),
        )

    if epochs_without_improvement >= 30:
        print("Ранняя остановка.")
        break


model.load_state_dict(
    best_weights
)

model.eval()


with torch.no_grad():
    valid_scaled = model(
        X_valid_tensor
    ).squeeze(1)

    valid_scaled = (
        valid_scaled
        .cpu()
        .numpy()
    )


valid_log_prediction = (
    valid_scaled * target_std
    + target_mean
)

valid_price_prediction = np.expm1(
    valid_log_prediction
)

valid_real_price = np.expm1(
    y_valid_log
)


validation_mae = mean_absolute_error(
    valid_real_price,
    valid_price_prediction,
)

validation_r2 = r2_score(
    valid_real_price,
    valid_price_prediction,
)

validation_residual_std = float(
    np.std(
        y_valid_log - valid_log_prediction,
        ddof=1,
    )
)


print()
print("Проверка модели завершена.")
print("Лучшая эпоха:", best_epoch)
print("Validation log-RMSE:", round(best_rmse, 5))
print("Validation MAE, $:", round(validation_mae))
print("Validation R2:", round(validation_r2, 4))


# После честной проверки
# обучаем финальную модель
# на всех доступных продажах.

X_all = data[feature_columns].copy()

y_all_log = np.log1p(
    data["SalePrice"].values
).astype("float32")


X_all_ready = preprocessor.fit_transform(
    X_all
).astype("float32")


all_target_mean = float(
    y_all_log.mean()
)

all_target_std = float(
    y_all_log.std()
)

y_all_scaled = (
    (y_all_log - all_target_mean)
    / all_target_std
).astype("float32")


all_dataset = TensorDataset(
    torch.tensor(X_all_ready),
    torch.tensor(y_all_scaled),
)

all_loader = DataLoader(
    all_dataset,
    batch_size=512,
    shuffle=True,
)


random.seed(seed)
np.random.seed(seed)
torch.manual_seed(seed)


final_model = nn.Sequential(
    nn.Linear(
        X_all_ready.shape[1],
        256,
    ),
    nn.BatchNorm1d(256),
    nn.LeakyReLU(0.1),
    nn.Dropout(0.15),

    nn.Linear(256, 128),
    nn.BatchNorm1d(128),
    nn.LeakyReLU(0.1),
    nn.Dropout(0.10),

    nn.Linear(128, 64),
    nn.LeakyReLU(0.1),

    nn.Linear(64, 1),
).to(device)


final_optimizer = torch.optim.AdamW(
    final_model.parameters(),
    lr=0.0008,
    weight_decay=0.0002,
)


for epoch in range(max(best_epoch, 1)):
    final_model.train()

    for batch_X, batch_y in all_loader:
        batch_X = batch_X.to(device)
        batch_y = batch_y.to(device)

        prediction = final_model(
            batch_X
        ).squeeze(1)

        loss = loss_function(
            prediction,
            batch_y,
        )

        final_optimizer.zero_grad()
        loss.backward()
        final_optimizer.step()


latest_sale_date = data["SaleDate"].max()


joblib.dump(
    preprocessor,
    preprocessor_file,
)


torch.save(
    {
        "model_state": final_model.state_dict(),
        "input_size": X_all_ready.shape[1],
        "target_mean": all_target_mean,
        "target_std": all_target_std,
        "validation_residual_std": validation_residual_std,
        "feature_columns": feature_columns,
        "numeric_features": numeric_features,
        "category_features": category_features,
        "latest_sale_year": int(latest_sale_date.year),
        "latest_sale_month": int(latest_sale_date.month),
        "training_rows": len(data),
        "validation_log_rmse": float(best_rmse),
        "validation_mae": float(validation_mae),
        "validation_r2": float(validation_r2),
    },
    model_file,
)


print()
print("Обучение завершено.")
print("Модель:")
print(model_file)
print("Обработчик признаков:")
print(preprocessor_file)
