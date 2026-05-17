// SPDX-License-Identifier: GPL-3.0-or-later
//
// Regression coverage for the CRM legacy-REST → v2-tool shim
// (issue #20). The frontend bits that this shim unblocks (the CRM
// PipelineSettings panel, the inbox slot fetches) all collapse to
// a single concern: "the path translation table is in lockstep
// with hebbs-crm's own translator".
//
// Strategy: unit-test `translate()` end-to-end. The Hono mount and
// dispatch glue is exercised by the existing tool-routes tests; we
// only want to lock down the translation contract here so any
// future drift between this file and `hebbs-crm/.../lib/api.ts`
// fails loudly.

import { describe, it, expect } from "vitest";

import {
  translateCrmLegacyPath as translate,
  NoLegacyRouteError,
} from "@boringos/core";

describe("CRM shim — translate()", () => {
  describe("generic CRUD", () => {
    it("GET /pipelines → crm.pipelines.list (no input)", () => {
      const t = translate("GET", "/pipelines");
      expect(t.toolName).toBe("crm.pipelines.list");
      expect(t.input).toEqual({});
    });

    it("GET /pipelines?archived=true → carries query as input", () => {
      const t = translate("GET", "/pipelines?archived=true&q=acme");
      expect(t.toolName).toBe("crm.pipelines.list");
      expect(t.input).toEqual({ archived: "true", q: "acme" });
    });

    it("GET /pipelines/<id> → crm.pipelines.get { id }", () => {
      const t = translate("GET", "/pipelines/p-123");
      expect(t.toolName).toBe("crm.pipelines.get");
      expect(t.input).toEqual({ id: "p-123" });
    });

    it("POST /contacts → crm.contacts.create { ...body }", () => {
      const t = translate("POST", "/contacts", { name: "Ada" });
      expect(t.toolName).toBe("crm.contacts.create");
      expect(t.input).toEqual({ name: "Ada" });
    });

    it("PUT /contacts/<id> → crm.contacts.update merges id + body", () => {
      const t = translate("PUT", "/contacts/c-1", { name: "Ada Lovelace" });
      expect(t.toolName).toBe("crm.contacts.update");
      expect(t.input).toEqual({ id: "c-1", name: "Ada Lovelace" });
    });

    it("DELETE /contacts/<id> → crm.contacts.delete { id }", () => {
      const t = translate("DELETE", "/contacts/c-1");
      expect(t.toolName).toBe("crm.contacts.delete");
      expect(t.input).toEqual({ id: "c-1" });
    });
  });

  describe("pipelines special cases", () => {
    it("GET /pipelines/<id>/forecast → crm.pipelines.forecast", () => {
      const t = translate("GET", "/pipelines/p-1/forecast");
      expect(t.toolName).toBe("crm.pipelines.forecast");
      expect(t.input).toEqual({ id: "p-1" });
    });

    it("POST /pipelines/<id>/stages → crm.pipelines.create_stage", () => {
      const t = translate("POST", "/pipelines/p-1/stages", { name: "Qualified" });
      expect(t.toolName).toBe("crm.pipelines.create_stage");
      expect(t.input).toEqual({ pipelineId: "p-1", name: "Qualified" });
    });

    it("PUT /pipelines/<id>/stages/<sid> → crm.pipelines.update_stage", () => {
      const t = translate("PUT", "/pipelines/p-1/stages/s-1", { name: "Won" });
      expect(t.toolName).toBe("crm.pipelines.update_stage");
      expect(t.input).toEqual({ pipelineId: "p-1", id: "s-1", name: "Won" });
    });

    it("DELETE /pipelines/<id>/stages/<sid> → crm.pipelines.delete_stage", () => {
      const t = translate("DELETE", "/pipelines/p-1/stages/s-1");
      expect(t.toolName).toBe("crm.pipelines.delete_stage");
      expect(t.input).toEqual({ pipelineId: "p-1", id: "s-1" });
    });
  });

  describe("inbox + activities + actions + profile", () => {
    it("GET /activities/timeline/<cid> carries query", () => {
      const t = translate("GET", "/activities/timeline/c-1?limit=20");
      expect(t.toolName).toBe("crm.activities.timeline");
      expect(t.input).toEqual({ contactId: "c-1", limit: "20" });
    });

    it("GET /inbox → crm.inbox.list", () => {
      const t = translate("GET", "/inbox");
      expect(t.toolName).toBe("crm.inbox.list");
    });

    it("POST /inbox/<id>/reply → crm.inbox.reply", () => {
      const t = translate("POST", "/inbox/i-1/reply", { body: "Sure!" });
      expect(t.toolName).toBe("crm.inbox.reply");
      expect(t.input).toEqual({ id: "i-1", body: "Sure!" });
    });

    it("POST /inbox/<id>/archive-gmail → crm.inbox.archive { id }", () => {
      const t = translate("POST", "/inbox/i-1/archive-gmail");
      expect(t.toolName).toBe("crm.inbox.archive");
      expect(t.input).toEqual({ id: "i-1" });
    });

    it("GET /actions/count → crm.actions.count_pending", () => {
      const t = translate("GET", "/actions/count");
      expect(t.toolName).toBe("crm.actions.count_pending");
      expect(t.input).toEqual({});
    });

    it("POST /actions/<id>/execute → crm.actions.execute merges id + body", () => {
      const t = translate("POST", "/actions/a-1/execute", { confirm: true });
      expect(t.toolName).toBe("crm.actions.execute");
      expect(t.input).toEqual({ id: "a-1", confirm: true });
    });

    it("GET /profile → crm.profile.get; PUT /profile → crm.profile.update", () => {
      expect(translate("GET", "/profile").toolName).toBe("crm.profile.get");
      const t = translate("PUT", "/profile", { tz: "Asia/Kolkata" });
      expect(t.toolName).toBe("crm.profile.update");
      expect(t.input).toEqual({ tz: "Asia/Kolkata" });
    });
  });

  describe("error cases", () => {
    it("throws NoLegacyRouteError for unknown paths", () => {
      expect(() => translate("GET", "/unknown/sub/path")).toThrow(NoLegacyRouteError);
    });

    it("throws NoLegacyRouteError for verbs without a matching pattern", () => {
      // PATCH on /<group>/<id> isn't in the v1 surface — translator
      // must refuse to invent a tool name rather than guess.
      expect(() => translate("PATCH", "/contacts/c-1", { name: "Ada" })).toThrow(NoLegacyRouteError);
    });

    it("includes the method + path in the error", () => {
      try {
        translate("PATCH", "/contacts/c-1");
      } catch (e) {
        expect(e).toBeInstanceOf(NoLegacyRouteError);
        const err = e as NoLegacyRouteError;
        expect(err.method).toBe("PATCH");
        expect(err.path).toBe("/contacts/c-1");
      }
    });
  });
});
