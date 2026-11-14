import { PlaceholderPage } from "../_shared/PlaceholderPage";

/** Model Evaluation — held-out performance, calibration and errors. */
export default function ModelEvaluationPage() {
  return (
    <PlaceholderPage
      navId="evaluation"
      planned={[
        "ROC and precision–recall curves, overlaid for every model on the same test split.",
        "Reliability diagram and expected calibration error after temperature scaling.",
        "Confusion matrix at the chosen threshold with bootstrap confidence intervals.",
        "Browse false positives and false negatives with their model inputs.",
      ]}
      related={["training", "experiments"]}
    />
  );
}
