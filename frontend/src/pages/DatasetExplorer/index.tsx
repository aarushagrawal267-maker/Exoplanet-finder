import { PlaceholderPage } from "../_shared/PlaceholderPage";

/** Dataset Explorer — build labelled datasets and inspect their splits. */
export default function DatasetExplorerPage() {
  return (
    <PlaceholderPage
      navId="datasets"
      planned={[
        "Refresh the NASA Exoplanet Archive catalogue snapshots (DR24 TCE, KOI, confirmed planets).",
        "Build pilot, standard or full datasets with star-level train/validation/test splits.",
        "Choose the label mode (AstroNet DR24 Autovetter or KOI disposition) and see exclusions by reason.",
        "Browse example global/local views per class and per data-quality grade.",
      ]}
      related={["training", "signals"]}
    />
  );
}
