import { PlaceholderPage } from "../_shared/PlaceholderPage";

/** Prediction History — the log of every prediction made. */
export default function PredictionHistoryPage() {
  return (
    <PlaceholderPage
      navId="predictions"
      planned={[
        "Every prediction with its model version, ephemeris source, inputs and timing.",
        "Filter by target, model or source; reopen a prediction with its views.",
        "Flags for predictions made by fixture models or on signals seen during training.",
      ]}
      related={["detect", "candidates"]}
    />
  );
}
