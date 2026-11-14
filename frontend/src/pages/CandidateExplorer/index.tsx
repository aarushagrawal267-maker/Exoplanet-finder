import { PlaceholderPage } from "../_shared/PlaceholderPage";

/** Candidate Explorer — rank unconfirmed candidates by model score and agreement. */
export default function CandidateExplorerPage() {
  return (
    <PlaceholderPage
      navId="candidates"
      planned={[
        "Batch-score catalogue candidates whose light curves are downloaded.",
        "Rank them by calibrated probability, cross-model agreement and uncertainty.",
        "Filter by period, depth, SNR and data-quality grade; open any row as a Target Dossier.",
      ]}
      related={["detect", "predictions"]}
    />
  );
}
