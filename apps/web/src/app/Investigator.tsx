"use client";

import { useEffect, useRef, useState } from "react";
import type { SseEvent, AuditReport, Citation } from "@investigator/shared";

interface Turn {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
  audit?: AuditReport;
  toolCalls: { name: string; preview?: string; ok?: boolean }[];
  status?: string;
  done: boolean;
}

export default function Investigator() {
  const [repoUrl, setRepoUrl] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/investigations/${sessionId}/events`);
    esRef.current = es;
    es.onmessage = (ev) => {
      let parsed: SseEvent;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      handleEvent(parsed);
    };
    es.onerror = () => {
      // browser auto-reconnects; surface a soft hint
    };
    return () => {
      es.close();
      esRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function handleEvent(ev: SseEvent) {
    setTurns((prev) => {
      const next = [...prev];
      const active = next.find((t) => !t.done && t.id === activeTurnIdRef.current);

      if (ev.type === "status" && active) {
        active.status = ev.message;
      } else if (ev.type === "tool_call" && active) {
        active.toolCalls.push({ name: ev.name });
      } else if (ev.type === "tool_result" && active) {
        const last = active.toolCalls[active.toolCalls.length - 1];
        if (last && last.name === ev.name && last.preview === undefined) {
          last.preview = ev.preview;
          last.ok = ev.ok;
        }
      } else if (ev.type === "token" && active) {
        active.answer = ev.text;
      } else if (ev.type === "answer") {
        const t = next.find((t) => t.id === activeTurnIdRef.current);
        if (t) {
          t.id = ev.turnId;
          t.answer = ev.text;
          t.citations = ev.citations;
          activeTurnIdRef.current = ev.turnId;
        }
      } else if (ev.type === "audit") {
        const t = next.find((t) => t.id === ev.turnId);
        if (t) t.audit = ev.report;
      } else if (ev.type === "done") {
        const t = next.find((t) => t.id === activeTurnIdRef.current);
        if (t) {
          t.done = true;
          t.status = undefined;
        }
      } else if (ev.type === "error") {
        setErrorMsg(ev.message);
      }
      return next;
    });
  }

  const activeTurnIdRef = useRef<string | null>(null);

  async function startSession() {
    setErrorMsg(null);
    setStarting(true);
    try {
      const res = await fetch("/api/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });
      if (!res.ok) {
        setErrorMsg(await res.text());
        return;
      }
      const data = (await res.json()) as { sessionId: string };
      setSessionId(data.sessionId);
    } finally {
      setStarting(false);
    }
  }

  async function ask() {
    if (!sessionId || !question.trim()) return;
    const tempId = `pending-${Date.now()}`;
    activeTurnIdRef.current = tempId;
    setTurns((p) => [
      ...p,
      {
        id: tempId,
        question,
        answer: "",
        citations: [],
        toolCalls: [],
        done: false,
      },
    ]);
    const q = question;
    setQuestion("");
    const res = await fetch(`/api/investigations/${sessionId}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q }),
    });
    if (!res.ok) {
      setErrorMsg(await res.text());
    }
  }

  if (!sessionId) {
    return (
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{ flex: 1 }}
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
        />
        <button onClick={startSession} disabled={!repoUrl || starting}>
          {starting ? "cloning…" : "start"}
        </button>
        {errorMsg && <p style={{ color: "#f87171" }}>{errorMsg}</p>}
      </div>
    );
  }

  return (
    <div>
      <p style={{ color: "#9aa3b2", fontSize: 13 }}>
        Session <code>{sessionId}</code>
      </p>
      {errorMsg && <p style={{ color: "#f87171" }}>{errorMsg}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {turns.map((t) => (
          <TurnView key={t.id} turn={t} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <input
          style={{ flex: 1 }}
          placeholder="Ask about the codebase…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
        />
        <button onClick={ask} disabled={!question.trim()}>
          ask
        </button>
      </div>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  return (
    <div
      style={{
        border: "1px solid #2a2f38",
        borderRadius: 8,
        padding: 14,
        background: "#11141a",
      }}
    >
      <div style={{ color: "#9aa3b2", fontSize: 13 }}>question</div>
      <div style={{ marginBottom: 10 }}>{turn.question}</div>

      {turn.toolCalls.length > 0 && (
        <details style={{ marginBottom: 10 }}>
          <summary style={{ color: "#9aa3b2", fontSize: 13, cursor: "pointer" }}>
            tool calls ({turn.toolCalls.length})
          </summary>
          <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 13 }}>
            {turn.toolCalls.map((c, i) => (
              <li key={i}>
                <code>{c.name}</code>
                {c.preview && (
                  <pre
                    style={{
                      margin: "4px 0",
                      padding: 8,
                      background: "#0b0d10",
                      borderRadius: 4,
                      maxHeight: 120,
                      overflow: "auto",
                    }}
                  >
                    {c.preview}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div style={{ color: "#9aa3b2", fontSize: 13 }}>answer</div>
      <div style={{ whiteSpace: "pre-wrap" }}>
        {turn.answer || (turn.status ?? "…")}
      </div>

      {turn.audit && <AuditView audit={turn.audit} />}
    </div>
  );
}

function AuditView({ audit }: { audit: AuditReport }) {
  const color =
    audit.verdict === "trustworthy"
      ? "#34d399"
      : audit.verdict === "shaky"
        ? "#fbbf24"
        : "#f87171";
  return (
    <div
      style={{
        marginTop: 12,
        padding: 10,
        border: `1px solid ${color}`,
        borderRadius: 6,
        background: "#0b0d10",
      }}
    >
      <div style={{ color, fontSize: 13, fontWeight: 600 }}>
        audit: {audit.verdict}
      </div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{audit.notes}</div>
      {audit.hallucinatedCitations.length > 0 && (
        <div style={{ fontSize: 13, marginTop: 6 }}>
          <strong>hallucinated:</strong>{" "}
          {audit.hallucinatedCitations
            .map((c) => `${c.path}:${c.startLine}-${c.endLine}`)
            .join(", ")}
        </div>
      )}
      {audit.unsupportedClaims.length > 0 && (
        <div style={{ fontSize: 13, marginTop: 6 }}>
          <strong>unsupported:</strong>
          <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
            {audit.unsupportedClaims.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {audit.contradictionsWithEarlierTurns.length > 0 && (
        <div style={{ fontSize: 13, marginTop: 6 }}>
          <strong>contradicts earlier:</strong>
          <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
            {audit.contradictionsWithEarlierTurns.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
