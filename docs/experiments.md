# Experiments and reports

Every training run is an **experiment**, stored in the local SQLite database (`data/app.db`).
Nothing is sent anywhere.

## What is recorded
| Item | Content |
|---|---|
| Experiment | name, model type, dataset, full configuration, seed, device, software environment (Python, PyTorch, NumPy, scikit-learn versions, CPU/GPU), status, duration, notes, tags |
| Epoch metrics | per epoch: train loss, validation loss, validation PR-AUC and ROC-AUC, accuracy, learning rate, elapsed time |
| Model version | checkpoint folder, threshold, temperature, ensemble size, parameter count, validation metrics, test metrics (after evaluation), active flag |
| Evaluations | split, threshold, metrics with 95 % CIs, ROC/PR/calibration curves, confusion matrix, timing, per-example scores; test evaluations are numbered |
| Dataset provenance | catalogue snapshot ids and SHA-256, label mode, split seed, pipeline version and configuration, content hash |

## The Experiments page
* **Log**: all experiments, filterable by model type, dataset, status and archived state.
* **Detail**: configuration, environment, training curves, model version and evaluations. Edit the
  name, notes and tags, archive, or delete (deleting removes the model files too).
* **Compare**: select two or more experiments to see a configuration diff and overlaid training
  curves. Validation metrics are always shown; test metrics appear when the models have been
  evaluated on test.

## Reports
Download a report for one experiment, or a comparison report for several:

* **Markdown** (`.md`): for notes, GitHub or a paper draft;
* **HTML** (`.html`): self-contained, printable, no external resources;
* **JSON** (`.json`): all the numbers, machine-readable.

An experiment report has these sections: 1. Summary, 2. Data provenance, 3. Dataset and splits,
4. Model configuration, 5. Training, 6. Validation results, 7. Test results (held-out stars),
8. Environment, 9. Limitations. If something has not happened yet (for example no test evaluation),
the report says so instead of leaving a gap. Every report states that planet-like predictions
are research leads, not discoveries. Reports of test-fixture models carry a prominent warning.

From the command line:
```powershell
exofinder report --experiment 3 --format html
exofinder report --experiment 1 2 3 4 --format md --out comparison.md
```

To write up a study, start from the [research report template](research-report-template.md) and
paste in the numbers from the generated reports.

## Backing up
**Settings → Backup database** downloads a consistent copy of `data/app.db` (made with SQLite's backup
API, so it is safe while the app runs). Model files live in `artifacts/models/`; copy that folder
too if you want to keep trained models.
