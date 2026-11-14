/**
 * GENERATED FILE — do not edit by hand. Run `npm run gen:api` to regenerate from the FastAPI app
 * (src/api/openapi.json is the snapshot this was generated from).
 */

export interface paths {
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_api_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analysis/bls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Box Least Squares period search
         * @description BLS on the flattened light curve of a catalogue star or a parsed upload. All values are
         *     ``measured``. Several seconds for a full 4-year Kepler light curve (results are cached).
         */
        post: operations["bls_api_analysis_bls_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analysis/transit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Transit diagnostics at an ephemeris
         * @description Trapezoid fit, odd/even, secondary eclipse, individual transits, SNR, quality, folded/binned
         *     curve with the model, a catalogue-vs-measured-vs-estimate comparison and derived estimates.
         */
        post: operations["transit_api_analysis_transit_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analysis/injection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Injection–recovery test on a real light curve (synthetic)
         * @description Injects a SYNTHETIC trapezoid transit into a copy of a real cached Kepler light curve and runs
         *     a blind BLS search. The response is flagged ``synthetic: true``; nothing is stored.
         */
        post: operations["injection_api_analysis_injection_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/catalog/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Refresh the NASA catalogue (background job)
         * @description Downloads fresh snapshots from the NASA Exoplanet Archive and re-ingests the catalogue as a
         *     ``catalog_refresh`` job. If NASA is unreachable the job fails with a ``[nasa_unavailable]`` error.
         */
        post: operations["refresh_api_catalog_refresh_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/catalog/snapshots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Catalogue snapshots with provenance */
        get: operations["snapshots_api_catalog_snapshots_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/catalog/signals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Browse catalogue signals */
        get: operations["signals_api_catalog_signals_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/catalog/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Catalogue counts and histograms */
        get: operations["stats_api_catalog_stats_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/datasets/tiers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Dataset tiers in the live catalogue
         * @description Signal, star and class counts per tier (pilot / standard / full) with download-size and time
         *     estimates. Empty when the catalogue has not been downloaded yet.
         */
        get: operations["tiers_api_datasets_tiers_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/datasets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List datasets */
        get: operations["list_datasets_api_datasets_get"];
        put?: never;
        /**
         * Build a dataset (background job)
         * @description Creates the dataset (status ``building``) and starts a ``build_dataset`` job that downloads
         *     missing light curves, processes every signal, records exclusions, splits by star and writes the
         *     arrays. The new dataset id is in ``params.dataset_id`` of the returned job.
         */
        post: operations["create_dataset_api_datasets_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/datasets/{dataset_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Dataset detail with statistics
         * @description ``stats`` (ready datasets only): per-split counts, exclusions by reason (with examples and
         *     explanations), quality grades and issues, period/depth histograms per class, processing timings.
         */
        get: operations["get_dataset_api_datasets__dataset_id__get"];
        put?: never;
        post?: never;
        /** Delete a dataset */
        delete: operations["delete_dataset_api_datasets__dataset_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/datasets/{dataset_id}/examples": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Browse dataset examples */
        get: operations["examples_api_datasets__dataset_id__examples_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/datasets/{dataset_id}/examples/{signal_id}/views": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Model views of one example
         * @description Included examples: exactly the arrays the models see. Excluded examples: recomputed from the
         *     view cache when their light curve is available.
         */
        get: operations["example_views_api_datasets__dataset_id__examples__signal_id__views_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/datasets/{dataset_id}/gallery": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Random sample of views per class */
        get: operations["gallery_api_datasets__dataset_id__gallery_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs/pages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Research documentation index */
        get: operations["pages_api_docs_pages_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs/pages/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One documentation page (Markdown) */
        get: operations["page_api_docs_pages__slug__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/evaluation/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Evaluate a model on its validation or test split (background job)
         * @description Test-set evaluations are logged and numbered (see ``test_evaluation_number``); their metrics are
         *     copied onto the model version. Iterate on the validation split.
         */
        post: operations["start_run_api_evaluation_runs_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/evaluation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List evaluations */
        get: operations["list_evaluations_api_evaluation_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/evaluation/compare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Compare evaluations side by side
         * @description Aligned metric table with confidence intervals; ``warnings`` and ``comparable=false`` when the
         *     evaluations use different datasets or splits.
         */
        get: operations["compare_api_evaluation_compare_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/evaluation/{evaluation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Evaluation detail
         * @description Metrics (at the validation-chosen threshold and at 0.5), 95 % bootstrap CIs, ROC/PR/reliability
         *     curves, confusion matrix and inference timing.
         */
        get: operations["get_evaluation_api_evaluation__evaluation_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/evaluation/{evaluation_id}/examples": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Scored examples by outcome
         * @description Most confident first (highest score for predicted planet-like, lowest for predicted
         *     false-positive-like), with catalogue info and the local view.
         */
        get: operations["examples_api_evaluation__evaluation_id__examples_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/evaluation/{evaluation_id}/feature-importance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Permutation feature importance (baselines only)
         * @description Drop in PR-AUC when shuffling the global view, the local view or each physical feature on the
         *     evaluated split (logistic regression / random forest).
         */
        get: operations["feature_importance_api_evaluation__evaluation_id__feature_importance_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experiments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List experiments */
        get: operations["list_experiments_api_experiments_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experiments/compare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Compare experiments (configuration diff + epoch curves) */
        get: operations["compare_api_experiments_compare_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experiments/{experiment_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Experiment detail
         * @description Configuration, environment, per-epoch metrics, model version and evaluations.
         */
        get: operations["get_experiment_api_experiments__experiment_id__get"];
        put?: never;
        post?: never;
        /**
         * Delete an experiment and its artefacts
         * @description Removes the experiment, its epoch metrics, its model version(s) with checkpoints, their
         *     evaluations and the predictions made with them.
         */
        delete: operations["delete_experiment_api_experiments__experiment_id__delete"];
        options?: never;
        head?: never;
        /** Edit name, notes, tags or archived flag */
        patch: operations["patch_experiment_api_experiments__experiment_id__patch"];
        trace?: never;
    };
    "/api/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List jobs (most recent first) */
        get: operations["list_jobs_api_jobs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * SSE stream of all job updates (job tray)
         * @description First event ``snapshot`` = ``{jobs: JobOut[]}`` of queued/running jobs, then every
         *     ``progress``/``log``/``epoch``/``done`` event of every job (each with ``job_id``).
         */
        get: operations["stream_all_api_jobs_stream_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs/{job_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Job detail with the last 200 log lines */
        get: operations["get_job_api_jobs__job_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs/{job_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request cooperative cancellation
         * @description The job stops at its next checkpoint (between signals, mini-batches or downloads) and ends as
         *     ``cancelled``; partial artefacts are removed.
         */
        post: operations["cancel_job_api_jobs__job_id__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs/{job_id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * SSE stream of one job
         * @description First event ``snapshot`` = JobOut, then ``progress``/``log``/``epoch`` events, and ``done``
         *     (after which the stream closes). For a finished job: ``snapshot`` + ``done``.
         */
        get: operations["job_events_api_jobs__job_id__events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lightcurves/{kepid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Processed light curve of a catalogue star
         * @description Stages raw/normalized/trend/flat (downsampled for display), segments, cleaning report and,
         *     when an ephemeris is known (``signal_id`` or ``period``+``epoch``+``duration_hours``), the
         *     predicted transit times and the folded + binned light curve.
         */
        get: operations["get_lightcurve_api_lightcurves__kepid__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List model versions
         * @description Newest first, with validation metrics, latest test metrics, active flag and dataset name.
         */
        get: operations["list_models_api_models_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models/{model_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Model detail with model card and configuration */
        get: operations["get_model_api_models__model_id__get"];
        put?: never;
        post?: never;
        /**
         * Delete a model version and its checkpoint
         * @description Removes the checkpoint directory, the model's evaluations and the predictions made with it. If
         *     it was active, the most recent remaining model becomes active.
         */
        delete: operations["delete_model_api_models__model_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models/{model_id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Make this the active model */
        post: operations["activate_api_models__model_id__activate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/predictions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Prediction history */
        get: operations["history_api_predictions_get"];
        put?: never;
        /**
         * Score one signal with one or more models
         * @description Builds the views (catalogue, BLS or manual ephemeris), runs each model and stores one
         *     prediction per model, including ``seen_in_split`` and warnings. Catalogue stars that are not
         *     downloaded yet are downloaded synchronously unless ``download_if_missing`` is false.
         */
        post: operations["predict_api_predictions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/predictions/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Score many catalogue signals (background job) */
        post: operations["batch_api_predictions_batch_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/predictions/candidates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Ranked candidate signals (research leads)
         * @description Latest catalogue-ephemeris score per signal per model, with agreement across models,
         *     uncertainty and quality grade. These are leads for follow-up, not discoveries.
         */
        get: operations["candidates_api_predictions_candidates_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/predictions/{prediction_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Prediction detail incl. views */
        get: operations["detail_api_predictions__prediction_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/reports/experiments/{experiment_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Experiment report (Markdown, HTML or JSON)
         * @description Data provenance (catalogue snapshot ids and SHA-256), dataset and split sizes, configuration,
         *     training-curve summary, validation and test metrics with 95 % CIs, confusion matrix, calibration,
         *     threshold, timing, environment and limitations. Sections without data say so explicitly. HTML is
         *     self-contained (inline CSS, no external requests).
         */
        get: operations["experiment_report_api_reports_experiments__experiment_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/reports/comparison": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Comparison report of several experiments */
        get: operations["comparison_report_api_reports_comparison_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current settings with defaults and descriptions */
        get: operations["get_settings__api_settings_get"];
        /**
         * Change settings (partial update)
         * @description All-or-nothing: if any value is invalid nothing is saved and the message says why.
         */
        put: operations["put_settings_api_settings_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/storage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Disk usage per category */
        get: operations["storage_api_settings_storage_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/storage/clear": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Delete raw FITS, uploads or the views cache */
        post: operations["clear_api_settings_storage_clear_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/backup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download a consistent SQLite backup */
        get: operations["backup_api_settings_backup_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Overview dashboard payload
         * @description Catalogue, light-curve, dataset, model and prediction counts from the real database, running
         *     jobs, the compute device and the ``next_steps`` of a fresh install.
         */
        get: operations["summary_api_system_summary_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system/diagnostics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Versions, paths, disk, device, network */
        get: operations["diagnostics_api_system_diagnostics_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/targets/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Find a star by name or id */
        get: operations["search_api_targets_search_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/targets/{kepid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Target dossier
         * @description Target, stellar parameters (with provenance), signals with labels, dataset memberships and
         *     recent predictions.
         */
        get: operations["detail_api_targets__kepid__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/targets/{kepid}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Download the star's Kepler light curves (idempotent)
         * @description Returns 200 with the target when the light curve is already cached, otherwise 202 with the
         *     ``download`` job (an already running download for the same star is returned, not duplicated).
         */
        post: operations["download_api_targets__kepid__download_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/training/model-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Model cards of the four model types */
        get: operations["model_types_api_training_model_types_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/training/estimate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Measured seconds per training epoch
         * @description Times a few real training steps of a throw-away network on the dataset's examples (takes a few
         *     seconds for CNNs). Baselines have no epochs (``seconds_per_epoch`` is null).
         */
        get: operations["estimate_api_training_estimate_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/training/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Train one model (background job)
         * @description Creates an experiment and a ``train`` job. Progress events include ``epoch`` records
         *     (train/val loss, val PR-AUC/ROC-AUC/accuracy). The first successful model becomes active if no
         *     model is active.
         */
        post: operations["start_run_api_training_runs_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/training/suite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Train all four model types sequentially (one job)
         * @description One experiment per model type (logistic regression, random forest, single-view CNN, two-view
         *     CNN) on the same dataset and splits, trained one after the other in a ``train_suite`` job.
         */
        post: operations["start_suite_api_training_suite_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload a light-curve file
         * @description Store the file and describe it: FITS header facts, or the CSV columns, a suggested column
         *     mapping and preview rows to confirm before parsing.
         */
        post: operations["upload_api_uploads_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/uploads/{upload_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Upload details */
        get: operations["get_upload_api_uploads__upload_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/uploads/{upload_id}/parse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Parse an upload with a confirmed column mapping and time system
         * @description BJD times are converted to BKJD (BJD - 2454833.0). The response lists warnings, e.g. that
         *     non-Kepler-long-cadence data is out of distribution for the models.
         */
        post: operations["parse_api_uploads__upload_id__parse_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/uploads/{upload_id}/lightcurve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Processed light curve of a parsed upload
         * @description Same payload as ``GET /api/lightcurves/{kepid}``.
         */
        get: operations["upload_lightcurve_api_uploads__upload_id__lightcurve_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** Agreement */
        Agreement: {
            /** N Models */
            n_models: number;
            /** N Planet Like */
            n_planet_like: number;
            /** Fraction Planet Like */
            fraction_planet_like: number;
            /**
             * Consensus
             * @enum {string}
             */
            consensus: "planet-like" | "false-positive-like" | "split";
        };
        /** BatchIn */
        BatchIn: {
            /**
             * Model Version Id
             * @description Default: settings default model, else active model
             */
            model_version_id?: number | null;
            /**
             * Category
             * @description Signal category (comma-separated) or 'all'
             * @default candidate
             */
            category: string;
            /**
             * Only Downloaded
             * @description False: download missing light curves first
             * @default true
             */
            only_downloaded: boolean;
            /** Limit */
            limit?: number | null;
            /**
             * Skip Existing
             * @description Skip signals this model has already scored
             * @default false
             */
            skip_existing: boolean;
        };
        /** BinnedSeries */
        BinnedSeries: {
            /** Phase */
            phase: (number | null)[];
            /** Flux */
            flux: (number | null)[];
            /**
             * Window Days
             * @description Binned range is |phase| <= window_days
             */
            window_days: number;
            /** Bin Width Days */
            bin_width_days: number;
        };
        /** BlsBest */
        BlsBest: {
            /** Period */
            period: number;
            /** Epoch */
            epoch: number;
            /** Duration Hours */
            duration_hours: number;
            /** Depth Ppm */
            depth_ppm?: number | null;
            /** Depth Err Ppm */
            depth_err_ppm?: number | null;
            /** Snr */
            snr?: number | null;
            /** Sde */
            sde?: number | null;
            /** Power */
            power?: number | null;
            /** N Transits */
            n_transits: number;
            /** N Transits Expected */
            n_transits_expected: number;
            /**
             * Provenance
             * @default measured
             * @constant
             */
            provenance: "measured";
            /** Source */
            source: string;
        };
        /** BlsIn */
        BlsIn: {
            /** Source */
            source: components["schemas"]["CatalogSource"] | components["schemas"]["UploadSource"];
            /**
             * Min Period
             * @description days (default 0.5)
             */
            min_period?: number | null;
            /**
             * Max Period
             * @description days (default half the baseline)
             */
            max_period?: number | null;
        };
        /** BlsOut */
        BlsOut: {
            source: components["schemas"]["SourceOut"];
            /**
             * Provenance
             * @default measured
             * @constant
             */
            provenance: "measured";
            /**
             * Periods
             * @description Periodogram periods (downsampled, keeps local maxima)
             */
            periods: (number | null)[];
            /** Power */
            power: (number | null)[];
            /**
             * Power Norm
             * @description Normalised power (SDE-like) for plotting
             */
            power_norm: (number | null)[];
            best: components["schemas"]["BlsBest"];
            /**
             * Peaks
             * @description Top distinct peaks (<= 5)
             */
            peaks: components["schemas"]["BlsPeak"][];
            /** @description Best-period ephemeris, ready for transit analysis / predictions */
            ephemeris: components["schemas"]["EphemerisOut"];
            search: components["schemas"]["BlsSearch"];
            /**
             * Warnings
             * @default []
             */
            warnings: string[];
            /** Compute Ms */
            compute_ms: number;
            /**
             * Cached
             * @default false
             */
            cached: boolean;
            /** Pipeline Version */
            pipeline_version: string;
        };
        /** BlsPeak */
        BlsPeak: {
            /** Rank */
            rank: number;
            /** Period */
            period: number;
            /** Power */
            power?: number | null;
            /**
             * Sde
             * @description Power above the running median / running scatter
             */
            sde?: number | null;
            /**
             * Refined
             * @description True for peaks re-searched on a fine grid
             */
            refined: boolean;
            /** Is Best */
            is_best: boolean;
            /**
             * Alias Of Best
             * @description e.g. P/2, 2P when the peak is an alias of the best period
             */
            alias_of_best?: string | null;
        };
        /** BlsSearch */
        BlsSearch: {
            /** Min Period */
            min_period?: number | null;
            /** Max Period */
            max_period?: number | null;
            /** Baseline Days */
            baseline_days?: number | null;
            /** N Periods Searched */
            n_periods_searched: number;
            /** Frequency Oversample Effective */
            frequency_oversample_effective?: number | null;
            /** Bin Minutes */
            bin_minutes?: number | null;
            /** N Points */
            n_points: number;
            /** Objective */
            objective?: string | null;
        };
        /** Body_upload_api_uploads_post */
        Body_upload_api_uploads_post: {
            /**
             * File
             * @description .fits/.fit/.fits.gz or .csv/.txt, <= 200 MB
             */
            file: string;
        };
        /** CandidateModel */
        CandidateModel: {
            /** Id */
            id: number;
            /** Name */
            name: string;
            /** Model Type */
            model_type: string;
            /** Is Fixture */
            is_fixture: boolean;
        };
        /** CandidateOut */
        CandidateOut: {
            /** Rank */
            rank: number;
            /** Signal Id */
            signal_id: number;
            /** Signal Key */
            signal_key: string;
            /** Kepid */
            kepid: number;
            /** Kepler Host Name */
            kepler_host_name?: string | null;
            /** Kepler Name */
            kepler_name?: string | null;
            /** Kepoi Name */
            kepoi_name?: string | null;
            /** Category */
            category: string;
            /** Koi Disposition */
            koi_disposition?: string | null;
            /** Av Training Set */
            av_training_set?: string | null;
            /** Label Conflict */
            label_conflict: boolean;
            /** Period Days */
            period_days?: number | null;
            /** Depth Ppm */
            depth_ppm?: number | null;
            /** Duration Hours */
            duration_hours?: number | null;
            /** Planet Radius Re */
            planet_radius_re?: number | null;
            /** Scores */
            scores: components["schemas"]["CandidateScore"][];
            /** Mean Probability */
            mean_probability: number;
            /** Max Probability */
            max_probability: number;
            /** Min Probability */
            min_probability: number;
            agreement: components["schemas"]["Agreement"];
            /** Uncertainty */
            uncertainty?: number | null;
            /** Quality Grade */
            quality_grade?: string | null;
            /** Quality Ok */
            quality_ok?: boolean | null;
            /**
             * Seen In Training
             * @description Some model saw this star in its train/val split
             */
            seen_in_training: boolean;
            /** Has Fixture Model Scores */
            has_fixture_model_scores: boolean;
        };
        /** CandidatePage */
        CandidatePage: {
            /** Total */
            total: number;
            /** Limit */
            limit: number;
            /** Offset */
            offset: number;
            /** Items */
            items: components["schemas"]["CandidateOut"][];
            /** Models */
            models: components["schemas"]["CandidateModel"][];
            /** Disclaimer */
            disclaimer: string;
        };
        /** CandidateScore */
        CandidateScore: {
            /** Prediction Id */
            prediction_id: number;
            /** Model Version Id */
            model_version_id: number;
            /** Model Name */
            model_name: string;
            /** Model Type */
            model_type?: string | null;
            /** Is Fixture Model */
            is_fixture_model: boolean;
            /** Probability */
            probability: number;
            /** Uncertainty */
            uncertainty?: number | null;
            /** Predicted Label */
            predicted_label: number;
            /** Seen In Split */
            seen_in_split?: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
        };
        /**
         * CatalogLabels
         * @description NASA's own classification of the signal, shown beside the model score.
         */
        CatalogLabels: {
            /** Signal Key */
            signal_key?: string | null;
            /** Kepler Name */
            kepler_name?: string | null;
            /** Kepoi Name */
            kepoi_name?: string | null;
            /** Av Training Set */
            av_training_set?: string | null;
            /** Koi Disposition */
            koi_disposition?: string | null;
            /** Category */
            category?: string | null;
            /**
             * Label Conflict
             * @default false
             */
            label_conflict: boolean;
        };
        /** CatalogPredictionSource */
        CatalogPredictionSource: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "catalog";
            /** Kepid */
            kepid: number;
            /**
             * Signal Id
             * @description Required with ephemeris_source 'catalog'
             */
            signal_id?: number | null;
        };
        /** CatalogSource */
        CatalogSource: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "catalog";
            /** Kepid */
            kepid: number;
        };
        /** CatalogStatsOut */
        CatalogStatsOut: {
            /** Total */
            total: number;
            /** Categories */
            categories: {
                [key: string]: number;
            };
            /** Av Labels */
            av_labels: {
                [key: string]: number;
            };
            /** Koi Dispositions */
            koi_dispositions: {
                [key: string]: number;
            };
            /** Label Conflicts */
            label_conflicts: number;
            /** With Lightcurve */
            with_lightcurve: number;
            /** Histograms */
            histograms: components["schemas"]["HistogramOut"][];
            /** Snapshots Retrieved At */
            snapshots_retrieved_at: {
                [key: string]: string | null;
            };
            /** Note */
            note: string;
        };
        /** CatalogSummary */
        CatalogSummary: {
            /** N Signals */
            n_signals: number;
            /** N Targets */
            n_targets: number;
            /** By Category */
            by_category: {
                [key: string]: number;
            };
            /** By Av Label */
            by_av_label: {
                [key: string]: number;
            };
            /** By Koi Disposition */
            by_koi_disposition: {
                [key: string]: number;
            };
            /** Label Conflicts */
            label_conflicts: number;
            /** Last Refresh */
            last_refresh?: string | null;
            /**
             * Snapshot Ids
             * @description Latest snapshot id per source
             */
            snapshot_ids: {
                [key: string]: number;
            };
        };
        /** ClearIn */
        ClearIn: {
            /**
             * Target
             * @enum {string}
             */
            target: "raw_fits" | "uploads" | "views_cache";
        };
        /** ClearOut */
        ClearOut: {
            /** Target */
            target: string;
            /** Bytes Freed */
            bytes_freed: number;
            /** Files Removed */
            files_removed: number;
            /** Path */
            path: string;
        };
        /**
         * ColumnMapping
         * @description Which column holds each quantity (CSV). For FITS only ``flux`` is used (e.g. ``SAP_FLUX``).
         */
        ColumnMapping: {
            /** Time */
            time?: string | null;
            /** Flux */
            flux?: string | null;
            /** Flux Err */
            flux_err?: string | null;
            /** Quality */
            quality?: string | null;
        };
        /** CompareRow */
        CompareRow: {
            /** Metric */
            metric: string;
            /** Values */
            values: {
                [key: string]: number | null;
            };
            /** Ci */
            ci: {
                [key: string]: number[] | null;
            };
            /**
             * Best
             * @description Evaluation id with the best value (None when not applicable)
             */
            best?: string | null;
        };
        /** ComparisonRow */
        ComparisonRow: {
            /** Quantity */
            quantity: string;
            /** Unit */
            unit: string;
            catalogue?: components["schemas"]["PValue"] | null;
            measured?: components["schemas"]["PValue"] | null;
            estimate?: components["schemas"]["PValue"] | null;
        };
        /** ConfigDiffRow */
        ConfigDiffRow: {
            /** Key */
            key: string;
            /** Values */
            values: {
                [key: string]: unknown;
            };
        };
        /** DatasetBrief */
        DatasetBrief: {
            /** Id */
            id: number;
            /** Name */
            name: string;
            /** Status */
            status: string;
            /** Tier */
            tier: string;
            /** Label Mode */
            label_mode: string;
            /** N Examples */
            n_examples: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
        };
        /**
         * DatasetCreate
         * @description Request to build a dataset (``POST /api/datasets``).
         */
        DatasetCreate: {
            /** Name */
            name: string;
            /**
             * Tier
             * @default pilot
             * @enum {string}
             */
            tier: "pilot" | "standard" | "full" | "custom";
            /**
             * Label Mode
             * @default astronet_dr24
             * @enum {string}
             */
            label_mode: "astronet_dr24" | "koi_disposition";
            /**
             * Split Seed
             * @description Seeds both the tier's star selection and the star-level split
             * @default 42
             */
            split_seed: number;
            /**
             * Exclude Conflicts
             * @description Exclude signals whose Autovetter label and KOI disposition disagree
             * @default true
             */
            exclude_conflicts: boolean;
            /**
             * Max Signals
             * @description Target number of labelled signals (required for tier 'custom')
             */
            max_signals?: number | null;
            pipeline?: components["schemas"]["PipelineOptions"];
            /**
             * Parent Id
             * @description Expand this dataset: its stars keep their split
             */
            parent_id?: number | null;
            /**
             * Download Missing
             * @description Download missing light curves from NASA MAST during the build
             * @default true
             */
            download_missing: boolean;
        };
        /** DatasetDeleteOut */
        DatasetDeleteOut: {
            /** Deleted */
            deleted: boolean;
            /** Dataset Id */
            dataset_id: number;
            /**
             * Examples
             * @default 0
             */
            examples: number;
            /**
             * Experiments
             * @default 0
             */
            experiments: number;
            /**
             * Models
             * @default 0
             */
            models: number;
            /**
             * Evaluations
             * @default 0
             */
            evaluations: number;
            /**
             * Predictions
             * @default 0
             */
            predictions: number;
        };
        /** DatasetDetailOut */
        DatasetDetailOut: {
            /** Id */
            id: number;
            /** Name */
            name: string;
            /** Label Mode */
            label_mode: string;
            /** Tier */
            tier: string;
            /**
             * Status
             * @enum {string}
             */
            status: "building" | "ready" | "failed" | "cancelled";
            /** Pipeline Version */
            pipeline_version: string;
            /** Split Seed */
            split_seed: number;
            /**
             * Config
             * @default {}
             */
            config: {
                [key: string]: unknown;
            };
            /** Content Hash */
            content_hash?: string | null;
            /** Path */
            path?: string | null;
            /** Parent Id */
            parent_id?: number | null;
            /**
             * N Examples
             * @default 0
             */
            n_examples: number;
            /**
             * N Train
             * @default 0
             */
            n_train: number;
            /**
             * N Val
             * @default 0
             */
            n_val: number;
            /**
             * N Test
             * @default 0
             */
            n_test: number;
            /** N Excluded */
            n_excluded?: number | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Job Id */
            job_id?: string | null;
            /**
             * N Models
             * @default 0
             */
            n_models: number;
            /** Error */
            error?: string | null;
            /**
             * Is Synthetic
             * @description Built from synthetic TEST light curves
             * @default false
             */
            is_synthetic: boolean;
            /**
             * Compatible
             * @description Built with the running pipeline version
             * @default true
             */
            compatible: boolean;
            stats?: components["schemas"]["DatasetStats"] | null;
        };
        /** DatasetExampleOut */
        DatasetExampleOut: {
            /** Signal Id */
            signal_id: number;
            /** Signal Key */
            signal_key: string;
            /** Kepid */
            kepid: number;
            /** Label */
            label?: number | null;
            /** Split */
            split?: string | null;
            /** Included */
            included: boolean;
            /** Exclusion Reason */
            exclusion_reason?: string | null;
            /** Exclusion Label */
            exclusion_label?: string | null;
            /**
             * Quality
             * @default {}
             */
            quality: {
                [key: string]: unknown;
            };
            /** Quality Grade */
            quality_grade?: string | null;
            /** Array Index */
            array_index?: number | null;
            /** Period Days */
            period_days?: number | null;
            /** Duration Hours */
            duration_hours?: number | null;
            /** Depth Ppm */
            depth_ppm?: number | null;
            /** Model Snr */
            model_snr?: number | null;
            /** Kepoi Name */
            kepoi_name?: string | null;
            /** Kepler Name */
            kepler_name?: string | null;
            /** Category */
            category?: string | null;
            /** Av Training Set */
            av_training_set?: string | null;
            /** Koi Disposition */
            koi_disposition?: string | null;
            /**
             * Label Conflict
             * @default false
             */
            label_conflict: boolean;
            /**
             * Is Reserved
             * @default false
             */
            is_reserved: boolean;
        };
        /** DatasetExamplePage */
        DatasetExamplePage: {
            /** Total */
            total: number;
            /** Items */
            items: components["schemas"]["DatasetExampleOut"][];
        };
        /** DatasetMembership */
        DatasetMembership: {
            /** Dataset Id */
            dataset_id: number;
            /** Dataset Name */
            dataset_name: string;
            /** Dataset Status */
            dataset_status?: string | null;
            /**
             * Split
             * @description train | val | test, or null when excluded
             */
            split?: string | null;
            /** N Signals */
            n_signals: number;
        };
        /** DatasetOut */
        DatasetOut: {
            /** Id */
            id: number;
            /** Name */
            name: string;
            /** Label Mode */
            label_mode: string;
            /** Tier */
            tier: string;
            /**
             * Status
             * @enum {string}
             */
            status: "building" | "ready" | "failed" | "cancelled";
            /** Pipeline Version */
            pipeline_version: string;
            /** Split Seed */
            split_seed: number;
            /**
             * Config
             * @default {}
             */
            config: {
                [key: string]: unknown;
            };
            /** Content Hash */
            content_hash?: string | null;
            /** Path */
            path?: string | null;
            /** Parent Id */
            parent_id?: number | null;
            /**
             * N Examples
             * @default 0
             */
            n_examples: number;
            /**
             * N Train
             * @default 0
             */
            n_train: number;
            /**
             * N Val
             * @default 0
             */
            n_val: number;
            /**
             * N Test
             * @default 0
             */
            n_test: number;
            /** N Excluded */
            n_excluded?: number | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Job Id */
            job_id?: string | null;
            /**
             * N Models
             * @default 0
             */
            n_models: number;
            /** Error */
            error?: string | null;
            /**
             * Is Synthetic
             * @description Built from synthetic TEST light curves
             * @default false
             */
            is_synthetic: boolean;
            /**
             * Compatible
             * @description Built with the running pipeline version
             * @default true
             */
            compatible: boolean;
        };
        /** DatasetStats */
        DatasetStats: {
            /**
             * Per Split
             * @default {}
             */
            per_split: {
                [key: string]: components["schemas"]["SplitCounts"];
            };
            /**
             * N Selected
             * @default 0
             */
            n_selected: number;
            /**
             * N Included
             * @default 0
             */
            n_included: number;
            /**
             * N Excluded
             * @default 0
             */
            n_excluded: number;
            /**
             * N Stars
             * @default 0
             */
            n_stars: number;
            /**
             * N Pos
             * @default 0
             */
            n_pos: number;
            /**
             * N Neg
             * @default 0
             */
            n_neg: number;
            /**
             * Exclusions By Reason
             * @default {}
             */
            exclusions_by_reason: {
                [key: string]: number;
            };
            /**
             * Exclusion Examples
             * @default {}
             */
            exclusion_examples: {
                [key: string]: string[];
            };
            /**
             * Exclusion Reason Labels
             * @default {}
             */
            exclusion_reason_labels: {
                [key: string]: string | null;
            };
            /**
             * Quality Grades
             * @default {}
             */
            quality_grades: {
                [key: string]: number;
            };
            /**
             * Quality Issues
             * @default {}
             */
            quality_issues: {
                [key: string]: number;
            };
            period_hist?: components["schemas"]["Histogram"] | null;
            depth_hist?: components["schemas"]["Histogram"] | null;
            processing?: components["schemas"]["ProcessingStats"] | null;
            /**
             * Downloads
             * @default {}
             */
            downloads: {
                [key: string]: unknown;
            };
            /**
             * Reserved
             * @default []
             */
            reserved: components["schemas"]["ReservedStar"][];
            /**
             * Warnings
             * @default []
             */
            warnings: string[];
            /**
             * Synthetic
             * @default false
             */
            synthetic: boolean;
            /**
             * Timings
             * @default {}
             */
            timings: {
                [key: string]: number;
            };
            /**
             * Manifest
             * @default {}
             */
            manifest: {
                [key: string]: unknown;
            };
        } & {
            [key: string]: unknown;
        };
        /** DatasetSummary */
        DatasetSummary: {
            /** Count */
            count: number;
            /** N Ready */
            n_ready: number;
            latest?: components["schemas"]["DatasetBrief"] | null;
        };
        /** DeviceInfo */
        DeviceInfo: {
            /** Preference */
            preference?: string | null;
            /** Device */
            device?: string | null;
            /** Cuda Available */
            cuda_available?: boolean | null;
            /** Cuda Device */
            cuda_device?: string | null;
            /** Mps Available */
            mps_available?: boolean | null;
            /** Torch */
            torch?: string | null;
            /** Cpu Count */
            cpu_count?: number | null;
            /** Torch Num Threads */
            torch_num_threads?: number | null;
            /** Platform */
            platform?: string | null;
            /** Python */
            python?: string | null;
            /** Error */
            error?: string | null;
        };
        /** DiagnosticsOut */
        DiagnosticsOut: {
            /** Versions */
            versions: {
                [key: string]: string | null;
            };
            /** Paths */
            paths: {
                [key: string]: components["schemas"]["PathInfo"];
            };
            /** Database Url */
            database_url: string;
            storage: components["schemas"]["StorageOut"];
            device: components["schemas"]["DeviceInfo"];
            /** Settings */
            settings: {
                [key: string]: unknown;
            };
            /** Network */
            network?: components["schemas"]["NetworkCheck"][] | null;
            /** Network Checked */
            network_checked: boolean;
        };
        /** DiskInfo */
        DiskInfo: {
            /** Path */
            path: string;
            /** Total */
            total: number;
            /** Used */
            used: number;
            /** Free */
            free: number;
        };
        /** DocPage */
        DocPage: {
            /** Slug */
            slug: string;
            /** Title */
            title: string;
            /** Markdown */
            markdown: string;
        };
        /** DocPageSummary */
        DocPageSummary: {
            /** Slug */
            slug: string;
            /** Title */
            title: string;
            /** Size Bytes */
            size_bytes: number;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * EphemerisIn
         * @description An ephemeris supplied by the user (same time system as the light curve).
         */
        EphemerisIn: {
            /**
             * Period Days
             * @description Orbital period, days
             */
            period_days: number;
            /**
             * Epoch
             * @description Time of a transit centre (BKJD for Kepler data)
             */
            epoch: number;
            /**
             * Duration Hours
             * @description Total transit duration T14, hours
             */
            duration_hours: number;
        };
        /** EphemerisOut */
        EphemerisOut: {
            /** Period Days */
            period_days: number;
            /** Epoch */
            epoch: number;
            /** Duration Hours */
            duration_hours: number;
            /** Depth Ppm */
            depth_ppm?: number | null;
            /**
             * Source
             * @description catalogue | measured (e.g. BLS) | manual
             * @enum {string}
             */
            source: "catalogue" | "measured" | "estimate" | "manual";
            /**
             * Label
             * @description e.g. TCE-010666592-01, BLS, Manual
             * @default
             */
            label: string;
            /**
             * Time System
             * @default BKJD
             */
            time_system: string;
        };
        /** EpochOut */
        EpochOut: {
            /** Epoch */
            epoch: number;
            /** Train Loss */
            train_loss?: number | null;
            /** Val Loss */
            val_loss?: number | null;
            /** Val Pr Auc */
            val_pr_auc?: number | null;
            /** Val Roc Auc */
            val_roc_auc?: number | null;
            /** Val Accuracy */
            val_accuracy?: number | null;
            /** Lr */
            lr?: number | null;
            /** Elapsed S */
            elapsed_s?: number | null;
        };
        /** ErrorOut */
        ErrorOut: {
            /** Detail */
            detail: string;
            /** Code */
            code?: string | null;
            /** Hint */
            hint?: string | null;
        };
        /**
         * EstimateOut
         * @description Measured training speed (a few real training steps on this machine).
         */
        EstimateOut: {
            /** Model Type */
            model_type: string;
            /** Dataset Id */
            dataset_id: number;
            /** N Train */
            n_train: number;
            /** Batches Per Epoch */
            batches_per_epoch: number;
            /** Seconds Per Epoch */
            seconds_per_epoch?: number | null;
            /** Seconds Per Batch */
            seconds_per_batch?: number | null;
            /** Num Threads */
            num_threads?: number | null;
            /** Device */
            device?: string | null;
            /** Max Epochs */
            max_epochs?: number | null;
            /**
             * Ensemble Size
             * @default 1
             */
            ensemble_size: number;
            /** Est Max Total Seconds */
            est_max_total_seconds?: number | null;
            /**
             * Note
             * @default
             */
            note: string;
        } & {
            [key: string]: unknown;
        };
        /** EvaluationCompareOut */
        EvaluationCompareOut: {
            /** Evaluations */
            evaluations: components["schemas"]["EvaluationOut"][];
            /** Metrics */
            metrics: components["schemas"]["CompareRow"][];
            /** Comparable */
            comparable: boolean;
            /**
             * Warnings
             * @default []
             */
            warnings: string[];
        };
        /** EvaluationCreate */
        EvaluationCreate: {
            /** Model Version Id */
            model_version_id: number;
            /**
             * Split
             * @description Test evaluations are logged and counted
             * @default test
             * @enum {string}
             */
            split: "val" | "test";
            /**
             * N Boot
             * @description Bootstrap resamples (whole stars) for the 95 % CIs
             * @default 1000
             */
            n_boot: number;
            /**
             * Seed
             * @default 0
             */
            seed: number;
        };
        /** EvaluationDetailOut */
        EvaluationDetailOut: {
            /** Id */
            id: number;
            /** Model Version Id */
            model_version_id: number;
            /** Model Name */
            model_name?: string | null;
            /** Model Type */
            model_type?: string | null;
            /** Experiment Id */
            experiment_id?: number | null;
            /**
             * Is Fixture
             * @default false
             */
            is_fixture: boolean;
            /** Dataset Id */
            dataset_id: number;
            /** Dataset Name */
            dataset_name?: string | null;
            /** Split */
            split: string;
            /** Threshold */
            threshold: number;
            /** N */
            n?: number | null;
            /** N Pos */
            n_pos?: number | null;
            /** N Neg */
            n_neg?: number | null;
            /**
             * Summary
             * @default {}
             */
            summary: {
                [key: string]: number | null;
            };
            /**
             * Test Evaluation Number
             * @description 1 for the first test evaluation of this model, ...
             */
            test_evaluation_number?: number | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Metrics
             * @default {}
             */
            metrics: {
                [key: string]: unknown;
            };
            /** Metrics At 0 5 */
            metrics_at_0_5?: {
                [key: string]: unknown;
            } | null;
            /**
             * Ci
             * @description {metric: [lo, hi]} 95 % percentile bootstrap
             * @default {}
             */
            ci: {
                [key: string]: number[] | null;
            };
            /** Ci Method */
            ci_method?: {
                [key: string]: unknown;
            } | null;
            /**
             * Curves
             * @description roc, pr, calibration (downsampled)
             * @default {}
             */
            curves: {
                [key: string]: {
                    [key: string]: unknown;
                }[];
            };
            /**
             * Confusion
             * @default {}
             */
            confusion: {
                [key: string]: number;
            };
            /**
             * Timing
             * @default {}
             */
            timing: {
                [key: string]: unknown;
            };
            /**
             * Per Example Available
             * @default false
             */
            per_example_available: boolean;
        };
        /** EvaluationExampleOut */
        EvaluationExampleOut: {
            /** Signal Id */
            signal_id: number;
            /** Kepid */
            kepid: number;
            /** Signal Key */
            signal_key?: string | null;
            /** Label */
            label: number;
            /**
             * Prob
             * @description Calibrated probability of planet-like
             */
            prob: number;
            /** Raw Prob */
            raw_prob: number;
            /** Predicted Label */
            predicted_label: number;
            /** Uncertainty */
            uncertainty?: number | null;
            /**
             * Outcome
             * @enum {string}
             */
            outcome: "tp" | "fp" | "fn" | "tn";
            /** Kepoi Name */
            kepoi_name?: string | null;
            /** Kepler Name */
            kepler_name?: string | null;
            /** Category */
            category?: string | null;
            /** Av Training Set */
            av_training_set?: string | null;
            /** Koi Disposition */
            koi_disposition?: string | null;
            /** Period Days */
            period_days?: number | null;
            /** Duration Hours */
            duration_hours?: number | null;
            /** Depth Ppm */
            depth_ppm?: number | null;
            /** Local View */
            local_view?: (number | null)[] | null;
            /** Local Phase */
            local_phase?: (number | null)[] | null;
        };
        /** EvaluationExamplePage */
        EvaluationExamplePage: {
            /** Total */
            total: number;
            /** Counts */
            counts: {
                [key: string]: number;
            };
            /** Items */
            items: components["schemas"]["EvaluationExampleOut"][];
        };
        /** EvaluationOut */
        EvaluationOut: {
            /** Id */
            id: number;
            /** Model Version Id */
            model_version_id: number;
            /** Model Name */
            model_name?: string | null;
            /** Model Type */
            model_type?: string | null;
            /** Experiment Id */
            experiment_id?: number | null;
            /**
             * Is Fixture
             * @default false
             */
            is_fixture: boolean;
            /** Dataset Id */
            dataset_id: number;
            /** Dataset Name */
            dataset_name?: string | null;
            /** Split */
            split: string;
            /** Threshold */
            threshold: number;
            /** N */
            n?: number | null;
            /** N Pos */
            n_pos?: number | null;
            /** N Neg */
            n_neg?: number | null;
            /**
             * Summary
             * @default {}
             */
            summary: {
                [key: string]: number | null;
            };
            /**
             * Test Evaluation Number
             * @description 1 for the first test evaluation of this model, ...
             */
            test_evaluation_number?: number | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
        };
        /**
         * ExampleViewsOut
         * @description Model views of one example (flux normalised: baseline 0, transit minimum -1).
         */
        ExampleViewsOut: {
            /** Signal Id */
            signal_id: number;
            /** Signal Key */
            signal_key: string;
            /** Kepid */
            kepid: number;
            /** Label */
            label?: number | null;
            /** Split */
            split?: string | null;
            /** Included */
            included: boolean;
            /** Exclusion Reason */
            exclusion_reason?: string | null;
            /** Global */
            global: (number | null)[];
            /** Local */
            local: (number | null)[];
            /**
             * Global Phase
             * @description Bin centres, days from transit centre
             */
            global_phase: (number | null)[];
            /** Local Phase */
            local_phase: (number | null)[];
            /**
             * Quality
             * @default {}
             */
            quality: {
                [key: string]: unknown;
            };
            /**
             * Source
             * @enum {string}
             */
            source: "dataset_arrays" | "view_cache";
        };
        /** ExperimentCompareOut */
        ExperimentCompareOut: {
            /** Experiments */
            experiments: components["schemas"]["ExperimentOut"][];
            /** Config Diff */
            config_diff: components["schemas"]["ConfigDiffRow"][];
            /**
             * Config Same
             * @default {}
             */
            config_same: {
                [key: string]: unknown;
            };
            /** Curves */
            curves: {
                [key: string]: components["schemas"]["EpochOut"][];
            };
            /**
             * Warnings
             * @default []
             */
            warnings: string[];
        };
        /** ExperimentDeleteOut */
        ExperimentDeleteOut: {
            /** Deleted */
            deleted: boolean;
            /** Experiment Id */
            experiment_id: number;
            /**
             * Experiments
             * @default 0
             */
            experiments: number;
            /**
             * Models
             * @default 0
             */
            models: number;
            /**
             * Evaluations
             * @default 0
             */
            evaluations: number;
            /**
             * Predictions
             * @default 0
             */
            predictions: number;
        };
        /** ExperimentDetailOut */
        ExperimentDetailOut: {
            /** Id */
            id: number;
            /** Name */
            name: string;
            /** Model Type */
            model_type: string;
            /** Dataset Id */
            dataset_id: number;
            /** Dataset Name */
            dataset_name?: string | null;
            /** Status */
            status: string;
            /** Seed */
            seed: number;
            /** Device */
            device?: string | null;
            /** Best Epoch */
            best_epoch?: number | null;
            /** Epochs Run */
            epochs_run?: number | null;
            /** Duration S */
            duration_s?: number | null;
            /**
             * Val Summary
             * @default {}
             */
            val_summary: {
                [key: string]: number | null;
            };
            /** Threshold */
            threshold?: number | null;
            /** Model Version Id */
            model_version_id?: number | null;
            /**
             * Is Active Model
             * @default false
             */
            is_active_model: boolean;
            /**
             * Is Fixture
             * @default false
             */
            is_fixture: boolean;
            /**
             * Test Metrics
             * @default {}
             */
            test_metrics: {
                [key: string]: unknown;
            };
            /**
             * Notes
             * @default
             */
            notes: string;
            /**
             * Tags
             * @default []
             */
            tags: string[];
            /**
             * Archived
             * @default false
             */
            archived: boolean;
            /** Job Id */
            job_id?: string | null;
            /** Error */
            error?: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Finished At */
            finished_at?: string | null;
            /**
             * Config
             * @default {}
             */
            config: {
                [key: string]: unknown;
            };
            /**
             * Environment
             * @default {}
             */
            environment: {
                [key: string]: unknown;
            };
            /**
             * Val Metrics
             * @default {}
             */
            val_metrics: {
                [key: string]: unknown;
            };
            /**
             * Epochs
             * @description Per-epoch metrics (ensemble members are numbered consecutively)
             * @default []
             */
            epochs: components["schemas"]["EpochOut"][];
            /**
             * History
             * @description Full per-epoch records from the checkpoint (incl. member)
             * @default []
             */
            history: {
                [key: string]: unknown;
            }[];
            model_version?: components["schemas"]["ModelVersionOut"] | null;
            /**
             * Evaluations
             * @default []
             */
            evaluations: components["schemas"]["EvaluationOut"][];
        };
        /** ExperimentOut */
        ExperimentOut: {
            /** Id */
            id: number;
            /** Name */
            name: string;
            /** Model Type */
            model_type: string;
            /** Dataset Id */
            dataset_id: number;
            /** Dataset Name */
            dataset_name?: string | null;
            /** Status */
            status: string;
            /** Seed */
            seed: number;
            /** Device */
            device?: string | null;
            /** Best Epoch */
            best_epoch?: number | null;
            /** Epochs Run */
            epochs_run?: number | null;
            /** Duration S */
            duration_s?: number | null;
            /**
             * Val Summary
             * @default {}
             */
            val_summary: {
                [key: string]: number | null;
            };
            /** Threshold */
            threshold?: number | null;
            /** Model Version Id */
            model_version_id?: number | null;
            /**
             * Is Active Model
             * @default false
             */
            is_active_model: boolean;
            /**
             * Is Fixture
             * @default false
             */
            is_fixture: boolean;
            /**
             * Test Metrics
             * @default {}
             */
            test_metrics: {
                [key: string]: unknown;
            };
            /**
             * Notes
             * @default
             */
            notes: string;
            /**
             * Tags
             * @default []
             */
            tags: string[];
            /**
             * Archived
             * @default false
             */
            archived: boolean;
            /** Job Id */
            job_id?: string | null;
            /** Error */
            error?: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Finished At */
            finished_at?: string | null;
        };
        /** ExperimentPatch */
        ExperimentPatch: {
            /** Name */
            name?: string | null;
            /** Notes */
            notes?: string | null;
            /** Tags */
            tags?: string[] | null;
            /** Archived */
            archived?: boolean | null;
        };
        /** FeatureImportanceOut */
        FeatureImportanceOut: {
            /** Evaluation Id */
            evaluation_id: number;
            /** Model Version Id */
            model_version_id: number;
            /** Model Type */
            model_type: string;
            /** Split */
            split: string;
            /** N Examples */
            n_examples: number;
            /** Metric */
            metric: string;
            /** Baseline Score */
            baseline_score?: number | null;
            /** N Repeats */
            n_repeats: number;
            /** Seed */
            seed: number;
            /** Method */
            method: string;
            /** Features */
            features: components["schemas"]["FeatureImportanceRow"][];
            /**
             * Intrinsic
             * @default []
             */
            intrinsic: {
                [key: string]: unknown;
            }[];
            /**
             * Intrinsic Meaning
             * @default
             */
            intrinsic_meaning: string;
            /**
             * Is Fixture
             * @default false
             */
            is_fixture: boolean;
        };
        /** FeatureImportanceRow */
        FeatureImportanceRow: {
            /** Feature */
            feature: string;
            /** Label */
            label: string;
            /** N Columns */
            n_columns: number;
            /** Importance Mean */
            importance_mean?: number | null;
            /** Importance Std */
            importance_std?: number | null;
        };
        /** FoldedOut */
        FoldedOut: {
            /** Phase */
            phase: (number | null)[];
            /** Flux */
            flux: (number | null)[];
            /**
             * N Original
             * @default 0
             */
            n_original: number;
            binned: components["schemas"]["BinnedSeries"];
        };
        /** FpFlags */
        FpFlags: {
            /** Nt */
            nt?: number | null;
            /** Ss */
            ss?: number | null;
            /** Co */
            co?: number | null;
            /** Ec */
            ec?: number | null;
        };
        /** GalleryItem */
        GalleryItem: {
            /** Signal Id */
            signal_id: number;
            /** Signal Key */
            signal_key: string;
            /** Kepid */
            kepid: number;
            /** Label */
            label: number;
            /** Split */
            split: string;
            /** Period Days */
            period_days?: number | null;
            /** Depth Ppm */
            depth_ppm?: number | null;
            /** Kepler Name */
            kepler_name?: string | null;
            /**
             * Global
             * @description Global view downsampled to 401 bins
             */
            global: (number | null)[];
            /** Local */
            local: (number | null)[];
        };
        /** GalleryOut */
        GalleryOut: {
            /** Dataset Id */
            dataset_id: number;
            /** Per Class */
            per_class: number;
            /** Seed */
            seed: number;
            /**
             * Classes
             * @description Keys: planet_like, false_positive_like
             */
            classes: {
                [key: string]: components["schemas"]["GalleryItem"][];
            };
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /**
         * Histogram
         * @description Histogram of log10(value) per class on shared edges.
         */
        Histogram: {
            /** Log10 Edges */
            log10_edges: number[];
            /** Counts */
            counts: {
                [key: string]: number[];
            };
            /**
             * Unit
             * @default
             */
            unit: string;
        };
        /** HistogramOut */
        HistogramOut: {
            /**
             * Key
             * @description log10_period | log10_depth | log10_snr
             */
            key: string;
            /** Label */
            label: string;
            /** Unit */
            unit: string;
            /** Edges */
            edges: number[];
            /**
             * Counts
             * @description category -> counts per bin
             */
            counts: {
                [key: string]: number[];
            };
            /**
             * N Missing
             * @description category -> signals without a positive value
             */
            n_missing: {
                [key: string]: number;
            };
        };
        /** InjectedOut */
        InjectedOut: {
            /** Period Days */
            period_days: number;
            /** Epoch */
            epoch: number;
            /** Duration Hours */
            duration_hours: number;
            /** Depth Ppm */
            depth_ppm: number;
            /** Ingress Fraction */
            ingress_fraction: number;
            /** Model */
            model: string;
            /** N Transits In Data */
            n_transits_in_data: number;
            /** Snr At Injected Ephemeris */
            snr_at_injected_ephemeris?: number | null;
        };
        /** InjectionCriteria */
        InjectionCriteria: {
            /** Period Rel Tol */
            period_rel_tol: number;
            /** Epoch Tol Hours */
            epoch_tol_hours: number;
            /** Period Match */
            period_match: boolean;
            /** Epoch Match */
            epoch_match: boolean;
            /** Epoch Offset Hours */
            epoch_offset_hours: number;
            /** Alias Of Injected */
            alias_of_injected?: string | null;
            /**
             * Matches Known Signal
             * @description Set when a failed search locked onto a known signal of the star
             */
            matches_known_signal?: string | null;
            /** Depth Ratio */
            depth_ratio?: number | null;
        };
        /** InjectionIn */
        InjectionIn: {
            /** Kepid */
            kepid: number;
            /** Period Days */
            period_days: number;
            /** Depth Ppm */
            depth_ppm: number;
            /** Duration Hours */
            duration_hours: number;
            /**
             * Epoch
             * @description BKJD; default: data start + 0.37 P
             */
            epoch?: number | null;
            /**
             * Ingress Fraction
             * @default 0.1
             */
            ingress_fraction: number;
        };
        /** InjectionOut */
        InjectionOut: {
            /**
             * Synthetic
             * @default true
             * @constant
             */
            synthetic: true;
            /** Label */
            label: string;
            /** Kepid */
            kepid: number;
            injected: components["schemas"]["InjectedOut"];
            recovered: components["schemas"]["RecoveredOut"];
            /** Recovered Ok */
            recovered_ok: boolean;
            criteria: components["schemas"]["InjectionCriteria"];
            /** Masked Known Signals */
            masked_known_signals: components["schemas"]["EphemerisOut"][];
            /**
             * Warnings
             * @default []
             */
            warnings: string[];
            /** N Cadences Masked */
            n_cadences_masked: number;
            periodogram: components["schemas"]["Periodogram"];
            folded_injected: components["schemas"]["BinnedSeries"];
            /** Pipeline Version */
            pipeline_version: string;
            /** Compute Ms */
            compute_ms: number;
        };
        /** JobOut */
        JobOut: {
            /** Id */
            id: string;
            /** Kind */
            kind: string;
            /** Title */
            title: string;
            /**
             * Status
             * @enum {string}
             */
            status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
            /** Progress */
            progress: number;
            /** Message */
            message?: string | null;
            /**
             * Params
             * @default {}
             */
            params: {
                [key: string]: unknown;
            };
            /** Result */
            result?: {
                [key: string]: unknown;
            } | null;
            /** Error */
            error?: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Started At */
            started_at?: string | null;
            /** Finished At */
            finished_at?: string | null;
            /** Eta S */
            eta_s?: number | null;
            /** Log Tail */
            log_tail?: string | null;
        };
        /**
         * LightCurveOut
         * @description Processed light curve for display (catalogue star or parsed upload).
         */
        LightCurveOut: {
            source: components["schemas"]["SourceOut"];
            /** Kepid */
            kepid?: number | null;
            /** Upload Id */
            upload_id?: string | null;
            /** Signal Id */
            signal_id?: number | null;
            /** Time System */
            time_system: string;
            /** Mission */
            mission: string;
            /**
             * N Cadences
             * @description Cadences in the stored light curve (before cleaning)
             */
            n_cadences: number;
            /**
             * N Points Final
             * @description Cadences after cleaning, detrending and clipping
             */
            n_points_final: number;
            /** Quarters */
            quarters: number[];
            /** Segments */
            segments: components["schemas"]["SegmentOut"][];
            /**
             * Cleaning
             * @description clean/detrend/clip reports from the pipeline
             */
            cleaning: {
                [key: string]: unknown;
            };
            stages: components["schemas"]["StagesOut"];
            /**
             * Transit Times
             * @description Predicted transit centres inside the data span (when an ephemeris is known)
             */
            transit_times?: (number | null)[] | null;
            folded?: components["schemas"]["FoldedOut"] | null;
            ephemeris?: components["schemas"]["EphemerisOut"] | null;
            /** @description Only when a catalogue signal is given */
            quality?: components["schemas"]["QualityOut"] | null;
            /** Detrend */
            detrend: string;
            /** Max Points */
            max_points: number;
            /** Pipeline Version */
            pipeline_version: string;
            /** Config */
            config: {
                [key: string]: unknown;
            };
            /**
             * Warnings
             * @default []
             */
            warnings: string[];
            /** Processing Ms */
            processing_ms: number;
            /**
             * Cached
             * @default false
             */
            cached: boolean;
        };
        /** LightCurveSummary */
        LightCurveSummary: {
            /** Available */
            available: number;
            /** No Data */
            no_data: number;
            /** Error */
            error: number;
            /** Downloading */
            downloading: number;
            /** Queued */
            queued: number;
            /** Not Downloaded */
            not_downloaded: number;
            /** Disk Bytes */
            disk_bytes: number;
        };
        /** ModelBrief */
        ModelBrief: {
            /** Id */
            id: number;
            /** Name */
            name: string;
            /** Model Type */
            model_type: string;
            /** Dataset Id */
            dataset_id?: number | null;
            /** Dataset Name */
            dataset_name?: string | null;
            /** Is Active */
            is_active: boolean;
            /** Is Fixture */
            is_fixture: boolean;
            /** Threshold */
            threshold?: number | null;
            /**
             * Val Metrics
             * @default {}
             */
            val_metrics: {
                [key: string]: unknown;
            };
            /**
             * Test Metrics
             * @default {}
             */
            test_metrics: {
                [key: string]: unknown;
            };
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
        };
        /**
         * ModelCardOut
         * @description Description of a model type (from :mod:`exofinder.ml.model_cards`).
         */
        ModelCardOut: {
            /**
             * Type
             * @enum {string}
             */
            type: "logreg" | "random_forest" | "cnn_single" | "cnn_two_view";
            /** Name */
            name: string;
            /** Description */
            description: string;
            /**
             * Inputs
             * @default []
             */
            inputs: string[];
            /**
             * Strengths
             * @default []
             */
            strengths: string[];
            /**
             * Limitations
             * @default []
             */
            limitations: string[];
            /**
             * Architecture
             * @default []
             */
            architecture: string[];
            /** Uncertainty */
            uncertainty?: string | null;
            /** Training */
            training?: string | null;
            /**
             * Default Config
             * @default {}
             */
            default_config: {
                [key: string]: unknown;
            };
            /**
             * N Params
             * @description Exact count for the default CNN geometry; None for baselines
             */
            n_params?: number | null;
            /** Reference */
            reference?: string | null;
        } & {
            [key: string]: unknown;
        };
        /** ModelCurve */
        ModelCurve: {
            /** Phase */
            phase: (number | null)[];
            /** Flux */
            flux: (number | null)[];
            /** Model */
            model: string;
        };
        /** ModelDeleteOut */
        ModelDeleteOut: {
            /** Deleted */
            deleted: boolean;
            /** Model Id */
            model_id: number;
            /**
             * Models
             * @default 0
             */
            models: number;
            /**
             * Evaluations
             * @default 0
             */
            evaluations: number;
            /**
             * Predictions
             * @default 0
             */
            predictions: number;
            /** Active Model Id */
            active_model_id?: number | null;
        };
        /** ModelDetailOut */
        ModelDetailOut: {
            /** Id */
            id: number;
            /** Name */
            name: string;
            /** Model Type */
            model_type: string;
            /** Model Type Name */
            model_type_name: string;
            /** Experiment Id */
            experiment_id?: number | null;
            /** Dataset Id */
            dataset_id?: number | null;
            /** Dataset Name */
            dataset_name?: string | null;
            /** Pipeline Version */
            pipeline_version: string;
            /**
             * Compatible
             * @description Trained with the running pipeline version
             */
            compatible: boolean;
            /** Checkpoint Path */
            checkpoint_path: string;
            /** Checkpoint Exists */
            checkpoint_exists: boolean;
            /**
             * Threshold
             * @description Decision threshold (F1-optimal on validation)
             */
            threshold: number;
            /** Temperature */
            temperature: number;
            /** Ensemble Size */
            ensemble_size: number;
            /** N Params */
            n_params?: number | null;
            /** Is Active */
            is_active: boolean;
            /**
             * Is Fixture
             * @description TEST FIXTURE trained on synthetic data: never a scientific result
             */
            is_fixture: boolean;
            /**
             * Val Metrics
             * @default {}
             */
            val_metrics: {
                [key: string]: unknown;
            };
            /**
             * Test Metrics
             * @description Metrics of the latest test-set evaluation (empty if none)
             * @default {}
             */
            test_metrics: {
                [key: string]: unknown;
            };
            /**
             * N Evaluations
             * @default 0
             */
            n_evaluations: number;
            /**
             * N Test Evaluations
             * @default 0
             */
            n_test_evaluations: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Model Card
             * @default {}
             */
            model_card: {
                [key: string]: unknown;
            };
            /**
             * Config
             * @default {}
             */
            config: {
                [key: string]: unknown;
            };
            /**
             * Bundle
             * @description Selected checkpoint metadata (best params, CV results, top features...)
             * @default {}
             */
            bundle: {
                [key: string]: unknown;
            };
            /** Bundle Error */
            bundle_error?: string | null;
            /**
             * Checkpoint Bytes
             * @default 0
             */
            checkpoint_bytes: number;
            training: components["schemas"]["TrainingSummary"];
            /**
             * Evaluations
             * @default []
             */
            evaluations: components["schemas"]["ModelEvaluationRef"][];
        };
        /** ModelEvaluationRef */
        ModelEvaluationRef: {
            /** Id */
            id: number;
            /** Split */
            split: string;
            /** Dataset Id */
            dataset_id: number;
            /** Threshold */
            threshold: number;
            /** Pr Auc */
            pr_auc?: number | null;
            /** Roc Auc */
            roc_auc?: number | null;
            /** F1 */
            f1?: number | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
        };
        /** ModelSummary */
        ModelSummary: {
            /** Count */
            count: number;
            /**
             * N Real
             * @description Models that are not test fixtures
             */
            n_real: number;
            active?: components["schemas"]["ModelBrief"] | null;
            /** Default Model Id */
            default_model_id?: number | null;
            default_for_predictions?: components["schemas"]["ModelBrief"] | null;
        };
        /** ModelVersionOut */
        ModelVersionOut: {
            /** Id */
            id: number;
            /** Name */
            name: string;
            /** Model Type */
            model_type: string;
            /** Model Type Name */
            model_type_name: string;
            /** Experiment Id */
            experiment_id?: number | null;
            /** Dataset Id */
            dataset_id?: number | null;
            /** Dataset Name */
            dataset_name?: string | null;
            /** Pipeline Version */
            pipeline_version: string;
            /**
             * Compatible
             * @description Trained with the running pipeline version
             */
            compatible: boolean;
            /** Checkpoint Path */
            checkpoint_path: string;
            /** Checkpoint Exists */
            checkpoint_exists: boolean;
            /**
             * Threshold
             * @description Decision threshold (F1-optimal on validation)
             */
            threshold: number;
            /** Temperature */
            temperature: number;
            /** Ensemble Size */
            ensemble_size: number;
            /** N Params */
            n_params?: number | null;
            /** Is Active */
            is_active: boolean;
            /**
             * Is Fixture
             * @description TEST FIXTURE trained on synthetic data: never a scientific result
             */
            is_fixture: boolean;
            /**
             * Val Metrics
             * @default {}
             */
            val_metrics: {
                [key: string]: unknown;
            };
            /**
             * Test Metrics
             * @description Metrics of the latest test-set evaluation (empty if none)
             * @default {}
             */
            test_metrics: {
                [key: string]: unknown;
            };
            /**
             * N Evaluations
             * @default 0
             */
            n_evaluations: number;
            /**
             * N Test Evaluations
             * @default 0
             */
            n_test_evaluations: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
        };
        /** NetworkCheck */
        NetworkCheck: {
            /** Name */
            name: string;
            /** Url */
            url: string;
            /** Ok */
            ok: boolean;
            /** Status Code */
            status_code?: number | null;
            /** Elapsed Ms */
            elapsed_ms: number;
            /** Error */
            error?: string | null;
        };
        /** NextStep */
        NextStep: {
            /** Key */
            key: string;
            /** Title */
            title: string;
            /** Description */
            description: string;
            /** Done */
            done: boolean;
            /**
             * Page
             * @description UI area: catalog | targets | datasets | training | evaluation | predict
             */
            page: string;
            action?: components["schemas"]["StepAction"] | null;
        };
        /**
         * PValue
         * @description Provenance-tagged value (``ProvenancedValue`` plus an optional note on assumptions).
         */
        PValue: {
            /** Value */
            value: number | null;
            /** Err */
            err?: number | null;
            /**
             * Unit
             * @default
             */
            unit: string;
            /**
             * Provenance
             * @enum {string}
             */
            provenance: "catalogue" | "measured" | "estimate" | "manual";
            /**
             * Source
             * @default
             */
            source: string;
            /** Note */
            note?: string | null;
        };
        /** ParseIn */
        ParseIn: {
            mapping?: components["schemas"]["ColumnMapping"] | null;
            /**
             * Time System
             * @description BKJD (Kepler, BJD-2454833), BJD (converted to BKJD), BTJD (TESS, BJD-2457000) or other (relative days). FITS files that declare BKJD/BTJD in their header keep it.
             */
            time_system?: ("BKJD" | "BJD" | "BTJD" | "other") | null;
        };
        /** ParseOut */
        ParseOut: {
            /** Mapping */
            mapping?: {
                [key: string]: string | null;
            } | null;
            /**
             * Time System
             * @description Time system of the stored times (BKJD/BTJD/unknown)
             */
            time_system?: string | null;
            /**
             * Input Time System
             * @description Time system the input was declared in
             */
            input_time_system?: string | null;
            /** N Points */
            n_points: number;
            /** Time Span Days */
            time_span_days: number;
            /** Time Start */
            time_start?: number | null;
            /** Time End */
            time_end?: number | null;
            /** Cadence Days */
            cadence_days?: number | null;
            /** Mission */
            mission?: string | null;
            /** Kepid */
            kepid?: number | null;
            /**
             * Warnings
             * @default []
             */
            warnings: string[];
            /**
             * Out Of Distribution
             * @default false
             */
            out_of_distribution: boolean;
            /** Parsed At */
            parsed_at?: string | null;
            /** Upload Id */
            upload_id: string;
        };
        /** ParsedInfo */
        ParsedInfo: {
            /** Mapping */
            mapping?: {
                [key: string]: string | null;
            } | null;
            /**
             * Time System
             * @description Time system of the stored times (BKJD/BTJD/unknown)
             */
            time_system?: string | null;
            /**
             * Input Time System
             * @description Time system the input was declared in
             */
            input_time_system?: string | null;
            /** N Points */
            n_points: number;
            /** Time Span Days */
            time_span_days: number;
            /** Time Start */
            time_start?: number | null;
            /** Time End */
            time_end?: number | null;
            /** Cadence Days */
            cadence_days?: number | null;
            /** Mission */
            mission?: string | null;
            /** Kepid */
            kepid?: number | null;
            /**
             * Warnings
             * @default []
             */
            warnings: string[];
            /**
             * Out Of Distribution
             * @default false
             */
            out_of_distribution: boolean;
            /** Parsed At */
            parsed_at?: string | null;
        };
        /** PathInfo */
        PathInfo: {
            /** Path */
            path: string;
            /** Exists */
            exists: boolean;
            /** Writable */
            writable: boolean;
        };
        /** Periodogram */
        Periodogram: {
            /** Periods */
            periods: (number | null)[];
            /** Power */
            power: (number | null)[];
        };
        /**
         * PipelineOptions
         * @description Preprocessing options a user may change for a dataset build.
         */
        PipelineOptions: {
            /**
             * Detrend Method
             * @default spline
             * @enum {string}
             */
            detrend_method: "spline" | "savgol";
        };
        /** PredictIn */
        PredictIn: {
            /**
             * Model Version Ids
             * @description Models to run (default: settings default_model_id, else the active model)
             */
            model_version_ids?: number[] | null;
            /** Source */
            source: components["schemas"]["CatalogPredictionSource"] | components["schemas"]["UploadPredictionSource"];
            /** @description Required with ephemeris_source 'manual' */
            ephemeris?: components["schemas"]["EphemerisIn"] | null;
            /**
             * Ephemeris Source
             * @default catalog
             * @enum {string}
             */
            ephemeris_source: "catalog" | "bls" | "manual";
            /**
             * Download If Missing
             * @description Catalogue stars only: download the light curve synchronously if it is not cached (otherwise 409 code=not_downloaded)
             * @default true
             */
            download_if_missing: boolean;
        };
        /** PredictResponse */
        PredictResponse: {
            /** Results */
            results: components["schemas"]["PredictionOut"][];
            views: components["schemas"]["ViewsOut"];
            quality: components["schemas"]["QualityOut"];
            /** Ephemeris */
            ephemeris: {
                [key: string]: unknown;
            };
            /**
             * Features
             * @description Physical features measured from the light curve
             */
            features: {
                [key: string]: number | null;
            };
            catalog_labels?: components["schemas"]["CatalogLabels"] | null;
            signal?: components["schemas"]["SignalOut"] | null;
            source: components["schemas"]["SourceOut"];
            /**
             * Warnings
             * @default []
             */
            warnings: string[];
            /** Disclaimer */
            disclaimer: string;
            /** Pipeline Version */
            pipeline_version: string;
        };
        /** PredictionDetailOut */
        PredictionDetailOut: {
            /** Id */
            id: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Model Version Id */
            model_version_id: number;
            /** Model Name */
            model_name: string;
            /** Model Type */
            model_type?: string | null;
            /**
             * Is Fixture Model
             * @description True: a synthetic test fixture, never a real result
             */
            is_fixture_model: boolean;
            /**
             * Probability
             * @description Calibrated P(planet-like)
             */
            probability: number;
            /**
             * Raw Probability
             * @description Uncalibrated model probability
             */
            raw_probability: number;
            /**
             * Predicted Label
             * @description 1 planet-like, 0 false-positive-like (at `threshold`)
             */
            predicted_label: number;
            /** Predicted Class */
            predicted_class: string;
            /** Threshold */
            threshold?: number | null;
            /**
             * Threshold Mode
             * @description validation_f1 | fixed_0.5
             */
            threshold_mode?: string | null;
            /**
             * Uncertainty
             * @description Std of probabilities (ensemble / MC dropout / tree votes)
             */
            uncertainty?: number | null;
            /** Uncertainty Method */
            uncertainty_method?: string | null;
            /**
             * Member Probabilities
             * @default []
             */
            member_probabilities: number[];
            /**
             * Seen In Split
             * @description Split of this star in the model's dataset; null = not in it
             */
            seen_in_split?: ("train" | "val" | "test") | null;
            /** Inference Ms */
            inference_ms?: number | null;
            /**
             * Source Type
             * @description catalog | fits | csv
             */
            source_type: string;
            /** Kepid */
            kepid?: number | null;
            /** Signal Id */
            signal_id?: number | null;
            /** Signal Key */
            signal_key?: string | null;
            /** Input Name */
            input_name: string;
            /** Ephemeris */
            ephemeris?: {
                [key: string]: unknown;
            } | null;
            /** Quality Grade */
            quality_grade?: string | null;
            /** Quality Ok */
            quality_ok?: boolean | null;
            catalog_labels?: components["schemas"]["CatalogLabels"] | null;
            /** Batch Job Id */
            batch_job_id?: string | null;
            /** Pipeline Version */
            pipeline_version?: string | null;
            views?: components["schemas"]["ViewsOut"] | null;
            /** Views Source */
            views_source?: string | null;
            /** Features */
            features?: {
                [key: string]: number | null;
            } | null;
            /**
             * Quality
             * @default {}
             */
            quality: {
                [key: string]: unknown;
            };
            signal?: components["schemas"]["SignalOut"] | null;
            /**
             * Warnings
             * @default []
             */
            warnings: string[];
            /** Disclaimer */
            disclaimer: string;
        };
        /** PredictionOut */
        PredictionOut: {
            /** Id */
            id: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Model Version Id */
            model_version_id: number;
            /** Model Name */
            model_name: string;
            /** Model Type */
            model_type?: string | null;
            /**
             * Is Fixture Model
             * @description True: a synthetic test fixture, never a real result
             */
            is_fixture_model: boolean;
            /**
             * Probability
             * @description Calibrated P(planet-like)
             */
            probability: number;
            /**
             * Raw Probability
             * @description Uncalibrated model probability
             */
            raw_probability: number;
            /**
             * Predicted Label
             * @description 1 planet-like, 0 false-positive-like (at `threshold`)
             */
            predicted_label: number;
            /** Predicted Class */
            predicted_class: string;
            /** Threshold */
            threshold?: number | null;
            /**
             * Threshold Mode
             * @description validation_f1 | fixed_0.5
             */
            threshold_mode?: string | null;
            /**
             * Uncertainty
             * @description Std of probabilities (ensemble / MC dropout / tree votes)
             */
            uncertainty?: number | null;
            /** Uncertainty Method */
            uncertainty_method?: string | null;
            /**
             * Member Probabilities
             * @default []
             */
            member_probabilities: number[];
            /**
             * Seen In Split
             * @description Split of this star in the model's dataset; null = not in it
             */
            seen_in_split?: ("train" | "val" | "test") | null;
            /** Inference Ms */
            inference_ms?: number | null;
            /**
             * Source Type
             * @description catalog | fits | csv
             */
            source_type: string;
            /** Kepid */
            kepid?: number | null;
            /** Signal Id */
            signal_id?: number | null;
            /** Signal Key */
            signal_key?: string | null;
            /** Input Name */
            input_name: string;
            /** Ephemeris */
            ephemeris?: {
                [key: string]: unknown;
            } | null;
            /** Quality Grade */
            quality_grade?: string | null;
            /** Quality Ok */
            quality_ok?: boolean | null;
            catalog_labels?: components["schemas"]["CatalogLabels"] | null;
            /** Batch Job Id */
            batch_job_id?: string | null;
            /** Pipeline Version */
            pipeline_version?: string | null;
        };
        /** PredictionPage */
        PredictionPage: {
            /** Total */
            total: number;
            /** Limit */
            limit: number;
            /** Offset */
            offset: number;
            /** Items */
            items: components["schemas"]["PredictionOut"][];
        };
        /** PredictionSummary */
        PredictionSummary: {
            /** Count */
            count: number;
            /** Recent */
            recent: components["schemas"]["PredictionOut"][];
        };
        /** ProcessingStats */
        ProcessingStats: {
            /** Mode */
            mode: string;
            /** Workers */
            workers: number;
            /** N Signals */
            n_signals: number;
            /** N Computed */
            n_computed: number;
            /** N From Cache */
            n_from_cache: number;
            /** N Errors */
            n_errors: number;
            /** Wall S */
            wall_s: number;
            /** Sum Task S */
            sum_task_s: number;
            /** Mean Task S */
            mean_task_s?: number | null;
            /**
             * Effective Speedup
             * @description Sum of per-signal processing times / wall time
             */
            effective_speedup?: number | null;
            /**
             * Worker Pids
             * @default 0
             */
            worker_pids: number;
            /** Fallback Reason */
            fallback_reason?: string | null;
        };
        /**
         * QualityOut
         * @description Signal-level data-quality report (``ok`` False: do not trust a score on this signal).
         */
        QualityOut: {
            /** Ok */
            ok: boolean;
            /**
             * Grade
             * @enum {string}
             */
            grade: "A" | "B" | "C" | "D";
            /**
             * N Transits Expected
             * @default 0
             */
            n_transits_expected: number;
            /**
             * N Transits Observed
             * @default 0
             */
            n_transits_observed: number;
            /**
             * In Transit Points
             * @default 0
             */
            in_transit_points: number;
            /**
             * Global Empty Frac
             * @default 0
             */
            global_empty_frac: number | null;
            /**
             * Local Empty Frac
             * @default 0
             */
            local_empty_frac: number | null;
            /** Alignment Offset Durations */
            alignment_offset_durations?: number | null;
            /** Depth Ratio Vs Catalogue */
            depth_ratio_vs_catalogue?: number | null;
            /**
             * Issues
             * @default []
             */
            issues: string[];
            /**
             * Messages
             * @default []
             */
            messages: string[];
        };
        /** RecoveredOut */
        RecoveredOut: {
            /** Period Days */
            period_days: number;
            /** Epoch */
            epoch: number;
            /** Duration Hours */
            duration_hours: number;
            /** Depth Ppm */
            depth_ppm?: number | null;
            /** Depth Err Ppm */
            depth_err_ppm?: number | null;
            /** Snr */
            snr?: number | null;
            /** Sde */
            sde?: number | null;
            /** N Transits */
            n_transits: number;
            /** Method */
            method: string;
            /**
             * Provenance
             * @default measured
             * @constant
             */
            provenance: "measured";
        };
        /** RefreshIn */
        RefreshIn: {
            /**
             * Sources
             * @description Subset of dr24_tce, koi_cumulative, confirmed, stellar (default: all). Others reuse their latest snapshot.
             */
            sources?: string[] | null;
        };
        /** ReservedStar */
        ReservedStar: {
            /** Kepid */
            kepid: number;
            /** Name */
            name?: string | null;
            /** N Signals */
            n_signals: number;
            /** N Included */
            n_included: number;
        };
        /** SegmentOut */
        SegmentOut: {
            /**
             * Id
             * @description Kepler quarter, or gap-based segment id for uploads
             */
            id: number;
            /** T Start */
            t_start: number;
            /** T End */
            t_end: number;
            /** N Cadences */
            n_cadences: number;
            /**
             * N Used
             * @description Cadences kept after cleaning/detrending
             */
            n_used: number;
        };
        /** Series */
        Series: {
            /** Time */
            time: (number | null)[];
            /** Flux */
            flux: (number | null)[];
            /**
             * N Original
             * @description Number of points before display downsampling
             * @default 0
             */
            n_original: number;
        };
        /** SettingDescription */
        SettingDescription: {
            /** Description */
            description: string;
            /**
             * Kind
             * @description choice | int | bool | optional_int
             */
            kind: string;
            /** Choices */
            choices?: unknown[] | null;
            /** Minimum */
            minimum?: number | null;
            /** Maximum */
            maximum?: number | null;
        };
        /** SettingsOut */
        SettingsOut: {
            /**
             * Values
             * @description Effective values (stored override, else default)
             */
            values: {
                [key: string]: unknown;
            };
            /** Defaults */
            defaults: {
                [key: string]: unknown;
            };
            /** Descriptions */
            descriptions: {
                [key: string]: components["schemas"]["SettingDescription"];
            };
        };
        /**
         * SignalOut
         * @description A catalogue transit-like signal. All values are catalogue values exactly as published.
         */
        SignalOut: {
            /** Id */
            id: number;
            /**
             * Signal Key
             * @description TCE-<kic9>-<nn> | KOI-<kepoi_name> | PL-<Kepler name>
             */
            signal_key: string;
            /** Kepid */
            kepid: number;
            /** Primary Source */
            primary_source: string;
            /** Tce Plnt Num */
            tce_plnt_num?: number | null;
            /** Kepoi Name */
            kepoi_name?: string | null;
            /** Kepler Name */
            kepler_name?: string | null;
            /** Period Days */
            period_days?: number | null;
            /** Epoch Bkjd */
            epoch_bkjd?: number | null;
            /** Duration Hours */
            duration_hours?: number | null;
            /** Depth Ppm */
            depth_ppm?: number | null;
            /** Model Snr */
            model_snr?: number | null;
            /** Planet Radius Re */
            planet_radius_re?: number | null;
            /**
             * Av Training Set
             * @description DR24 Autovetter label: PC | AFP | NTP | UNK
             */
            av_training_set?: string | null;
            /**
             * Koi Disposition
             * @description CONFIRMED | CANDIDATE | FALSE POSITIVE
             */
            koi_disposition?: string | null;
            /** Koi Pdisposition */
            koi_pdisposition?: string | null;
            /**
             * Koi Score
             * @description Display only; never a model feature
             */
            koi_score?: number | null;
            /** @default {} */
            fpflags: components["schemas"]["FpFlags"];
            /**
             * Category
             * @description confirmed | candidate | false_positive | unknown | retired
             */
            category: string;
            /**
             * Label Conflict
             * @default false
             */
            label_conflict: boolean;
            /** Match Status */
            match_status?: string | null;
            /** Kepler Host Name */
            kepler_host_name?: string | null;
            /**
             * Lc Status
             * @description Light-curve status of the star
             */
            lc_status?: string | null;
            /**
             * Provenance
             * @description Per-field provenance (detail views only)
             */
            provenance?: {
                [key: string]: unknown;
            } | null;
        };
        /** SignalPage */
        SignalPage: {
            /** Total */
            total: number;
            /** Limit */
            limit: number;
            /** Offset */
            offset: number;
            /** Items */
            items: components["schemas"]["SignalOut"][];
        };
        /**
         * SnapshotOut
         * @description One verbatim retrieval of a NASA Exoplanet Archive table (provenance record).
         */
        SnapshotOut: {
            /** Id */
            id: number;
            /**
             * Source
             * @description dr24_tce | koi_cumulative | confirmed | stellar
             */
            source: string;
            /** Table Name */
            table_name: string;
            /**
             * Query
             * @description Exact ADQL text
             */
            query: string;
            /**
             * Url
             * @description Equivalent TAP GET URL
             */
            url: string;
            /**
             * Retrieved At
             * Format: date-time
             */
            retrieved_at: string;
            /** Row Count */
            row_count: number;
            /** Sha256 */
            sha256: string;
            /** File Path */
            file_path: string;
            /**
             * Validation
             * @default {}
             */
            validation: {
                [key: string]: unknown;
            };
        };
        /** SourceOut */
        SourceOut: {
            /**
             * Type
             * @enum {string}
             */
            type: "catalog" | "upload";
            /** Kepid */
            kepid?: number | null;
            /** Upload Id */
            upload_id?: string | null;
            /** Upload Kind */
            upload_kind?: string | null;
            /** Input Name */
            input_name: string;
            /** Time System */
            time_system: string;
            /** N Cadences */
            n_cadences: number;
        };
        /** SplitCounts */
        SplitCounts: {
            /** N */
            n: number;
            /** N Pos */
            n_pos: number;
            /** N Neg */
            n_neg: number;
            /** N Stars */
            n_stars: number;
        };
        /** StagesOut */
        StagesOut: {
            /** @description Cached flux (per-quarter normalised), before cleaning */
            raw?: components["schemas"]["Series"] | null;
            /** @description Cleaned, each segment divided by its median */
            normalized?: components["schemas"]["Series"] | null;
            /** @description Fitted trend model on the normalised curve */
            trend?: components["schemas"]["Series"] | null;
            /** @description Detrended (normalised / trend), upper outliers clipped */
            flat?: components["schemas"]["Series"] | null;
        };
        /** StellarOut */
        StellarOut: {
            teff: components["schemas"]["PValue"];
            radius: components["schemas"]["PValue"];
            logg: components["schemas"]["PValue"];
            mass: components["schemas"]["PValue"];
            kepmag: components["schemas"]["PValue"];
        };
        /** StepAction */
        StepAction: {
            /** Method */
            method: string;
            /** Path */
            path: string;
        };
        /** StorageCategory */
        StorageCategory: {
            /** Key */
            key: string;
            /** Label */
            label: string;
            /** Path */
            path: string;
            /** Bytes */
            bytes: number;
            /** N Files */
            n_files: number;
            /** Clearable */
            clearable: boolean;
            /** Description */
            description: string;
        };
        /** StorageOut */
        StorageOut: {
            /** Categories */
            categories: components["schemas"]["StorageCategory"][];
            /** Total Bytes */
            total_bytes: number;
            disk?: components["schemas"]["DiskInfo"] | null;
        };
        /** SystemSummaryOut */
        SystemSummaryOut: {
            /** App Version */
            app_version: string;
            /** Pipeline Version */
            pipeline_version: string;
            catalog: components["schemas"]["CatalogSummary"];
            lightcurves: components["schemas"]["LightCurveSummary"];
            datasets: components["schemas"]["DatasetSummary"];
            models: components["schemas"]["ModelSummary"];
            predictions: components["schemas"]["PredictionSummary"];
            /** Running Jobs */
            running_jobs: components["schemas"]["JobOut"][];
            device: components["schemas"]["DeviceInfo"];
            /**
             * Checklist
             * @description All setup steps with done flags
             */
            checklist: components["schemas"]["NextStep"][];
            /**
             * Next Steps
             * @description Pending steps, in order
             */
            next_steps: components["schemas"]["NextStep"][];
            /** Disclaimer */
            disclaimer: string;
        };
        /** TargetDetailOut */
        TargetDetailOut: {
            target: components["schemas"]["TargetOut"];
            stellar?: components["schemas"]["StellarOut"] | null;
            /** Signals */
            signals: components["schemas"]["SignalOut"][];
            /** Datasets */
            datasets: components["schemas"]["DatasetMembership"][];
            /** Recent Predictions */
            recent_predictions: components["schemas"]["PredictionOut"][];
            /**
             * Reserved Showcase
             * @description Reserved showcase system (forced into test splits, never trained on)
             */
            reserved_showcase: boolean;
        };
        /** TargetOut */
        TargetOut: {
            /** Kepid */
            kepid: number;
            /** Label */
            label: string;
            /** Kepler Host Name */
            kepler_host_name?: string | null;
            /** Ra */
            ra?: number | null;
            /** Dec */
            dec?: number | null;
            /** Kepmag */
            kepmag?: number | null;
            /**
             * Lc Status
             * @description none | queued | downloading | available | no_data | error
             */
            lc_status: string;
            /**
             * Lc Quarters
             * @default []
             */
            lc_quarters: number[];
            /** Lc N Cadences */
            lc_n_cadences?: number | null;
            /** Lc Error */
            lc_error?: string | null;
            /** Lc Updated At */
            lc_updated_at?: string | null;
            /**
             * Lc Cached
             * @default false
             */
            lc_cached: boolean;
            /** Lc Cache Bytes */
            lc_cache_bytes?: number | null;
        };
        /** TargetSearchResult */
        TargetSearchResult: {
            /** Kepid */
            kepid: number;
            /**
             * Label
             * @description e.g. "Kepler-90 (KIC 11442793)"
             */
            label: string;
            /** Kepler Host Name */
            kepler_host_name?: string | null;
            /** N Signals */
            n_signals: number;
            /** Lc Status */
            lc_status: string;
            /**
             * Matched On
             * @description kepid | kepid_prefix | kepoi_name | kepler_name | kepler_host_name | signal_key
             */
            matched_on: string;
            /**
             * Matched Signal Id
             * @description Signal named by the query (e.g. 'Kepler-90 h')
             */
            matched_signal_id?: number | null;
            /** Matched Signal Key */
            matched_signal_key?: string | null;
            /** Matched Name */
            matched_name?: string | null;
            /**
             * Rank
             * @description 0 = exact identifier match; larger = weaker match
             */
            rank: number;
        };
        /**
         * TierOut
         * @description Size of a dataset tier in the live catalogue, with rough download/processing estimates.
         */
        TierOut: {
            /** Tier */
            tier: string;
            /** Label Mode */
            label_mode: string;
            /**
             * N Signals
             * @description Labelled signals (before label-conflict exclusion)
             */
            n_signals: number;
            /**
             * N Unlabelled Reserved
             * @description Unlabelled signals of reserved showcase stars (kept, not trained on)
             */
            n_unlabelled_reserved: number;
            /** N Pos */
            n_pos: number;
            /** N Neg */
            n_neg: number;
            /** N Label Conflicts */
            n_label_conflicts: number;
            /** N Stars */
            n_stars: number;
            /** N Stars Downloaded */
            n_stars_downloaded: number;
            /** N Stars Missing */
            n_stars_missing: number;
            /** Est Download Bytes */
            est_download_bytes: number;
            /** Est Download Minutes */
            est_download_minutes: number;
            /** Est Process Minutes */
            est_process_minutes: number;
            /** Est Minutes */
            est_minutes: number;
            /** Estimate Basis */
            estimate_basis: string;
            /** Description */
            description: string;
        };
        /**
         * TrainingConfigIn
         * @description Training options (all optional; defaults from the model card). Unknown keys are rejected.
         */
        TrainingConfigIn: {
            /** Lr */
            lr?: number | null;
            /** Batch Size */
            batch_size?: number | null;
            /** Max Epochs */
            max_epochs?: number | null;
            /** Patience */
            patience?: number | null;
            /** Min Delta */
            min_delta?: number | null;
            /** Dropout */
            dropout?: number | null;
            /** Fc Width */
            fc_width?: number | null;
            /** Fc Layers */
            fc_layers?: number | null;
            /** Ensemble Size */
            ensemble_size?: number | null;
            /** Seed */
            seed?: number | null;
            /** Augment Flip */
            augment_flip?: boolean | null;
            /** Weight Decay */
            weight_decay?: number | null;
            /** Device */
            device?: ("auto" | "cpu" | "cuda" | "mps") | null;
            /** Num Threads */
            num_threads?: number | null;
            /** Cv Folds */
            cv_folds?: number | null;
            /** Logreg C Grid */
            logreg_c_grid?: number[] | null;
            /** Logreg Max Iter */
            logreg_max_iter?: number | null;
            /** Rf N Estimators */
            rf_n_estimators?: number | null;
            /** Rf Max Depth Grid */
            rf_max_depth_grid?: (number | null)[] | null;
            /** Rf Min Samples Leaf Grid */
            rf_min_samples_leaf_grid?: number[] | null;
            /** Rf Max Features Grid */
            rf_max_features_grid?: (string | number)[] | null;
        };
        /** TrainingRunCreate */
        TrainingRunCreate: {
            /**
             * Name
             * @description Defaults to '<model type> - <dataset name>'
             */
            name?: string | null;
            /**
             * Model Type
             * @enum {string}
             */
            model_type: "logreg" | "random_forest" | "cnn_single" | "cnn_two_view";
            /** Dataset Id */
            dataset_id: number;
            config?: components["schemas"]["TrainingConfigIn"];
        };
        /** TrainingRunOut */
        TrainingRunOut: {
            /** Experiment Id */
            experiment_id: number;
            job: components["schemas"]["JobOut"];
        };
        /** TrainingSuiteCreate */
        TrainingSuiteCreate: {
            /** Dataset Id */
            dataset_id: number;
            /** Name Prefix */
            name_prefix?: string | null;
            /**
             * Model Types
             * @description Defaults to all four, in the order LR, RF, CNN, two-view CNN
             */
            model_types?: ("logreg" | "random_forest" | "cnn_single" | "cnn_two_view")[] | null;
            /**
             * Configs
             * @description Per-model-type options
             */
            configs?: {
                [key: string]: components["schemas"]["TrainingConfigIn"];
            };
        };
        /** TrainingSuiteOut */
        TrainingSuiteOut: {
            /** Experiment Ids */
            experiment_ids: number[];
            job: components["schemas"]["JobOut"];
        };
        /** TrainingSummary */
        TrainingSummary: {
            /** Experiment Name */
            experiment_name?: string | null;
            /** Best Epoch */
            best_epoch?: number | null;
            /** Epochs Run */
            epochs_run?: number | null;
            /** Duration S */
            duration_s?: number | null;
            /** Device */
            device?: string | null;
            /** Seed */
            seed?: number | null;
        };
        /** TransitEphemerisIn */
        TransitEphemerisIn: {
            /** Period Days */
            period_days: number;
            /** Epoch */
            epoch: number;
            /** Duration Hours */
            duration_hours: number;
            /**
             * Source
             * @description Where this ephemeris came from
             * @default manual
             * @enum {string}
             */
            source: "catalogue" | "measured" | "estimate" | "manual";
            /** Label */
            label?: string | null;
        };
        /** TransitIn */
        TransitIn: {
            /** Source */
            source: components["schemas"]["CatalogSource"] | components["schemas"]["UploadSource"];
            ephemeris: components["schemas"]["TransitEphemerisIn"];
            /**
             * Signal Id
             * @description Catalogue signal for the comparison table
             */
            signal_id?: number | null;
        };
        /** TransitOut */
        TransitOut: {
            source: components["schemas"]["SourceOut"];
            /** Signal Id */
            signal_id?: number | null;
            ephemeris: components["schemas"]["EphemerisOut"];
            /**
             * Fit
             * @description Trapezoid fit: depth_ppm, duration_hours, ingress_hours, epoch, shape_ratio, chi2_red, converged...
             */
            fit: {
                [key: string]: unknown;
            };
            /** Odd Even */
            odd_even: {
                [key: string]: unknown;
            };
            /** Secondary */
            secondary: {
                [key: string]: unknown;
            };
            /** Individual Transits */
            individual_transits: {
                [key: string]: unknown;
            }[];
            /** Snr */
            snr: {
                [key: string]: unknown;
            };
            /** Transit Count */
            transit_count: {
                [key: string]: unknown;
            };
            /** Noise */
            noise: {
                [key: string]: unknown;
            };
            quality: components["schemas"]["QualityOut"];
            folded: components["schemas"]["FoldedOut"];
            model_curve?: components["schemas"]["ModelCurve"] | null;
            /** Comparison */
            comparison: components["schemas"]["ComparisonRow"][];
            stellar?: components["schemas"]["StellarOut"] | null;
            /**
             * Derived
             * @description Estimates (never measurements): planet radius, a/R*, ...
             */
            derived: {
                [key: string]: components["schemas"]["PValue"];
            };
            /**
             * Masked Other Signals
             * @default []
             */
            masked_other_signals: components["schemas"]["EphemerisOut"][];
            /**
             * Warnings
             * @default []
             */
            warnings: string[];
            /** Pipeline Version */
            pipeline_version: string;
            /** Compute Ms */
            compute_ms: number;
            /**
             * Cached
             * @default false
             */
            cached: boolean;
        };
        /** UploadOut */
        UploadOut: {
            /** Upload Id */
            upload_id: string;
            /** Filename */
            filename: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "fits" | "csv";
            /** Size Bytes */
            size_bytes: number;
            /** N Rows */
            n_rows: number;
            /**
             * Columns
             * @description Table columns (CSV/text only)
             */
            columns?: string[] | null;
            /**
             * Suggested Mapping
             * @description Suggested {time, flux, flux_err, quality} columns for the user to confirm
             */
            suggested_mapping?: {
                [key: string]: string | null;
            } | null;
            /** Suggested Time System */
            suggested_time_system?: string | null;
            /**
             * Preview Rows
             * @default []
             */
            preview_rows: {
                [key: string]: unknown;
            }[];
            /**
             * Meta
             * @description FITS header facts (mission, time system...)
             */
            meta?: {
                [key: string]: unknown;
            };
            parsed?: components["schemas"]["ParsedInfo"] | null;
            /** Created At */
            created_at?: string | null;
        };
        /** UploadPredictionSource */
        UploadPredictionSource: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "upload";
            /** Upload Id */
            upload_id: string;
        };
        /** UploadSource */
        UploadSource: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "upload";
            /** Upload Id */
            upload_id: string;
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
        /**
         * ViewsOut
         * @description AstroNet-style model inputs (baseline ~0, transit minimum ~-1); phases in days.
         */
        ViewsOut: {
            /**
             * Global
             * @description Global view (2001 bins)
             */
            global: (number | null)[];
            /**
             * Local
             * @description Local view (201 bins, +/-2 T14)
             */
            local: (number | null)[];
            /** Global Phase */
            global_phase: (number | null)[];
            /** Local Phase */
            local_phase: (number | null)[];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health_api_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    bls_api_analysis_bls_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BlsIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlsOut"];
                };
            };
            /** @description invalid_parameters / insufficient_data / invalid_ephemeris */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description not_downloaded / upload_not_parsed */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    transit_api_analysis_transit_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TransitIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransitOut"];
                };
            };
            /** @description invalid_parameters / insufficient_data / invalid_ephemeris */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description not_downloaded / upload_not_parsed */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    injection_api_analysis_injection_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InjectionIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InjectionOut"];
                };
            };
            /** @description invalid_parameters / insufficient_data / invalid_ephemeris */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description not_downloaded / upload_not_parsed */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    refresh_api_catalog_refresh_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["RefreshIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description code=job_running */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    snapshots_api_catalog_snapshots_get: {
        parameters: {
            query?: {
                source?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SnapshotOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    signals_api_catalog_signals_get: {
        parameters: {
            query?: {
                /** @description KIC id, KOI name, Kepler name, host name or signal key */
                search?: string | null;
                /** @description Comma-separated categories */
                category?: string | null;
                /** @description Comma-separated PC,AFP,NTP,UNK or 'none' */
                av_label?: string | null;
                /** @description Comma-separated, or 'none' */
                koi_disposition?: string | null;
                has_lightcurve?: boolean | null;
                /** @description Only label conflicts (true) / none (false) */
                conflict?: boolean | null;
                min_period?: number | null;
                max_period?: number | null;
                min_snr?: number | null;
                kepid?: number | null;
                /** @description signal_key, kepid, period_days, duration_hours, depth_ppm, model_snr, planet_radius_re, category, kepoi_name, kepler_name, av_training_set, koi_disposition, koi_score */
                sort?: string;
                order?: "asc" | "desc";
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SignalPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    stats_api_catalog_stats_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogStatsOut"];
                };
            };
        };
    };
    tiers_api_datasets_tiers_get: {
        parameters: {
            query?: {
                label_mode?: "astronet_dr24" | "koi_disposition";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TierOut"][];
                };
            };
            /** @description code=invalid_label_mode */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_datasets_api_datasets_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatasetOut"][];
                };
            };
        };
    };
    create_dataset_api_datasets_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DatasetCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description code=invalid_tier, code=invalid_pipeline_config */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=dataset_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=catalog_empty, code=dataset_not_ready */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_dataset_api_datasets__dataset_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                dataset_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatasetDetailOut"];
                };
            };
            /** @description code=dataset_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_dataset_api_datasets__dataset_id__delete: {
        parameters: {
            query?: {
                /** @description Also delete the experiments/models trained on it */
                force?: boolean;
            };
            header?: never;
            path: {
                dataset_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatasetDeleteOut"];
                };
            };
            /** @description code=dataset_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=dataset_in_use, code=dataset_building */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    examples_api_datasets__dataset_id__examples_get: {
        parameters: {
            query?: {
                split?: ("train" | "val" | "test") | null;
                label?: (0 | 1) | null;
                included?: boolean | null;
                /** @description Exclusion reason code, e.g. quality:too_few_transits */
                reason?: string | null;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path: {
                dataset_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatasetExamplePage"];
                };
            };
            /** @description code=dataset_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    example_views_api_datasets__dataset_id__examples__signal_id__views_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                dataset_id: number;
                signal_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExampleViewsOut"];
                };
            };
            /** @description code=dataset_not_found, code=example_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=views_unavailable */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    gallery_api_datasets__dataset_id__gallery_get: {
        parameters: {
            query?: {
                per_class?: number;
                seed?: number;
            };
            header?: never;
            path: {
                dataset_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GalleryOut"];
                };
            };
            /** @description code=dataset_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=dataset_not_ready */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    pages_api_docs_pages_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocPageSummary"][];
                };
            };
        };
    };
    page_api_docs_pages__slug__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocPage"];
                };
            };
            /** @description code=doc_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    start_run_api_evaluation_runs_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EvaluationCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description code=model_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=checkpoint_missing, code=dataset_not_ready, code=split_empty */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_evaluations_api_evaluation_get: {
        parameters: {
            query?: {
                model_version_id?: number | null;
                dataset_id?: number | null;
                split?: ("val" | "test") | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluationOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    compare_api_evaluation_compare_get: {
        parameters: {
            query: {
                /** @description Comma-separated evaluation ids, e.g. 1,2,3 */
                ids: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluationCompareOut"];
                };
            };
            /** @description code=invalid_ids */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=evaluation_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_evaluation_api_evaluation__evaluation_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                evaluation_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluationDetailOut"];
                };
            };
            /** @description code=evaluation_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    examples_api_evaluation__evaluation_id__examples_get: {
        parameters: {
            query?: {
                outcome?: ("tp" | "fp" | "fn" | "tn") | null;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path: {
                evaluation_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluationExamplePage"];
                };
            };
            /** @description code=evaluation_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=per_example_missing */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    feature_importance_api_evaluation__evaluation_id__feature_importance_get: {
        parameters: {
            query?: {
                n_repeats?: number;
                seed?: number;
            };
            header?: never;
            path: {
                evaluation_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FeatureImportanceOut"];
                };
            };
            /** @description code=evaluation_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=not_supported_for_cnn, code=split_single_class */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_experiments_api_experiments_get: {
        parameters: {
            query?: {
                model_type?: string | null;
                dataset_id?: number | null;
                /** @description Comma-separated statuses */
                status?: string | null;
                archived?: boolean | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExperimentOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    compare_api_experiments_compare_get: {
        parameters: {
            query: {
                /** @description Comma-separated experiment ids */
                ids: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExperimentCompareOut"];
                };
            };
            /** @description code=invalid_ids */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=experiment_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_experiment_api_experiments__experiment_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                experiment_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExperimentDetailOut"];
                };
            };
            /** @description code=experiment_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_experiment_api_experiments__experiment_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                experiment_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExperimentDeleteOut"];
                };
            };
            /** @description code=experiment_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=experiment_running */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_experiment_api_experiments__experiment_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                experiment_id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExperimentPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExperimentDetailOut"];
                };
            };
            /** @description code=experiment_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_jobs_api_jobs_get: {
        parameters: {
            query?: {
                /** @description Comma-separated: queued,running,succeeded,failed,cancelled */
                status?: string | null;
                /** @description Comma-separated job kinds, e.g. build_dataset,train */
                kind?: string | null;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    stream_all_api_jobs_stream_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Server-Sent Events */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": unknown;
                };
            };
        };
    };
    get_job_api_jobs__job_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description code=job_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cancel_job_api_jobs__job_id__cancel_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description code=job_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=job_not_active, code=job_not_in_this_process */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    job_events_api_jobs__job_id__events_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Server-Sent Events */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": unknown;
                };
            };
            /** @description code=job_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_lightcurve_api_lightcurves__kepid__get: {
        parameters: {
            query?: {
                /** @description Use this catalogue signal's ephemeris (BKJD) */
                signal_id?: number | null;
                /** @description Manual ephemeris: period, days */
                period?: number | null;
                /** @description Manual ephemeris: transit centre, BKJD */
                epoch?: number | null;
                /** @description Manual ephemeris: T14, hours */
                duration_hours?: number | null;
                detrend?: "spline" | "savgol";
                /** @description Display points per stage */
                max_points?: number;
            };
            header?: never;
            path: {
                kepid: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LightCurveOut"];
                };
            };
            /** @description code=not_downloaded: download the star first */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_models_api_models_get: {
        parameters: {
            query?: {
                /** @description Include TEST FIXTURE models */
                include_fixtures?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelVersionOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_model_api_models__model_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                model_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelDetailOut"];
                };
            };
            /** @description code=model_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_model_api_models__model_id__delete: {
        parameters: {
            query?: {
                /** @description Allow deleting the only (active) model */
                force?: boolean;
            };
            header?: never;
            path: {
                model_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelDeleteOut"];
                };
            };
            /** @description code=model_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=model_is_active */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    activate_api_models__model_id__activate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                model_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelVersionOut"];
                };
            };
            /** @description code=model_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=incompatible_pipeline, code=checkpoint_missing */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    history_api_predictions_get: {
        parameters: {
            query?: {
                kepid?: number | null;
                model_version_id?: number | null;
                source_type?: ("catalog" | "fits" | "csv") | null;
                signal_id?: number | null;
                batch_job_id?: string | null;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PredictionPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    predict_api_predictions_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PredictIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PredictResponse"];
                };
            };
            /** @description signal_required / invalid_ephemeris / insufficient_data */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description signal_not_found / model_not_found / upload_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description no_model / not_downloaded / upload_not_parsed / model_unavailable */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    batch_api_predictions_batch_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BatchIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description no_model / nothing_to_score */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    candidates_api_predictions_candidates_get: {
        parameters: {
            query?: {
                /** @description Signal category (comma-separated) or 'all' */
                category?: string;
                model_version_id?: number | null;
                min_probability?: number | null;
                sort?: "mean_probability" | "max_probability" | "agreement" | "uncertainty";
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidatePage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    detail_api_predictions__prediction_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                prediction_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PredictionDetailOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    experiment_report_api_reports_experiments__experiment_id__get: {
        parameters: {
            query?: {
                format?: "md" | "html" | "json";
            };
            header?: never;
            path: {
                experiment_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The report file (attachment) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/markdown": unknown;
                    "text/html": unknown;
                    "application/json": unknown;
                };
            };
            /** @description code=experiment_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    comparison_report_api_reports_comparison_get: {
        parameters: {
            query: {
                /** @description Comma-separated experiment ids (at least two) */
                ids: string;
                format?: "md" | "html" | "json";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The report file (attachment) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/markdown": unknown;
                    "text/html": unknown;
                    "application/json": unknown;
                };
            };
            /** @description code=invalid_ids */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=experiment_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_settings__api_settings_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsOut"];
                };
            };
        };
    };
    put_settings_api_settings_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsOut"];
                };
            };
            /** @description code=invalid_setting */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    storage_api_settings_storage_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StorageOut"];
                };
            };
        };
    };
    clear_api_settings_storage_clear_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ClearIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClearOut"];
                };
            };
            /** @description code=job_running */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    backup_api_settings_backup_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SQLite database file */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": unknown;
                };
            };
        };
    };
    summary_api_system_summary_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemSummaryOut"];
                };
            };
        };
    };
    diagnostics_api_system_diagnostics_get: {
        parameters: {
            query?: {
                /** @description Also ping the NASA Exoplanet Archive and MAST */
                check_network?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiagnosticsOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_api_targets_search_get: {
        parameters: {
            query: {
                /** @description "Kepler-90", "Kepler-90 h", "KIC 11442793", "K00351.01"... */
                q: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TargetSearchResult"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    detail_api_targets__kepid__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kepid: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TargetDetailOut"];
                };
            };
            /** @description code=target_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    download_api_targets__kepid__download_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kepid: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Already available: the target, no job */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TargetOut"];
                };
            };
            /** @description Download job started (or already running) */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description code=target_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    model_types_api_training_model_types_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelCardOut"][];
                };
            };
        };
    };
    estimate_api_training_estimate_get: {
        parameters: {
            query: {
                model_type: "logreg" | "random_forest" | "cnn_single" | "cnn_two_view";
                dataset_id: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EstimateOut"];
                };
            };
            /** @description code=dataset_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=dataset_not_ready */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    start_run_api_training_runs_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TrainingRunCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrainingRunOut"];
                };
            };
            /** @description code=invalid_config */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=dataset_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=dataset_not_ready, code=incompatible_pipeline */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    start_suite_api_training_suite_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TrainingSuiteCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrainingSuiteOut"];
                };
            };
            /** @description code=invalid_config */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=dataset_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description code=dataset_not_ready */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_api_uploads_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_api_uploads_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadOut"];
                };
            };
            /** @description unsupported_file_type / invalid_file */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description file_too_large (> 200 MB) */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_upload_api_uploads__upload_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                upload_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    parse_api_uploads__upload_id__parse_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                upload_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ParseIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ParseOut"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_lightcurve_api_uploads__upload_id__lightcurve_get: {
        parameters: {
            query?: {
                period?: number | null;
                epoch?: number | null;
                duration_hours?: number | null;
                detrend?: "spline" | "savgol";
                max_points?: number;
            };
            header?: never;
            path: {
                upload_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LightCurveOut"];
                };
            };
            /** @description code=upload_not_parsed */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
