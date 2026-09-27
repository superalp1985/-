"""Generate a read-only Alpha158/Alpha360 oracle without importing app or Qlib code.

Run: python qa/generate-qlib-reference.py [--check]
Requires NumPy and pandas; the fixture records their installed versions.
Only the fixture is written. Immutable upstream sources are fetched into memory,
SHA-256 verified, and only the loader's static feature-config functions execute.
"""

import argparse
import ast
import copy
from datetime import date, timedelta
import hashlib
import json
import math
from pathlib import Path
import platform
import re
import urllib.request

import numpy as np
import pandas as pd


REVISION = "be725493eb1a6bbb42bf11b37aa7669f59610ff1"
CHECKED_DATE = "2026-09-27"
BASE_URL = f"https://raw.githubusercontent.com/microsoft/qlib/{REVISION}/"
SOURCES = {
    "loader": (
        "qlib/contrib/data/loader.py",
        "814b7f7ab3d418ae3c87ce352220080b239eba2670eac9e38376b794be4075cb",
    ),
    "ops": (
        "qlib/data/ops.py",
        "6f648355725a85a9f17528d864281fc065f8a4f887261a9909f7495d5db42760",
    ),
    "rolling": (
        "qlib/data/_libs/rolling.pyx",
        "58b2e418a78558135cb1ecad88bfcff68cae98b2bb2695d8d2fade8b30c5dbf1",
    ),
}
FAMILY_LABELS = {"alpha158": "Qlib Alpha158", "alpha360": "Qlib Alpha360"}
ALIASES = {"OPEN0": "OPEN", "HIGH0": "HIGH", "LOW0": "LOW", "VWAP0": "VWAP"}
FIELDS = ("open", "high", "low", "close", "volume", "vwap")
DAYS = 65
OUTPUT = Path(__file__).resolve().parents[1] / "tests/fixtures/qlib-reference.json"


def fetch_sources():
    sources = {}
    for key, (path, expected_hash) in SOURCES.items():
        with urllib.request.urlopen(BASE_URL + path, timeout=60) as response:
            content = response.read()
        actual_hash = hashlib.sha256(content).hexdigest()
        if actual_hash != expected_hash:
            raise ValueError(f"Immutable source hash mismatch: {path}: {actual_hash}")
        sources[key] = content.decode("utf-8")
    return sources


def feature_config(loader_source, class_name):
    module = ast.parse(loader_source)
    cls = next(
        node for node in module.body
        if isinstance(node, ast.ClassDef) and node.name == class_name
    )
    function = copy.deepcopy(next(
        node for node in cls.body
        if isinstance(node, ast.FunctionDef) and node.name == "get_feature_config"
    ))
    function.decorator_list = []
    isolated = ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[]))
    namespace = {"__builtins__": {"range": range, "str": str}}
    exec(compile(isolated, SOURCES["loader"][0], "exec"), namespace)
    return namespace["get_feature_config"]()


def make_rows():
    missing = {
        "close": {0, 17, 33, 58},
        "high": {1, 16, 34},
        "low": {2, 18, 35},
        "volume": {0, 19, 36},
        "vwap": {0, 21, 37},
    }
    rows = []
    for day in range(DAYS):
        timestamp = (date(2026, 1, 1) + timedelta(days=day)).isoformat()
        for asset in ("A", "B"):
            if asset == "A":
                close = (
                    42 + 0.11 * day + 1.75 * math.sin(0.43 * day)
                    + 0.7 * math.cos(0.19 * day) + (day % 7 - 3) / 19
                )
                volume = 800 + 9 * day + 135 * math.sin(0.37 * day) + (day * 17 % 23) * 3.75
            else:
                close, volume = 20.0, 100.0
            open_price = close + 0.45 * math.sin(0.73 * day + 0.4) - 0.18 * math.cos(0.23 * day)
            high = max(open_price, close) + 0.65 + (day % 6) / 20
            low = min(open_price, close) - 0.60 - (day % 7) * 0.035
            vwap = (open_price + high + low + 2 * close) / 5 + 0.03 * math.sin(0.31 * day)
            row = {
                "timestamp": timestamp,
                "asset": asset,
                "open": round(open_price, 8),
                "high": round(high, 8),
                "low": round(low, 8),
                "close": round(close, 8),
                "volume": round(volume, 8),
                "vwap": round(vwap, 8),
            }
            assert row["low"] <= min(row["open"], row["close"], row["vwap"])
            assert row["high"] >= max(row["open"], row["close"], row["vwap"])
            assert all(row[field] > 0 for field in FIELDS)
            if asset == "A":
                for field, days in missing.items():
                    if day in days:
                        row[field] = None
            rows.append(row)
    return rows


def ref(series, lag):
    if lag == 0 and not series.empty:
        return pd.Series(series.iloc[0], index=series.index, dtype=float)
    return series.shift(lag)


def rolling(series, window):
    if window == 0:
        return series.expanding(min_periods=1)
    return series.rolling(window, min_periods=1)


def regression(series, window, statistic):
    def fit(values):
        valid = ~np.isnan(values)
        if valid.sum() < 2:
            return np.nan
        # Keep ordinal positions across holes; dropping NaNs must not compress x.
        positions = np.arange(1, len(values) + 1, dtype=float)
        x, y = positions[valid], values[valid]
        centered_x, centered_y = x - x.mean(), y - y.mean()
        xx = np.dot(centered_x, centered_x)
        xy = np.dot(centered_x, centered_y)
        slope = xy / xx
        if statistic == "slope":
            return slope
        if statistic == "resi":
            return values[-1] - (y.mean() + slope * (positions[-1] - x.mean()))
        yy = np.dot(centered_y, centered_y)
        return np.nan if yy == 0 else (xy / np.sqrt(xx * yy)) ** 2

    result = rolling(series, window).apply(fit, raw=True)
    if statistic == "rsquare" and window != 0:
        result.loc[np.isclose(rolling(series, window).std(ddof=1), 0, atol=2e-5)] = np.nan
    return result


def corr(left, right, window):
    result = rolling(left, window).corr(right, ddof=1)
    # The upstream mask uses each whole input window, not just matched pairs.
    result.loc[
        np.isclose(left.rolling(window, min_periods=1).std(ddof=1), 0, atol=2e-5)
        | np.isclose(right.rolling(window, min_periods=1).std(ddof=1), 0, atol=2e-5)
    ] = np.nan
    return result


OPERATORS = {
    "Ref": ref,
    "Mean": lambda s, n: rolling(s, n).mean(),
    "Sum": lambda s, n: rolling(s, n).sum(),
    "Std": lambda s, n: rolling(s, n).std(ddof=1),
    "Min": lambda s, n: rolling(s, n).min(),
    "Max": lambda s, n: rolling(s, n).max(),
    "Quantile": lambda s, n, q: rolling(s, n).quantile(q, interpolation="linear"),
    "Rank": lambda s, n: rolling(s, n).rank(method="average", pct=True),
    "IdxMax": lambda s, n: rolling(s, n).apply(lambda x: np.argmax(x) + 1, raw=True),
    "IdxMin": lambda s, n: rolling(s, n).apply(lambda x: np.argmin(x) + 1, raw=True),
    "Slope": lambda s, n: regression(s, n, "slope"),
    "Rsquare": lambda s, n: regression(s, n, "rsquare"),
    "Resi": lambda s, n: regression(s, n, "resi"),
    "Corr": corr,
    "Greater": np.maximum,
    "Less": np.minimum,
    "Abs": np.abs,
    "Log": np.log,
}


def compile_expression(expression):
    translated = re.sub(r"\$([a-z]+)\b", lambda match: f"df[{match[1]!r}]", expression)
    tree = ast.parse(translated, mode="eval")
    allowed_nodes = (
        ast.Expression, ast.Call, ast.Name, ast.Load, ast.Subscript, ast.Constant,
        ast.BinOp, ast.UnaryOp, ast.Compare, ast.Add, ast.Sub, ast.Mult, ast.Div,
        ast.USub, ast.UAdd, ast.Gt, ast.Lt,
    )
    for node in ast.walk(tree):
        if not isinstance(node, allowed_nodes):
            raise ValueError(f"Unsupported upstream expression node: {ast.dump(node)}")
        if isinstance(node, ast.Name) and node.id not in {"df", *OPERATORS}:
            raise ValueError(f"Unknown upstream expression name: {node.id}")
        if isinstance(node, ast.Call) and (
            not isinstance(node.func, ast.Name) or node.func.id not in OPERATORS
        ):
            raise ValueError("Only known reference operators may be called")
        if isinstance(node, ast.Subscript) and (
            not isinstance(node.value, ast.Name) or node.value.id != "df"
            or not isinstance(node.slice, ast.Constant) or node.slice.value not in FIELDS
        ):
            raise ValueError("Only supplied input fields may be read")
    return compile(tree, "<immutable-qlib-expression>", "eval")


def evaluate(code, frame):
    with np.errstate(all="ignore"):
        result = eval(code, {"__builtins__": {}, **OPERATORS}, {"df": frame})
    assert isinstance(result, pd.Series) and result.index.equals(frame.index)
    return result.to_numpy(dtype=float)


def check_semantics():
    s = pd.Series([np.nan, 2.0, 4.0, np.nan, 4.0])
    np.testing.assert_allclose(OPERATORS["Mean"](s, 3), [np.nan, 2, 3, 3, 4], equal_nan=True)
    np.testing.assert_allclose(OPERATORS["Sum"](s, 3), [np.nan, 2, 6, 6, 8], equal_nan=True)
    assert np.isclose(OPERATORS["Std"](s, 3).iloc[2], np.sqrt(2))
    assert OPERATORS["Quantile"](s, 3, 0.8).iloc[2] == 3.6
    assert OPERATORS["Rank"](s, 3).iloc[-1] == 0.75
    assert np.isnan(OPERATORS["Rank"](s, 3).iloc[3])
    for operator in ("IdxMax", "IdxMin"):
        assert OPERATORS[operator](pd.Series([2.0, np.nan, 1.0]), 3).iloc[-1] == 2
        assert OPERATORS[operator](pd.Series([2.0, 2.0]), 3).iloc[-1] == 1
        assert np.isnan(OPERATORS[operator](pd.Series([np.nan]), 3).iloc[0])
    assert ref(s, 0).isna().all()
    np.testing.assert_allclose(ref(pd.Series([3.0, 7.0]), 0), [3, 3])
    np.testing.assert_allclose(ref(pd.Series([3.0, 7.0]), 1), [np.nan, 3], equal_nan=True)
    for operator in ("Greater", "Less"):
        assert np.isnan(OPERATORS[operator](pd.Series([np.nan]), 0).iloc[0])
    assert (s > ref(s, 1)).tolist() == [False, False, True, False, False]
    gapped = pd.Series([2.0, np.nan, 8.0, 9.0])
    assert np.isclose(regression(gapped, 4, "slope").iloc[-1], 17 / 7)
    assert np.isclose(regression(gapped, 4, "resi").iloc[-1], -4 / 7)
    assert np.isclose(regression(gapped, 4, "rsquare").iloc[-1], 289 / 301)
    assert np.isclose(regression(pd.Series([2.0, 5.0, np.nan]), 3, "slope").iloc[-1], 3)
    assert np.isnan(regression(pd.Series([2.0, 5.0, np.nan]), 3, "resi").iloc[-1])
    assert np.isnan(regression(pd.Series([2.0]), 5, "slope").iloc[0])
    flat = pd.Series([20.0] * 8)
    assert regression(flat, 5, "rsquare").isna().all()
    assert corr(flat, pd.Series(np.arange(8, dtype=float)), 5).isna().all()
    nearly_flat = pd.Series([20.0, 20.000001, 20.000002])
    assert regression(nearly_flat, 3, "rsquare").isna().all()
    left = pd.Series([0.0, 4e-5] + [2e-5] * 6)
    right = pd.Series([1.0, 2.0] + [np.nan] * 6)
    assert left.iloc[:2].std() > 2e-5 and left.std() < 2e-5
    assert np.isclose(left.rolling(8, min_periods=1).corr(right).iloc[-1], 1)
    assert np.isnan(corr(left, right, 8).iloc[-1])


def build_fixture(sources):
    check_semantics()
    rows = make_rows()
    frame = pd.DataFrame(rows)
    groups = [
        (group.index.to_numpy(), group.loc[:, FIELDS].astype("float64"))
        for _, group in frame.groupby("asset", sort=False)
    ]
    factors = []
    for family, class_name, count in (
        ("alpha158", "Alpha158DL", 158),
        ("alpha360", "Alpha360DL", 360),
    ):
        expressions, names = feature_config(sources["loader"], class_name)
        assert len(expressions) == len(names) == count
        assert len(set(names)) == count
        for expression, source_name in zip(expressions, names, strict=True):
            code = compile_expression(expression)
            expected = np.full(len(rows), np.nan, dtype=float)
            for indices, group in groups:
                expected[indices] = evaluate(code, group)
            assert not np.isinf(expected).any(), (family, source_name, "unexpected infinity")
            name = ALIASES.get(source_name, source_name) if family == "alpha158" else source_name
            factors.append({
                "family": family,
                "name": name,
                "sourceName": source_name,
                "expression": expression,
                "expected": [float(value) if np.isfinite(value) else None for value in expected],
            })
    fixture = {
        "revision": REVISION,
        "checkedDate": CHECKED_DATE,
        "sourceUrls": {key: BASE_URL + path for key, (path, _) in SOURCES.items()},
        "sourceSha256": {key: digest for key, (_, digest) in SOURCES.items()},
        "familyLabels": FAMILY_LABELS,
        "sourceNameAliases": {"alpha158": ALIASES},
        "oracle": {
            "generator": "qa/generate-qlib-reference.py",
            "python": platform.python_version(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "numericType": "float64",
            "daysPerAsset": DAYS,
            "operatorNames": sorted(OPERATORS),
        },
        "notes": [
            "Read-only test oracle: regenerate only from the pinned official sources, never from app output.",
            "Official expressions and their whitespace are preserved exactly; compare expressions after whitespace normalization only.",
            "family uses the local alpha158/alpha360 values. sourceName is official; only Alpha158 OPEN0/HIGH0/LOW0/VWAP0 have local aliases.",
            "Raw formulas only: no min_samples=5 filter, Qlib processors, learned normalization, or hidden prehistory.",
            "130 rows: 65 synthetic consecutive ISO calendar dates per asset, ordered A then B each date; compute independently per asset and restore row order.",
            "All observed prices and volumes are positive, consistently unadjusted, and OHLC/VWAP-valid. Supplied VWAP is not reconstructed.",
            "A has deterministic trend, oscillation and rational offsets, with early/mid-history missing close/high/low/volume/vwap; B always has close=20 and volume=100.",
            "Rolling aggregates use min_periods=1; Std uses ddof=1, Quantile linear interpolation, Rank average ties and pct=True.",
            "IdxMax/IdxMin use raw NumPy argmax/argmin plus one, including NaNs; do not drop missing positions or reverse indexing.",
            "Regression skips NaN y but preserves ordinal x; Resi uses the current position and is null when current y is missing.",
            "Rsquare is squared correlation with ordinal x, masked when independent rolling Std is close to zero (atol=2e-5).",
            "Corr uses pandas matched-pair rolling correlation, then independent per-input rolling Std near-zero masks (atol=2e-5).",
            "Greater/Less are np.maximum/minimum and preserve NaNs; Series comparisons involving NaN are false. Ref(0), unused here, means earliest observation.",
            "Input NaNs and all nonfinite outputs become JSON null. No zero-price/volume or infinity cases; those need separate consumer tests.",
            "This is an independent pandas/NumPy interpretation of verified official semantics, not an installed Qlib/provider execution. Compare finite numbers with tolerance.",
        ],
        "rows": rows,
        "factors": factors,
    }
    validate_fixture(fixture)
    return fixture


def validate_fixture(fixture):
    rows, factors = fixture["rows"], fixture["factors"]
    assert len(rows) == DAYS * 2
    assert [row["asset"] for row in rows] == ["A", "B"] * DAYS
    assert len({(row["asset"], row["timestamp"]) for row in rows}) == len(rows)
    assert [row["timestamp"] for row in rows] == sorted(row["timestamp"] for row in rows)
    for asset in ("A", "B"):
        dates = [date.fromisoformat(row["timestamp"]) for row in rows if row["asset"] == asset]
        assert len(dates) == DAYS and len(set(dates)) == DAYS
    assert len(factors) == 518
    assert sum(factor["family"] == "alpha158" for factor in factors) == 158
    assert sum(factor["family"] == "alpha360" for factor in factors) == 360
    assert len({(factor["family"], factor["name"]) for factor in factors}) == 518
    aliases = [factor for factor in factors if factor["name"] != factor["sourceName"]]
    assert len(aliases) == 4 and all(factor["family"] == "alpha158" for factor in aliases)
    for factor in factors:
        assert len(factor["expected"]) == len(rows)
        assert any(value is not None for value in factor["expected"]), factor["name"]
        assert all(
            value is None or (type(value) is float and math.isfinite(value))
            for value in factor["expected"]
        )
        if factor["family"] == "alpha158" and factor["name"].startswith(("CORR", "CORD", "RSQR")):
            assert all(value is None for value in factor["expected"][1::2]), factor["name"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify reproducibility without writing.")
    args = parser.parse_args()
    sources = fetch_sources()
    fixture = build_fixture(sources)
    content = json.dumps(fixture, ensure_ascii=True, allow_nan=False, separators=(",", ":")) + "\n"
    if args.check:
        if OUTPUT.read_bytes() != content.encode("utf-8"):
            raise SystemExit("Fixture differs from regenerated immutable-source oracle.")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_bytes(content.encode("utf-8"))
    finite_count = sum(value is not None for factor in fixture["factors"] for value in factor["expected"])
    print(json.dumps({
        "mode": "verified" if args.check else "generated",
        "output": str(OUTPUT),
        "factors": len(fixture["factors"]),
        "rows": len(fixture["rows"]),
        "values": len(fixture["factors"]) * len(fixture["rows"]),
        "finite": finite_count,
        "null": len(fixture["factors"]) * len(fixture["rows"]) - finite_count,
        "bytes": len(content.encode("utf-8")),
        "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
    }, indent=2))


if __name__ == "__main__":
    main()
