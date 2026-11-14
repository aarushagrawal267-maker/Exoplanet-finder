import { useParams } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";
import { formatKepid } from "@/lib/format";
import { PlaceholderPage } from "../_shared/PlaceholderPage";

/** Target Dossier — everything known about one Kepler target (KIC id in the URL). */
export default function TargetDossierPage() {
  const { kepid = "" } = useParams();
  const valid = /^\d{1,9}$/.test(kepid);
  return (
    <PlaceholderPage
      navId="target"
      title={valid ? formatKepid(kepid) : "Target Dossier"}
      description={
        valid
          ? "Stellar parameters, every catalogue signal on this star, its light curve, dataset memberships and predictions."
          : `“${kepid}” is not a Kepler Input Catalog id (expected up to 9 digits).`
      }
      meta={valid ? <Badge mono>{kepid.padStart(9, "0")}</Badge> : <Badge tone="warn">Invalid KIC id</Badge>}
      planned={[
        "Stellar parameters with provenance (Teff, radius, log g).",
        "All TCEs, KOIs and confirmed planets on the star, with catalogue labels and conflicts.",
        "Light curve with every known planet's transit windows; per-signal folds and diagnostics.",
        "Dataset memberships (and split) and every prediction made for this target.",
      ]}
      related={["signals", "transit", "detect"]}
    />
  );
}
