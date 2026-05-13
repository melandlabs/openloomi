# @openloomi/insights

Pure algorithm and filter logic for insight/event management.

## Installation

```sh
pnpm add @openloomi/insights
```

## Exports

- `eventRank()` - Event ranking algorithm
- `focusClassifier` - Focus classification
- Filter schemas (Zod)
- Filter utilities (`insightMatchesFilter`, `filterInsights`)
- Option normalizers

## Note

Uses a minimal `InsightBase` interface. Implement the `InsightRepository` pattern to adapt to your data source.
