import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User, Tenant } from "@db/schema";
import { authenticateRequest } from "./auth";

export type TrpcContext = {
  req:        Request;
  resHeaders: Headers;
  user?:      User;
  tenant?:    Tenant;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  try {
    const auth  = await authenticateRequest(opts.req.headers);
    ctx.user    = auth.user;
    ctx.tenant  = auth.tenant;
  } catch {
    // Public routes (login, signup) don't require auth
  }
  return ctx;
}
