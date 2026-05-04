import { NextRequest } from "next/server";

const WORKER = process.env.WORKER_URL ?? "http://localhost:4000";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const res = await fetch(`${WORKER}/investigations/${id}`);
  return new Response(await res.text(), {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/json",
    },
  });
}
