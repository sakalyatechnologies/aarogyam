import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Skeleton } from "@sakalya/ui";

import { useMyLayout } from "./queries.js";
import { StudioEditor } from "./studio-editor.js";

/** Settings, "Dashboard studio": the editor on the member's own layout, with the preview beside it. */
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
  return <StudioEditor view={layout.data} layout="split" />;
}
