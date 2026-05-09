// SPDX-License-Identifier: BUSL-1.1
//
// Team screen — manage tenant members + pending invitations.
// Backend lives at /api/auth/{team,invitations,invite}; the
// useTeam() hook from @boringos/ui wraps both.

import { useState } from "react";
import { toast } from "sonner";
import { useTeam } from "@boringos/ui";

import { useAuth } from "../../auth/AuthProvider.js";
import { LoadingState, ScreenBody, ScreenHeader } from "../_shared.js";
import { InviteModal } from "./InviteModal.js";
import { InvitationsList } from "./InvitationsList.js";
import { MembersTable } from "./MembersTable.js";

export function Team() {
  const { user } = useAuth();
  const {
    members,
    invitations,
    isLoading,
    updateRole,
    removeMember,
    invite,
    revokeInvitation,
    isInviting,
  } = useTeam();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);

  const handleRoleChange = async (userId: string, role: string) => {
    setBusyMemberId(userId);
    try {
      await updateRole({ userId, role });
      toast.success("Role updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update role");
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleRemove = async (userId: string) => {
    const target = members.find((m) => m.userId === userId);
    if (!target) return;
    if (!window.confirm(`Remove ${target.name} from this tenant?`)) return;
    setBusyMemberId(userId);
    try {
      await removeMember(userId);
      toast.success(`${target.name} removed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove member");
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleRevoke = async (id: string) => {
    setBusyInviteId(id);
    try {
      await revokeInvitation(id);
      toast.success("Invitation revoked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to revoke");
    } finally {
      setBusyInviteId(null);
    }
  };

  return (
    <>
      <ScreenHeader
        title="Team"
        subtitle="Members of this tenant. Invite, remove, or change roles."
        actions={
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-light"
          >
            + Invite
          </button>
        }
      />
      <ScreenBody>
        {isLoading ? (
          <LoadingState />
        ) : (
          <div className="space-y-8">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-secondary">
                  Members{" "}
                  <span className="ml-1 font-normal text-muted">
                    ({members.length})
                  </span>
                </h2>
              </div>
              <MembersTable
                members={members}
                meId={user?.id ?? null}
                onRoleChange={(uid, role) => void handleRoleChange(uid, role)}
                onRemove={(uid) => void handleRemove(uid)}
                busyId={busyMemberId}
              />
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-secondary">
                  Pending invitations{" "}
                  <span className="ml-1 font-normal text-muted">
                    ({invitations.length})
                  </span>
                </h2>
              </div>
              <InvitationsList
                invitations={invitations}
                onRevoke={(id) => void handleRevoke(id)}
                busyId={busyInviteId}
              />
            </section>
          </div>
        )}
      </ScreenBody>

      {inviteOpen && (
        <InviteModal
          busy={isInviting}
          onClose={() => setInviteOpen(false)}
          onInvite={(data) => invite({ email: data.email, role: data.role })}
        />
      )}
    </>
  );
}
