import type { FastifyReply, FastifyRequest } from "fastify";
import { getDb } from "../db/client.js";

declare module "fastify" {
  interface FastifyRequest { userId: string; }
}

/** Works as a Fastify preHandler or as await requireUser(request). */
export async function requireUser(request: FastifyRequest, _reply?: FastifyReply): Promise<string> {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? "");
  if (!match?.[1]) throw Object.assign(new Error("Sign in to continue."), { statusCode: 401, code: "UNAUTHORIZED" });
  const { data, error } = await getDb().auth.getUser(match[1]);
  if (error || !data.user) throw Object.assign(new Error("Your session has expired. Sign in again."), { statusCode: 401, code: "UNAUTHORIZED" });
  request.userId = data.user.id;
  return data.user.id;
}
