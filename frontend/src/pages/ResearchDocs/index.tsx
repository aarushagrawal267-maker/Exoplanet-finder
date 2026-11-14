import { PlaceholderPage } from "../_shared/PlaceholderPage";

/** Research Docs — methodology, data sources and limitations. */
export default function ResearchDocsPage() {
  return (
    <PlaceholderPage
      navId="docs"
      planned={[
        "Methodology: preprocessing pipeline, model architectures, training and calibration.",
        "NASA data sources with exact queries and snapshot provenance.",
        "Known limitations and how to read a planet-like score responsibly.",
        "A research-report template for writing up your findings.",
      ]}
      related={["settings"]}
    />
  );
}
