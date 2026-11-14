import { PlaceholderPage } from "../_shared/PlaceholderPage";

/** Model Training — train classifiers from scratch on your datasets. */
export default function ModelTrainingPage() {
  return (
    <PlaceholderPage
      navId="training"
      planned={[
        "Train logistic regression, random forest, a global-view CNN and the two-view AstroNet-style CNN.",
        "Configure learning rate, batch size, epochs, early stopping, dropout, ensembles and seed.",
        "Watch loss and validation PR-AUC live, epoch by epoch, with an ETA; cancel at any time.",
        "Everything runs locally on your CPU or GPU — no external AI services.",
      ]}
      related={["datasets", "evaluation", "experiments"]}
    />
  );
}
