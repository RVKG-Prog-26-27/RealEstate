import os

import joblib
import numpy as np
import pandas as pd
import torch
from torch import nn

from house_settings import closing_and_holding_cost
from house_settings import house
from house_settings import risk_sigma
from house_settings import selling_cost_rate
from house_settings import target_profit_rate


# Этот файл не обучает модель заново.
# Он загружает готовую модель
# и проверяет новый дом.

work_dir = os.path.dirname(
    os.path.abspath(__file__)
)


model_file = f"{work_dir}/house_price_model.pt"
preprocessor_file = f"{work_dir}/house_preprocessor.joblib"


if not os.path.exists(model_file):
    raise FileNotFoundError(
        "Сначала запусти train_house_ai.py."
    )


if not os.path.exists(preprocessor_file):
    raise FileNotFoundError(
        "Не найден house_preprocessor.joblib."
    )


device = torch.device(
    "cuda"
    if torch.cuda.is_available()
    else "cpu"
)


checkpoint = torch.load(
    model_file,
    map_location=device,
    weights_only=False,
)

preprocessor = joblib.load(
    preprocessor_file
)


# Характеристики дома и финансовые настройки
# находятся в отдельном файле house_settings.py.


houses = pd.DataFrame(
    [house]
)


latest_year = checkpoint[
    "latest_sale_year"
]

latest_month = checkpoint[
    "latest_sale_month"
]


houses["SaleYear"] = latest_year
houses["SaleMonth"] = latest_month


houses["PropertyAge"] = (
    houses["SaleYear"]
    - houses["YrBuilt"]
)


houses["YearsSinceRenovation"] = np.where(
    houses["YrRenovated"] > 0,
    houses["SaleYear"] - houses["YrRenovated"],
    houses["PropertyAge"],
)


feature_columns = checkpoint[
    "feature_columns"
]


for column in feature_columns:
    if column not in houses.columns:
        houses[column] = np.nan


houses_ready = preprocessor.transform(
    houses[feature_columns]
).astype("float32")


model = nn.Sequential(
    nn.Linear(
        checkpoint["input_size"],
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


model.load_state_dict(
    checkpoint["model_state"]
)

model.eval()


houses_tensor = torch.tensor(
    houses_ready
).to(device)


with torch.no_grad():
    prediction_scaled = model(
        houses_tensor
    ).squeeze(1)

    prediction_scaled = (
        prediction_scaled
        .cpu()
        .numpy()
    )


target_mean = checkpoint[
    "target_mean"
]

target_std = checkpoint[
    "target_std"
]

residual_std = checkpoint[
    "validation_residual_std"
]


prediction_log = (
    prediction_scaled * target_std
    + target_mean
)


predicted_market_value = float(
    np.expm1(prediction_log)[0]
)


# Используем не средний прогноз,
# а более осторожную нижнюю оценку.

conservative_log = (
    prediction_log
    - risk_sigma * residual_std
)

conservative_market_value = float(
    np.expm1(conservative_log)[0]
)


asking_price = float(
    house["AskingPrice"]
)

repair_cost = float(
    house["EstimatedRepairCost"]
)


selling_cost = (
    conservative_market_value
    * selling_cost_rate
)

required_profit = (
    conservative_market_value
    * target_profit_rate
)


max_profitable_price = (
    conservative_market_value
    - repair_cost
    - closing_and_holding_cost
    - selling_cost
    - required_profit
)


estimated_profit = (
    conservative_market_value
    - asking_price
    - repair_cost
    - closing_and_holding_cost
    - selling_cost
)


invested_money = (
    asking_price
    + repair_cost
    + closing_and_holding_cost
)


estimated_roi = (
    estimated_profit
    / invested_money
)


if asking_price <= max_profitable_price:
    decision = "BUY"
else:
    decision = "SKIP"


result = pd.DataFrame(
    {
        "ListingId": [house["ListingId"]],
        "AskingPrice": [round(asking_price)],
        "PredictedMarketValue": [
            round(predicted_market_value)
        ],
        "ConservativeMarketValue": [
            round(conservative_market_value)
        ],
        "EstimatedRepairCost": [
            round(repair_cost)
        ],
        "MaxProfitablePrice": [
            round(max_profitable_price)
        ],
        "EstimatedProfit": [
            round(estimated_profit)
        ],
        "EstimatedROI": [
            round(estimated_roi, 3)
        ],
        "Decision": [decision],
    }
)


result_file = f"{work_dir}/house_prediction.csv"

result.to_csv(
    result_file,
    index=False,
)


print()
print("Результат оценки:")
print(result.to_string(index=False))
print()
print("Файл сохранён сюда:")
print(result_file)
