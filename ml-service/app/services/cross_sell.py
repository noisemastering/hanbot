"""
Cross-sell recommendations using KNN.
Finds similar customers and recommends products they bought.
"""
import pandas as pd
import numpy as np
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import LabelEncoder, StandardScaler
from datetime import datetime

_model = None
_data = None
_last_trained = None


def train(conversions: pd.DataFrame, conversations: pd.DataFrame, catalog: pd.DataFrame):
    """Train KNN model from purchase + inquiry data."""
    global _model, _data, _last_trained

    if conversions.empty:
        return

    # Build customer feature matrix from conversions
    df = conversions.copy()
    df = df.dropna(subset=["product_name"])

    if df.empty or len(df) < 5:
        return

    # Encode categorical features
    encoders = {}
    for col in ["product_name", "city", "state"]:
        enc = LabelEncoder()
        if col in df.columns:
            df[col + "_enc"] = enc.fit_transform(df[col].fillna("unknown"))
            encoders[col] = enc
        else:
            df[col + "_enc"] = 0

    features = ["product_name_enc", "city_enc", "state_enc", "amount"]
    df["amount"] = df["amount"].fillna(0)

    X = df[features].values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    k = min(5, len(X_scaled) - 1)
    if k < 1:
        return

    knn = NearestNeighbors(n_neighbors=k, metric="euclidean")
    knn.fit(X_scaled)

    _model = {
        "knn": knn,
        "scaler": scaler,
        "encoders": encoders,
        "features": features,
    }
    _data = df
    _last_trained = datetime.utcnow()


def recommend(product_name: str, city: str = None, state: str = None, amount: float = 0, top_n: int = 5) -> list[dict]:
    """Get cross-sell recommendations for a given purchase context."""
    if not _model or _data is None:
        return []

    encoders = _model["encoders"]

    # Encode the query
    def safe_encode(encoder, value):
        if value and value in encoder.classes_:
            return encoder.transform([value])[0]
        return 0

    query = np.array([[
        safe_encode(encoders.get("product_name", LabelEncoder()), product_name),
        safe_encode(encoders.get("city", LabelEncoder()), city or "unknown"),
        safe_encode(encoders.get("state", LabelEncoder()), state or "unknown"),
        amount,
    ]])

    query_scaled = _model["scaler"].transform(query)
    distances, indices = _model["knn"].kneighbors(query_scaled)

    # Get products from nearest neighbors (excluding the query product)
    neighbors = _data.iloc[indices[0]]
    recs = (
        neighbors[neighbors["product_name"] != product_name]
        .groupby("product_name")
        .agg(
            frequency=("product_name", "count"),
            avg_amount=("amount", "mean"),
        )
        .reset_index()
        .sort_values("frequency", ascending=False)
        .head(top_n)
    )

    return [
        {
            "product": row["product_name"],
            "frequency": int(row["frequency"]),
            "avg_amount": round(row["avg_amount"], 2),
        }
        for _, row in recs.iterrows()
    ]


def get_status() -> dict:
    return {
        "trained": _last_trained is not None,
        "last_trained": _last_trained.isoformat() if _last_trained else None,
        "data_points": len(_data) if _data is not None else 0,
    }
