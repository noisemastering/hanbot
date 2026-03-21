"""
Demand forecasting using linear regression.
Predicts demand by product, region, and size.
"""
from __future__ import annotations
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import LabelEncoder
from datetime import datetime, timedelta

# In-memory model store (replaced on retrain)
_models = {
    "by_product": None,
    "by_region": None,
    "by_size": None,
}
_encoders = {}
_last_trained = None


def train(conversions: pd.DataFrame, conversations: pd.DataFrame):
    """Train demand models from conversion + conversation data."""
    global _last_trained

    # --- BY PRODUCT ---
    _models["by_product"] = _train_product_demand(conversions, conversations)

    # --- BY REGION ---
    _models["by_region"] = _train_region_demand(conversions, conversations)

    # --- BY SIZE ---
    _models["by_size"] = _train_size_demand(conversations)

    _last_trained = datetime.utcnow()


def predict_product(weeks_ahead: int = 4) -> list[dict]:
    """Predict demand per product for the next N weeks."""
    model_data = _models.get("by_product")
    if not model_data:
        return []

    model, encoder, products = model_data["model"], model_data["encoder"], model_data["products"]
    predictions = []
    future_week = model_data["current_week"] + weeks_ahead

    for product in products:
        encoded = encoder.transform([product])[0] if product in encoder.classes_ else -1
        if encoded == -1:
            continue
        X = np.array([[encoded, future_week]])
        pred = max(0, round(model.predict(X)[0]))
        predictions.append({"product": product, "predicted_units": pred, "weeks_ahead": weeks_ahead})

    return sorted(predictions, key=lambda x: x["predicted_units"], reverse=True)


def predict_region(weeks_ahead: int = 4) -> list[dict]:
    """Predict demand per region for the next N weeks."""
    model_data = _models.get("by_region")
    if not model_data:
        return []

    model, encoder, regions = model_data["model"], model_data["encoder"], model_data["regions"]
    predictions = []
    future_week = model_data["current_week"] + weeks_ahead

    for region in regions:
        encoded = encoder.transform([region])[0] if region in encoder.classes_ else -1
        if encoded == -1:
            continue
        X = np.array([[encoded, future_week]])
        pred = max(0, round(model.predict(X)[0]))
        predictions.append({"region": region, "predicted_units": pred, "weeks_ahead": weeks_ahead})

    return sorted(predictions, key=lambda x: x["predicted_units"], reverse=True)


def predict_size(weeks_ahead: int = 4) -> list[dict]:
    """Predict demand per size for the next N weeks (uses conversation inquiry data)."""
    model_data = _models.get("by_size")
    if not model_data:
        return []

    model, encoder, sizes = model_data["model"], model_data["encoder"], model_data["sizes"]
    predictions = []
    future_week = model_data["current_week"] + weeks_ahead

    for size in sizes:
        encoded = encoder.transform([size])[0] if size in encoder.classes_ else -1
        if encoded == -1:
            continue
        X = np.array([[encoded, future_week]])
        pred = max(0, round(model.predict(X)[0]))
        predictions.append({"size": size, "predicted_demand": pred, "weeks_ahead": weeks_ahead})

    return sorted(predictions, key=lambda x: x["predicted_demand"], reverse=True)


def get_status() -> dict:
    return {
        "trained": _last_trained is not None,
        "last_trained": _last_trained.isoformat() if _last_trained else None,
        "models": {k: v is not None for k, v in _models.items()},
    }


# --- Internal training helpers ---

def _to_week_number(dt) -> int:
    """Convert datetime to an integer week number relative to epoch."""
    if pd.isna(dt):
        return 0
    if isinstance(dt, str):
        dt = pd.to_datetime(dt)
    return int(dt.timestamp() // (7 * 86400))


def _train_product_demand(conversions: pd.DataFrame, conversations: pd.DataFrame) -> dict | None:
    """Weekly demand per product from sales + inquiries."""
    # Combine sales and inquiries
    frames = []

    if not conversions.empty and "product_name" in conversions.columns:
        sales = conversions[["product_name", "click_date"]].dropna(subset=["product_name"])
        sales = sales.rename(columns={"product_name": "product", "click_date": "date"})
        sales["weight"] = 1.0  # actual sale
        frames.append(sales)

    if not conversations.empty and "product_interest" in conversations.columns:
        inquiries = conversations[["product_interest", "date"]].dropna(subset=["product_interest"])
        inquiries = inquiries.rename(columns={"product_interest": "product"})
        inquiries["weight"] = 0.3  # inquiry = partial demand signal
        frames.append(inquiries)

    if not frames:
        return None

    combined = pd.concat(frames, ignore_index=True)
    combined["week"] = combined["date"].apply(_to_week_number)

    weekly = combined.groupby(["product", "week"]).agg(demand=("weight", "sum")).reset_index()

    if len(weekly) < 3:
        return None

    encoder = LabelEncoder()
    weekly["product_enc"] = encoder.fit_transform(weekly["product"])

    X = weekly[["product_enc", "week"]].values
    y = weekly["demand"].values

    model = LinearRegression()
    model.fit(X, y)

    return {
        "model": model,
        "encoder": encoder,
        "products": list(encoder.classes_),
        "current_week": _to_week_number(datetime.utcnow()),
    }


def _train_region_demand(conversions: pd.DataFrame, conversations: pd.DataFrame) -> dict | None:
    """Weekly demand per state/region."""
    frames = []

    if not conversions.empty and "state" in conversions.columns:
        sales = conversions[["state", "click_date"]].dropna(subset=["state"])
        sales = sales.rename(columns={"click_date": "date"})
        sales["weight"] = 1.0
        frames.append(sales)

    if not conversations.empty and "state" in conversations.columns:
        inquiries = conversations[["state", "date"]].dropna(subset=["state"])
        inquiries["weight"] = 0.3
        frames.append(inquiries)

    if not frames:
        return None

    combined = pd.concat(frames, ignore_index=True)
    combined["state"] = combined["state"].str.strip().str.title()
    combined["week"] = combined["date"].apply(_to_week_number)

    weekly = combined.groupby(["state", "week"]).agg(demand=("weight", "sum")).reset_index()

    if len(weekly) < 3:
        return None

    encoder = LabelEncoder()
    weekly["state_enc"] = encoder.fit_transform(weekly["state"])

    X = weekly[["state_enc", "week"]].values
    y = weekly["demand"].values

    model = LinearRegression()
    model.fit(X, y)

    return {
        "model": model,
        "encoder": encoder,
        "regions": list(encoder.classes_),
        "current_week": _to_week_number(datetime.utcnow()),
    }


def _train_size_demand(conversations: pd.DataFrame) -> dict | None:
    """Weekly demand per size from conversation inquiries (includes unmet demand)."""
    if conversations.empty:
        return None

    # Build a size string from width x length or use the size field
    df = conversations.copy()

    def make_size(row):
        if pd.notna(row.get("size")) and row["size"]:
            return str(row["size"])
        w, l = row.get("width"), row.get("length")
        if pd.notna(w) and pd.notna(l) and w and l:
            return f"{w}x{l}"
        return None

    df["size_label"] = df.apply(make_size, axis=1)
    df = df.dropna(subset=["size_label"])

    if df.empty:
        return None

    df["week"] = df["date"].apply(_to_week_number)

    # Inquiries with handoff or high intent weigh more
    def demand_weight(row):
        if row.get("handoff"):
            return 0.8  # got to handoff = strong signal
        intent = row.get("purchase_intent", "")
        if intent == "high":
            return 0.7
        if intent == "medium":
            return 0.5
        return 0.3

    df["weight"] = df.apply(demand_weight, axis=1)
    weekly = df.groupby(["size_label", "week"]).agg(demand=("weight", "sum")).reset_index()

    if len(weekly) < 3:
        return None

    encoder = LabelEncoder()
    weekly["size_enc"] = encoder.fit_transform(weekly["size_label"])

    X = weekly[["size_enc", "week"]].values
    y = weekly["demand"].values

    model = LinearRegression()
    model.fit(X, y)

    return {
        "model": model,
        "encoder": encoder,
        "sizes": list(encoder.classes_),
        "current_week": _to_week_number(datetime.utcnow()),
    }
