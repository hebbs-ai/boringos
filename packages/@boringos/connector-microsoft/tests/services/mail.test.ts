// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from "vitest";
import { MailClient } from "../../src/services/mail/client.js";

describe("MailClient", () => {
  it("lists messages from the value array", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ value: [{ id: "a", conversationId: "c1" }] }), { status: 200 }),
    );
    const client = new MailClient("token", fetchMock as unknown as typeof fetch);
    const result = await client.listMessages();
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("a");
  });

  it("orders by receivedDateTime when no query", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });
    const client = new MailClient("token", fetchMock as unknown as typeof fetch);
    await client.listMessages();
    expect(capturedUrl).toContain("%24orderby=receivedDateTime+desc");
    expect(capturedUrl).not.toContain("%24search");
  });

  it("uses $search and drops $orderby when a query is given", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });
    const client = new MailClient("token", fetchMock as unknown as typeof fetch);
    await client.searchMessages("invoice");
    expect(capturedUrl).toContain("%24search=");
    expect(capturedUrl).toContain("invoice");
    expect(capturedUrl).not.toContain("orderby");
  });

  it("returns empty array when no messages", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const client = new MailClient("token", fetchMock as unknown as typeof fetch);
    expect(await client.listMessages()).toHaveLength(0);
  });

  it("supports a token-provider function", async () => {
    let calls = 0;
    const getToken = async () => `t${++calls}`;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer t${calls}`);
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });
    const client = new MailClient(getToken, fetchMock as unknown as typeof fetch);
    await client.listMessages();
    expect(calls).toBe(1);
  });

  it("sends mail with structured recipients", async () => {
    let capturedBody: any;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/sendMail");
      capturedBody = JSON.parse(init?.body as string);
      return new Response("", { status: 202 });
    });
    const client = new MailClient("token", fetchMock as unknown as typeof fetch);
    await client.sendEmail({ to: "a@x.com, b@y.com", subject: "Hi", body: "Hello" });
    expect(capturedBody.message.toRecipients).toEqual([
      { emailAddress: { address: "a@x.com" } },
      { emailAddress: { address: "b@y.com" } },
    ]);
    expect(capturedBody.message.body).toEqual({ contentType: "text", content: "Hello" });
    expect(capturedBody.saveToSentItems).toBe(true);
  });

  it("reply posts to the reply action with a comment", async () => {
    let capturedUrl = "";
    let capturedBody: any;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string);
      return new Response("", { status: 202 });
    });
    const client = new MailClient("token", fetchMock as unknown as typeof fetch);
    await client.replyToEmail({ messageId: "m1", body: "thanks" });
    expect(capturedUrl).toContain("/messages/m1/reply");
    expect(capturedBody).toEqual({ comment: "thanks" });
  });

  it("replyAll posts to the replyAll action", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response("", { status: 202 });
    });
    const client = new MailClient("token", fetchMock as unknown as typeof fetch);
    await client.replyToEmail({ messageId: "m1", body: "x", replyAll: true });
    expect(capturedUrl).toContain("/messages/m1/replyAll");
  });

  it("archiveMessage moves to the archive folder", async () => {
    let capturedUrl = "";
    let capturedBody: any;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ id: "m1", parentFolderId: "archive" }), { status: 200 });
    });
    const client = new MailClient("token", fetchMock as unknown as typeof fetch);
    const moved = await client.archiveMessage("m1");
    expect(capturedUrl).toContain("/messages/m1/move");
    expect(capturedBody).toEqual({ destinationId: "archive" });
    expect(moved.id).toBe("m1");
  });

  it("markRead patches isRead", async () => {
    let capturedBody: any;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("PATCH");
      capturedBody = JSON.parse(init?.body as string);
      return new Response("", { status: 200 });
    });
    const client = new MailClient("token", fetchMock as unknown as typeof fetch);
    await client.markRead("m1");
    expect(capturedBody).toEqual({ isRead: true });
  });

  it("throws on non-ok listMessages response", async () => {
    const fetchMock = vi.fn(async () => new Response("Forbidden", { status: 403 }));
    const client = new MailClient("token", fetchMock as unknown as typeof fetch);
    await expect(client.listMessages()).rejects.toThrow("Mail listMessages failed: 403");
  });
});
