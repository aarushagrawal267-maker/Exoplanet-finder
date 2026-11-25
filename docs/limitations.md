# Known limitations

Exoplanet Finder is a research and learning platform. These limitations matter when you interpret
its results.

## Scientific scope
* **A planet-like score is not a discovery.** It says that a signal's folded light-curve shape
  resembles signals vetted as planet candidates. Confirmation needs independent evidence: centroid
  analysis, high-resolution imaging, radial velocities, or statistical validation that accounts
  for astrophysical false-positive rates.
* **Photometry alone cannot rule out some false positives.** Background eclipsing binaries diluted
  by a bright target, and contamination from nearby stars (centroid offsets), can produce
  planet-like shapes. The models never see pixel-level or centroid data.
* **Kepler long-cadence only.** Models are trained on 29.4-minute Kepler data processed by this
  pipeline. Uploaded TESS, K2, short-cadence or ground-based light curves are *out of
  distribution*. The app warns you, but scores on such data are unreliable.
* **Ephemeris dependence.** The views are built from a period, epoch and duration. A wrong
  ephemeris (e.g. a BLS alias at P/2 or 2P) produces misleading views and scores.

## Labels
* **Label noise.** DR24 Autovetter labels and KOI dispositions are expert/automated judgements
  that have changed between catalogue releases. Some "false positives" may be planets and vice
  versa.
* **Class definition.** In the default mode, class 0 mixes astrophysical false positives (AFP) and
  non-transiting phenomena (NTP). The model learns "not planet-candidate-like", not a specific
  false-positive mechanism.
* **Candidates and training.** In the `koi_disposition` label mode, KOI `CANDIDATE`s are never used for
  training. In the default `astronet_dr24` mode, labels come from the DR24 Autovetter training set,
  whose planet-candidate class ("PC") includes signals that NASA still lists as KOI `CANDIDATE`
  today; as in AstroNet, they are planet-like training examples. A candidate's score is only an
  independent lead if its star was **not** in the model's training or validation split. The
  Candidate Explorer hides such stars by default, and every prediction states the split. Agreement
  with later dispositions is not guaranteed.

## Data and compute
* **Dataset size.** The Pilot and Standard tiers are much smaller than the full DR24 training set
  used by AstroNet, so expect noisier results than the published ones. Confidence intervals are
  reported to make this visible.
* **Class balance changes the numbers.** The Standard tier is class-balanced (about 50 %
  planet-like), the Full tier keeps NASA's natural balance (about 23 %). PR-AUC and precision are
  therefore higher on Standard than on Full for the same model quality; compare models only on the
  same dataset, and compare PR-AUC with its chance level (the planet-like fraction of the test set).
* **No paired model comparison.** Each model's confidence intervals are computed separately; the
  app does not run a paired significance test of the difference between two models.
* **Download volume.** The full labelled set is about 70 GB of raw FITS. MAST availability and
  speed vary, and downloads are resumable.
* **CPU training.** CNN training on a laptop CPU is feasible for the Standard tier but slow for
  the Full tier. A CUDA GPU is used automatically when present.
* **Detrending trade-offs.** Masked spline detrending protects known transits. For uploads without
  a known ephemeris, BLS runs on a light curve detrended without a mask, which can slightly reduce
  long-duration transits.

## Engineering
* **Single-user local app.** No authentication. Do not expose ports 8000/5173 to a network.
* **Windows scripts.** The PowerShell scripts were written for Windows 10/11 but developed in a
  Linux environment. Report any start-up problem together with `logs\backend.log` and
  `logs\frontend.log`.
* **Background jobs** run inside the backend process. Stopping the backend interrupts running
  jobs, which are then marked *interrupted*; restart them from the UI. Downloads resume where they
  left off.
