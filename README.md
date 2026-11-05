# AccessAudit

> An AI-assisted accessibility remediation research prototype that keeps automated code changes constrained, traceable, and verifiable.

AccessAudit connects browser accessibility findings to source code, asks an LLM for a structured remediation proposal, and only applies a change after deterministic validation. The project is an active research prototype—not a production-ready autonomous code editor.

## Why it matters

LLMs can propose useful UI fixes, but unconstrained edits can introduce syntax errors, change unrelated logic, or make claims that a build cannot support. AccessAudit uses a deliberately narrow pipeline:

```text
Playwright + axe-core → DOM violation → source provenance
→ constrained LLM proposal → schema & semantic gatekeeper
→ source-preserving patch → build → browser/Axe verification
```

**The LLM proposes. Deterministic controls decide. Verification closes the loop.**

## Highlights

- Maps DOM-level accessibility violations to localized source context.
- Restricts model output to structured edit operations such as `ADD`, `UPDATE`, `REMOVE`, and `REPLACE_TAG`.
- Validates proposals before a source-preserving patcher executes them.
- Uses browser and Axe verification as the final check.
- Includes datasets, benchmarks, experiments, test harnesses, and reproducibility notes.

## Research status

In the Task 30 offline semantic benchmark, the fine-tuned model matched the semantic ground truth in **43 of 50** cases. This measures localized semantic mapping only; it does **not** establish end-to-end patch success, build success, or Axe-resolution rates.

## Run and reproduce

The project uses Node.js and npm.

```bash
npm install
npm run prototype
```

For the complete research setup and benchmark workflow, see the reproducibility guide below. Some experiments require additional local tooling and configuration.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Reproducibility](docs/REPRODUCIBILITY.md)
- [Benchmark results](docs/BENCHMARK.md)
- [Research status](docs/RESEARCH.md)
- [Experiment history](docs/EXPERIMENTS.md)
- [Dataset notes](docs/DATASET.md)
- [Training notes](docs/TRAINING.md)

## Limitations

AccessAudit is experimental. Offline semantic evaluation does not prove production safety or successful end-to-end remediation. The repository documents these boundaries intentionally so results can be interpreted responsibly.

## License

See [LICENSE](LICENSE).
