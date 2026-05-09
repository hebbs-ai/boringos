// SPDX-License-Identifier: BUSL-1.1
//
// Routines — top-level admin screen for cron routines. Promoted out
// of Settings → Routines tab in task_16 phase 5: routines are an
// operational control, not configuration, so they live under EXTEND.
//
// The actual list/edit/create UI is the existing RoutinesPanel —
// we just give it the standard screen chrome here.

import { ScreenBody, ScreenHeader } from "../_shared.js";
import { RoutinesPanel } from "../Settings/RoutinesPanel.js";

export function Routines() {
  return (
    <>
      <ScreenHeader
        title="Routines"
        subtitle="Scheduled work — agents and workflows that fire on a cron."
      />
      <ScreenBody>
        <RoutinesPanel />
      </ScreenBody>
    </>
  );
}
