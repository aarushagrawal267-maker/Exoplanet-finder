import { PlaceholderPage } from "../_shared/PlaceholderPage";

/** Transit Analysis — BLS search, folding, fitting and vetting diagnostics. */
export default function TransitAnalysisPage() {
  return (
    <PlaceholderPage
      navId="transit"
      planned={[
        "Run a Box Least Squares period search and inspect the periodogram and its aliases.",
        "Fold on the catalogue or measured ephemeris and fit a trapezoid transit model.",
        "Vet the signal: odd/even depth test, secondary eclipse search, individual transits, SNR.",
        "Compare catalogue, measured and estimated parameters with provenance.",
        "Run a clearly-labelled injection–recovery test on a real light curve.",
      ]}
      related={["signals", "detect"]}
    />
  );
}
