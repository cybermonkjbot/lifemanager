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
        Automation
      </button>

      <UIModal
        open={open}
        onClose={() => setOpen(false)}
        title="Automation Controls"
        description="Pause or resume automation and restart the worker."
      >
        <AutonomyControls realtimeEnabled={realtimeEnabled} fallbackPaused={fallbackPaused} />
      </UIModal>
    </>
  );
}
