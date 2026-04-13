"use client";

import { AutonomyControls } from "@/components/autonomy-controls";
import { UIModal } from "@/components/ui-modal";
import { useState } from "react";

type ShellControlsModalProps = {
  realtimeEnabled: boolean;
  fallbackPaused?: boolean;
};

export function ShellControlsModal({ realtimeEnabled, fallbackPaused }: ShellControlsModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        Runtime
      </button>

      <UIModal
        open={open}
        onClose={() => setOpen(false)}
        title="Runtime Controls"
        description="Pause or resume autonomy and run worker actions."
      >
        <AutonomyControls realtimeEnabled={realtimeEnabled} fallbackPaused={fallbackPaused} />
      </UIModal>
    </>
  );
}
