import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Skeleton } from "@sakalya/ui";

import { useMyLayout } from "./queries.js";
import { StudioEditor } from "./studio-editor.js";

/** Settings, "My dashboard": the editor on the member's own layout. */
export function StudioPanel() {
  const layout = useMyLayout();
  if (layout.isPending) {
    return (
      <div role="status" aria-label="Loading the studio" style={{ display: "grid", gap: 12 }}>
        <Skeleton shape="block" />
        <Skeleton shape="block" className="h-64" />
      </div>
    );
  }
  if (layout.isError) {
    return (
      <ApiErrorNotice
        title="Couldn't load your Today layout"
        error={layout.error}
        onRetry={() => {
          void layout.refetch();
        }}
      />
    );
  }
  return <StudioEditor view={layout.data} />;
}
