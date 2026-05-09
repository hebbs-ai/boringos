// SPDX-License-Identifier: BUSL-1.1
//
// Budgets — top-level admin screen for spend policies + incidents.
// Promoted out of Settings → Budgets tab in task_16 phase 5.

import { ScreenBody, ScreenHeader } from "../_shared.js";
import { BudgetsPanel } from "../Settings/BudgetsPanel.js";

export function Budgets() {
  return (
    <>
      <ScreenHeader
        title="Budgets"
        subtitle="Spend caps + incidents. Hard-stops fire when an agent or tenant exceeds its limit."
      />
      <ScreenBody>
        <BudgetsPanel />
      </ScreenBody>
    </>
  );
}
