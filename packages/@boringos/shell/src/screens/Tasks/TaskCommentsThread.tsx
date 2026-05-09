// SPDX-License-Identifier: BUSL-1.1
//
// Conversation thread on a task. Comments rendered as markdown so AI
// output preserves headings, lists, code blocks, links — same as
// what we expect on Copilot or any chat surface.
//
// Authors are clearly distinguished: agents on the left with role
// metadata; the user on the right (Slack-style asymmetry so the
// reader instantly knows whose turn it is).

import type { TaskComment } from "@boringos/ui";
import type { Agent } from "@boringos/ui";

import { Markdown } from "../../components/Markdown.js";
import { formatRelativeTime } from "./presenter.js";

export interface TaskCommentsThreadProps {
  comments: TaskComment[];
  agentsById: Map<string, Agent>;
  meId: string;
}

export function TaskCommentsThread({ comments, agentsById, meId }: TaskCommentsThreadProps) {
  if (comments.length === 0) {
    return (
      <p className="text-xs text-slate-400 italic">
        No comments yet. Reply below to start the conversation.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {comments
        .slice()
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((c) => {
          const isMine = c.authorUserId === meId;
          const agent = c.authorAgentId ? agentsById.get(c.authorAgentId) : null;
          const author = agent?.name ?? (isMine ? "You" : c.authorUserId ? "Teammate" : "System");
          const role = agent?.role ? ` · ${agent.role}` : "";
          return (
            <li
              key={c.id}
              data-testid="task-comment"
              className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3.5 py-2 ring-1 ${
                  isMine
                    ? "bg-blue-50 ring-blue-200"
                    : agent
                      ? "bg-violet-50/50 ring-violet-100"
                      : "bg-slate-50 ring-slate-200"
                }`}
              >
                <div
                  className={`text-[10px] font-medium uppercase tracking-wide ${
                    isMine ? "text-blue-700" : agent ? "text-violet-700" : "text-slate-500"
                  }`}
                >
                  {author}
                  <span className="text-slate-400 normal-case font-normal">
                    {role}
                  </span>
                </div>
                <div className="mt-1">
                  <Markdown source={c.body} compact className="text-slate-800" />
                </div>
              </div>
              <span className="mt-1 text-[10px] text-slate-400 px-1">
                {formatRelativeTime(c.createdAt)}
              </span>
            </li>
          );
        })}
    </ul>
  );
}
