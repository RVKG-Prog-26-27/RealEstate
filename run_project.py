import os
import subprocess
import sys


# Этот файл запускает весь проект по порядку.

project_dir = os.path.dirname(
    os.path.abspath(__file__)
)

os.chdir(project_dir)


csv_file = os.path.join(
    project_dir,
    "king_county_real_house_sales.csv",
)

model_file = os.path.join(
    project_dir,
    "house_price_model.pt",
)

preprocessor_file = os.path.join(
    project_dir,
    "house_preprocessor.joblib",
)


if not os.path.exists(csv_file):
    print("Готового датасета нет.")
    print("Запускаю сбор реальных продаж...")

    subprocess.run(
        [
            sys.executable,
            "scrape_king_county_real_sales.py",
        ],
        check=True,
    )
else:
    print("Готовый датасет найден.")


model_exists = os.path.exists(model_file)
preprocessor_exists = os.path.exists(preprocessor_file)


if not model_exists or not preprocessor_exists:
    print("Обученная модель не найдена.")
    print("Запускаю обучение...")

    subprocess.run(
        [
            sys.executable,
            "train_house_ai.py",
        ],
        check=True,
    )
else:
    print("Обученная модель найдена.")


print("Проверяю дом из house_settings.py...")

subprocess.run(
    [
        sys.executable,
        "predict_house.py",
    ],
    check=True,
)


print()
print("Проект завершил работу.")
