import { NextRequest } from "next/server";

const WORKER = process.env.WORKER_URL ?? "http://localhost:4000";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const res = await fetch(`${WORKER}/investigations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
}
