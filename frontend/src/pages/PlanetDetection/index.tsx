import { PlaceholderPage } from "../_shared/PlaceholderPage";

/** Planet Detection — score a signal with the models trained in this app. */
export default function PlanetDetectionPage() {
  return (
    <PlaceholderPage
      navId="detect"
      planned={[
        "Pick a catalogue signal or an uploaded light curve and an ephemeris (catalogue, BLS or manual).",
        "Score it with one or more of your trained models and see calibrated probabilities with uncertainty.",
        "See the exact global and local views the model received, and their data-quality grade.",
        "Every planet-like score is labelled as a research lead, never as a confirmed discovery.",
      ]}
      related={["candidates", "predictions", "training"]}
    />
  );
}
