import numpy as np


# Здесь указываются характеристики дома,
# который нужно проверить.

house = {
    "ListingId": "HOUSE-1",

    # Цена покупки и предполагаемый ремонт.
    "AskingPrice": 650000,
    "EstimatedRepairCost": 50000,

    # Основные характеристики дома.
    "SqFtTotLiving": 1800,
    "Bedrooms": 3,
    "Bathrooms": 2.0,

    "YrBuilt": 1985,
    "YrRenovated": 0,

    "Stories": 1,
    "BldgGrade": 7,
    "Condition": 3,

    # Участок, подвал и гараж.
    "SqFtLot": 7500,
    "SqFtTotBasement": 0,
    "SqFtFinBasement": 0,
    "GarageSqFt": 400,

    # Особенности расположения.
    "Topography": 0,
    "TrafficNoise": 0,
    "AirportNoise": 0,
    "PowerLines": 0,

    "WfntLocation": 0,
    "WfntFootage": 0,

    "SeattleSkyline": 0,
    "PugetSound": 0,
    "LakeWashington": 0,
    "LakeSammamish": 0,

    # Местоположение.
    "ZipCode": "98052",
    "DistrictName": "REDMOND",

    # Системные коды King County.
    # Если код неизвестен, можно поставить np.nan.
    "HeatSystem": "5",
    "HeatSource": "2",
    "PresentUse": "2",
}


# Постоянные расходы на оформление,
# содержание и финансирование сделки.

closing_and_holding_cost = 30000.0


# Комиссия и другие расходы при продаже.

selling_cost_rate = 0.08


# Минимальная требуемая прибыль.

target_profit_rate = 0.15


# Осторожность прогноза.
# 1.28 соответствует примерно нижней
# 10-процентной границе оценки.

risk_sigma = 1.28


# Пример неизвестного значения:
# house["BldgGrade"] = np.nan
