import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import type { PrismaClient } from "@prisma/client";
import type { AuthUser } from "../auth/domain/entities/User.entity";
import { ACCESS_TOKEN_COOKIE } from "../auth/presentation/AuthCookies";
import { createNotificationsRouter } from "./notifications-module";

test("notification HTTP endpoints isolate recipients, paginate and mark only the user's messages", async t => {
  const rows = [
    { id: randomUUID(), recipientId: "seller", title: "Link", body: "Ready", readAt: null as Date | null },
    { id: randomUUID(), recipientId: "seller", title: "New signature", body: "Reason", readAt: null as Date | null },
    { id: randomUUID(), recipientId: "other", title: "Private", body: "Other user", readAt: null as Date | null },
  ];
  const matches = (row: typeof rows[number], where: { id?: string; recipientId: string; readAt?: null }) =>
    row.recipientId === where.recipientId && (!where.id || row.id === where.id) && (where.readAt !== null || row.readAt === null);
  const db = { beexNotification: {
    findMany: async ({ where, skip, take }: { where: Parameters<typeof matches>[1]; skip: number; take: number }) => rows.filter(row => matches(row, where)).slice(skip, skip + take),
    count: async ({ where }: { where: Parameters<typeof matches>[1] }) => rows.filter(row => matches(row, where)).length,
    updateMany: async ({ where, data }: { where: Parameters<typeof matches>[1]; data: { readAt: Date } }) => {
      const selected = rows.filter(row => matches(row, where));
      selected.forEach(row => { row.readAt = data.readAt; });
      return { count: selected.length };
    },
  } } as unknown as Pick<PrismaClient, "beexNotification">;
  const app = express();
  app.use(cookieParser());
  app.use(createNotificationsRouter({ execute: async token => {
    if (token !== "seller") throw Object.assign(new Error("Authentication required"), { status: 401 });
    return { id: "seller" } as AuthUser;
  } }, db));
  app.use((error: Error & { status?: number; statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.statusCode ?? error.status ?? 500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Cookie: `${ACCESS_TOKEN_COOKIE}=seller` };
  assert.equal((await fetch(base)).status, 401);
  const first = await (await fetch(`${base}/?limit=1&offset=0`, { headers })).json();
  const second = await (await fetch(`${base}/?limit=1&offset=1`, { headers })).json();
  assert.equal(first.total, 2); assert.equal(first.unreadCount, 2);
  assert.notEqual(first.items[0].id, second.items[0].id);
  await fetch(`${base}/${rows[2]!.id}/read`, { method: "POST", headers });
  assert.equal(rows[2]!.readAt, null);
  await fetch(`${base}/${rows[0]!.id}/read`, { method: "POST", headers });
  assert(rows[0]!.readAt);
  assert.equal((await fetch(`${base}/?offset=-1`, { headers })).status, 400);
  await fetch(`${base}/read-all`, { method: "POST", headers });
  assert(rows[1]!.readAt); assert.equal(rows[2]!.readAt, null);
  const unread = await (await fetch(`${base}/?unreadOnly=true`, { headers })).json();
  assert.equal(unread.items.length, 0); assert.equal(unread.unreadCount, 0);
});
