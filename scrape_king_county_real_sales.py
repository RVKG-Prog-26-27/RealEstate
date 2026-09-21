import os
import urllib.request

import pandas as pd


# Этот скрипт собирает реальные зарегистрированные продажи домов.
# Источник: официальный King County Assessor, штат Washington.

sales_url = (
    "https://aqua.kingcounty.gov/extranet/assessor/"
    "Real%20Property%20Sales.zip"
)

buildings_url = (
    "https://aqua.kingcounty.gov/extranet/assessor/"
    "Residential%20Building.zip"
)

parcels_url = (
    "https://aqua.kingcounty.gov/extranet/assessor/"
    "Parcel.zip"
)


# Все файлы сохраняются рядом со скриптом.
# Поэтому проект можно переносить целой папкой.

work_dir = os.path.dirname(
    os.path.abspath(__file__)
)


sales_zip = f"{work_dir}/king_sales.zip"
buildings_zip = f"{work_dir}/king_residential.zip"
parcels_zip = f"{work_dir}/king_parcel.zip"

result_file = f"{work_dir}/king_county_real_house_sales.csv"


# Скачиваем архивы только один раз.

if not os.path.exists(sales_zip):
    print("Скачиваю реальные продажи...")
    print("Размер архива примерно 144 MB.")

    urllib.request.urlretrieve(
        sales_url,
        sales_zip,
    )
else:
    print("Архив продаж уже скачан.")


if not os.path.exists(buildings_zip):
    print("Скачиваю характеристики жилых домов...")
    print("Размер архива примерно 21 MB.")

    urllib.request.urlretrieve(
        buildings_url,
        buildings_zip,
    )
else:
    print("Архив характеристик домов уже скачан.")


if not os.path.exists(parcels_zip):
    print("Скачиваю характеристики земельных участков...")
    print("Размер архива примерно 31 MB.")

    urllib.request.urlretrieve(
        parcels_url,
        parcels_zip,
    )
else:
    print("Архив характеристик участков уже скачан.")


# Архив продаж большой, поэтому читаем его частями.
# Сразу оставляем только нормальные жилые рыночные сделки.

sale_columns = [
    "Major",
    "Minor",
    "DocumentDate",
    "SalePrice",
    "PrincipalUse",
    "SaleReason",
    "PropertyClass",
    "SaleWarning",
]

sale_parts = []


for chunk in pd.read_csv(
    sales_zip,
    usecols=sale_columns,
    dtype=str,
    encoding="latin1",
    chunksize=250000,
):
    chunk["SaleDate"] = pd.to_datetime(
        chunk["DocumentDate"],
        errors="coerce",
    )

    chunk["SalePrice"] = pd.to_numeric(
        chunk["SalePrice"],
        errors="coerce",
    )

    recent_sale = chunk["SaleDate"] >= "2020-01-01"

    normal_price = chunk["SalePrice"].between(
        100000,
        5000000,
    )

    residential_property = (
        chunk["PrincipalUse"].str.strip() == "6"
    )

    normal_market_sale = (
        chunk["SaleReason"].str.strip() == "1"
    )

    residential_class = (
        chunk["PropertyClass"].str.strip() == "8"
    )

    no_sale_warnings = (
        chunk["SaleWarning"]
        .fillna("")
        .str.strip()
        == ""
    )

    chunk = chunk[
        recent_sale
        & normal_price
        & residential_property
        & normal_market_sale
        & residential_class
        & no_sale_warnings
    ].copy()

    chunk["ParcelId"] = (
        chunk["Major"].str.strip().str.zfill(6)
        + chunk["Minor"].str.strip().str.zfill(4)
    )

    selected_sales = chunk[
        [
            "ParcelId",
            "SaleDate",
            "SalePrice",
        ]
    ].copy()

    sale_parts.append(selected_sales)


sales = pd.concat(
    sale_parts,
    ignore_index=True,
)

sales = sales.drop_duplicates(
    [
        "ParcelId",
        "SaleDate",
        "SalePrice",
    ]
)

print("Подходящих продаж найдено:", len(sales))


# Теперь читаем физические характеристики домов.

building_columns = [
    "Major",
    "Minor",
    "BldgNbr",
    "NbrLivingUnits",
    "Address",
    "ZipCode",
    "Stories",
    "BldgGrade",
    "SqFtTotLiving",
    "SqFtTotBasement",
    "SqFtFinBasement",
    "SqFtGarageBasement",
    "SqFtGarageAttached",
    "HeatSystem",
    "HeatSource",
    "Bedrooms",
    "BathHalfCount",
    "Bath3qtrCount",
    "BathFullCount",
    "YrBuilt",
    "YrRenovated",
    "Condition",
]


buildings = pd.read_csv(
    buildings_zip,
    usecols=building_columns,
    dtype=str,
    encoding="latin1",
    low_memory=False,
)


buildings["BldgNbr"] = pd.to_numeric(
    buildings["BldgNbr"],
    errors="coerce",
)

buildings["NbrLivingUnits"] = pd.to_numeric(
    buildings["NbrLivingUnits"],
    errors="coerce",
)


# Оставляем главный дом с одной жилой единицей.

main_building = buildings["BldgNbr"] == 1

one_home = (
    buildings["NbrLivingUnits"]
    .fillna(1)
    == 1
)

buildings = buildings[
    main_building & one_home
].copy()


buildings["ParcelId"] = (
    buildings["Major"].str.strip().str.zfill(6)
    + buildings["Minor"].str.strip().str.zfill(4)
)


numeric_building_columns = [
    "Stories",
    "BldgGrade",
    "SqFtTotLiving",
    "SqFtTotBasement",
    "SqFtFinBasement",
    "SqFtGarageBasement",
    "SqFtGarageAttached",
    "Bedrooms",
    "BathHalfCount",
    "Bath3qtrCount",
    "BathFullCount",
    "YrBuilt",
    "YrRenovated",
    "Condition",
]


for column in numeric_building_columns:
    buildings[column] = pd.to_numeric(
        buildings[column],
        errors="coerce",
    )


buildings["Bathrooms"] = (
    buildings["BathFullCount"].fillna(0)
    + buildings["Bath3qtrCount"].fillna(0) * 0.75
    + buildings["BathHalfCount"].fillna(0) * 0.50
)


buildings["GarageSqFt"] = (
    buildings["SqFtGarageBasement"].fillna(0)
    + buildings["SqFtGarageAttached"].fillna(0)
)


buildings = buildings.drop_duplicates(
    "ParcelId",
    keep="first",
)


# Загружаем характеристики земельных участков.

parcel_columns = [
    "Major",
    "Minor",
    "DistrictName",
    "PresentUse",
    "SqFtLot",
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
]


parcels = pd.read_csv(
    parcels_zip,
    usecols=parcel_columns,
    dtype=str,
    encoding="latin1",
    low_memory=False,
)


parcels["ParcelId"] = (
    parcels["Major"].str.strip().str.zfill(6)
    + parcels["Minor"].str.strip().str.zfill(4)
)


numeric_parcel_columns = [
    "SqFtLot",
    "Topography",
    "TrafficNoise",
    "AirportNoise",
    "WfntLocation",
    "WfntFootage",
    "SeattleSkyline",
    "PugetSound",
    "LakeWashington",
    "LakeSammamish",
]


for column in numeric_parcel_columns:
    parcels[column] = pd.to_numeric(
        parcels[column],
        errors="coerce",
    )


# В официальном файле PowerLines записан как Y или N.

parcels["PowerLines"] = (
    parcels["PowerLines"]
    .astype("string")
    .str.strip()
    .str.upper()
    .map(
        {
            "Y": 1,
            "N": 0,
        }
    )
)


parcels = parcels.drop_duplicates(
    "ParcelId",
    keep="first",
)


# Соединяем цену сделки, характеристики дома и участок.

data = sales.merge(
    buildings,
    on="ParcelId",
    how="inner",
)

data = data.merge(
    parcels,
    on="ParcelId",
    how="left",
    suffixes=("", "_parcel"),
)


# Удаляем строки с физически невозможными значениями.

normal_living_area = data["SqFtTotLiving"].between(
    300,
    12000,
)

normal_bedroom_count = data["Bedrooms"].between(
    0,
    15,
)

normal_bathroom_count = data["Bathrooms"].between(
    0,
    15,
)

normal_year = data["YrBuilt"].between(
    1800,
    2026,
)

normal_lot_size = data["SqFtLot"].between(
    500,
    2000000,
)


data = data[
    normal_living_area
    & normal_bedroom_count
    & normal_bathroom_count
    & normal_year
    & normal_lot_size
].copy()


# Оставляем понятные колонки для будущей модели.

final_columns = [
    "ParcelId",
    "SaleDate",
    "SalePrice",
    "Address",
    "ZipCode",
    "DistrictName",
    "SqFtTotLiving",
    "Bedrooms",
    "Bathrooms",
    "YrBuilt",
    "YrRenovated",
    "Stories",
    "BldgGrade",
    "Condition",
    "SqFtLot",
    "SqFtTotBasement",
    "SqFtFinBasement",
    "GarageSqFt",
    "HeatSystem",
    "HeatSource",
    "PresentUse",
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
]


data = data[final_columns].copy()

data = data.sort_values(
    "SaleDate",
    ascending=False,
)


data.to_csv(
    result_file,
    index=False,
)


print()
print("Готово.")
print("Строк в итоговом датасете:", len(data))
print("Самая ранняя продажа:", data["SaleDate"].min())
print("Самая свежая продажа:", data["SaleDate"].max())
print("Файл сохранён сюда:")
print(result_file)
print()
print(data.head(10).to_string(index=False))
