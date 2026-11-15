import { Link } from "react-router-dom";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

/** 404 page. */
export default function NotFoundPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Error · 404" title="Nothing at these coordinates" description="The page you asked for does not exist. It may have moved, or the link is mistyped." />
      <EmptyState
        title="No transit detected here"
        description="Use the sidebar or press Ctrl K to jump to a page."
        actions={
          <Link to="/" className={buttonClasses({ variant: "primary" })}>
            Back to Overview
          </Link>
        }
      />
    </div>
  );
}
