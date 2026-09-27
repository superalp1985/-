# Qlib Reference Fixture

`qlib-reference.json` contains 518 source expressions and 67,340 expected values
for two assets over 65 observations. It includes warm-up periods, missing fields,
ties and constant-price/volume series.

Source revision: `be725493eb1a6bbb42bf11b37aa7669f59610ff1`, checked 2026-09-27.
The JSON records immutable source URLs, source SHA-256 hashes, runtime versions
and the four Alpha158 zero-lag name aliases used by the app.

The oracle runs the source loader's isolated feature-config functions and
evaluates the official expressions with independent pandas/NumPy operators.
Regression formulas reproduce the source's ordinal time coordinates, not the
app's TypeScript. This is a source-based reference, not a run of an installed
Qlib package or its compiled Cython extension. Comparisons allow `1e-8` relative
or absolute error for floating-point implementation differences.

Regenerate with Python, NumPy, pandas and network access:

```sh
python qa/generate-qlib-reference.py
python qa/generate-qlib-reference.py --check
```

`npm test` reads the committed fixture offline. Python execution tests run when
`python` (or the `PYTHON` environment variable) can import NumPy and pandas.
Otherwise Vitest explicitly skips those tests; the TypeScript reference tests
still run. Division by zero and input-order boundaries are separate tests, not
evidence supplied by this fixture.
