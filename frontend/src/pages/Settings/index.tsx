import { PlaceholderPage } from "../_shared/PlaceholderPage";

/** Settings — device, storage and preferences. */
export default function SettingsPage() {
  return (
    <PlaceholderPage
      navId="settings"
      planned={[
        "Compute device (auto / CPU / CUDA) and parallel download workers.",
        "Storage usage per category, raw-FITS retention and cache clean-up.",
        "Default model and threshold mode; display density and reduced motion.",
        "Database backup download.",
      ]}
      related={["docs"]}
    />
  );
}
