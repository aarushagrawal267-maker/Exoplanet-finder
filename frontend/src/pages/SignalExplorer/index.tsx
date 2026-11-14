import { PlaceholderPage } from "../_shared/PlaceholderPage";

/** Signal Explorer — browse catalogue signals and their Kepler light curves. */
export default function SignalExplorerPage() {
  return (
    <PlaceholderPage
      navId="signals"
      planned={[
        "Search the Kepler DR24 TCE and KOI catalogue by KIC id, Kepler name or KOI number.",
        "Download a target's long-cadence quarters from MAST and stitch them.",
        "Inspect raw, normalised, detrended and flattened flux with transit windows marked.",
        "Upload your own FITS or CSV light curve and map its columns.",
      ]}
      related={["transit", "datasets"]}
    />
  );
}
