"""Machine-learning engine: splits, datasets, baselines, AstroNet CNNs, training, calibration,
inference and evaluation for planet-like (1) vs false-positive-like (0) classification.

Depends only on :mod:`exofinder.astro.types` / :mod:`exofinder.config` (never on ``data``,
``services`` or ``api``). Submodules are imported explicitly so that light modules (``splits``,
``metrics``) do not pull in torch::

    from exofinder.ml.train import TrainConfig, train
    from exofinder.ml.inference import Predictor
    from exofinder.ml.evaluate import evaluate
    from exofinder.ml.model_cards import get_model_card

Modules: ``splits``, ``dataset_arrays``, ``features``, ``models.baselines``, ``models.cnn``,
``device``, ``train``, ``checkpoint``, ``inference``, ``metrics``, ``calibration``, ``evaluate``,
``model_cards`` (see docs/dev/CONTRACTS.md section 3).

Model-type names (``Experiment.model_type``): ``logreg``, ``random_forest``, ``cnn_single``,
``cnn_two_view``.
"""

MODEL_TYPES: tuple[str, ...] = ("logreg", "random_forest", "cnn_single", "cnn_two_view")
