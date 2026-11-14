import { PlaceholderPage } from "../_shared/PlaceholderPage";

/** Experiments — compare training runs and export reports. */
export default function ExperimentsPage() {
  return (
    <PlaceholderPage
      navId="experiments"
      planned={[
        "Every training run with its configuration, environment, epochs and resulting model.",
        "Side-by-side comparison with a configuration diff and overlaid learning curves.",
        "Notes, tags and downloadable Markdown / HTML / JSON reports.",
      ]}
      related={["training", "evaluation"]}
    />
  );
}
