import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { ToolsService } from "../repo/tools.service";
import { SessionService } from "../session/session.service";
import { StreamHub } from "../stream/stream.hub";
import {
  AuditReportSchema,
  type AuditReport,
  type Citation,
} from "@investigator/shared";

const AUDITOR_SYSTEM = `You are an independent auditor. A different agent investigated a codebase and produced an answer. Your job is to decide whether the answer is trustworthy.

You will receive:
- the user's question
- the agent's answer (with inline citations like path/to/file.ts:42-58)
- a tool to read the actual files

Your job:
1. For each citation, read the cited range and verify it actually supports the claim made about it. Flag any citation where the file doesn't exist, the range is empty, or the content does not support what the answer says.
2. Identify claims in the answer that are NOT backed by any citation and would be load-bearing for a reader trusting the answer. Flag them as unsupported.
3. If you were given prior turns, check whether this answer contradicts an earlier claim. If it does, flag the contradiction.
4. Decide a verdict:
   - "trustworthy": citations check out, no major unsupported claims
   - "shaky": minor issues — some unsupported claims or vague reasoning, but no false citations
   - "wrong": at least one hallucinated citation, or a load-bearing claim contradicted by the file

Be concise. Be specific. Quote line numbers in your notes.

You MUST end your response with a single JSON code block matching this shape:
\`\`\`json
{
  "verdict": "trustworthy" | "shaky" | "wrong",
  "hallucinatedCitations": [{"path": "...", "startLine": N, "endLine": N}],
  "unsupportedClaims": ["..."],
  "contradictionsWithEarlierTurns": ["..."],
  "notes": "one paragraph"
}
\`\`\``;

@Injectable()
export class AuditorService {
  private readonly logger = new Logger(AuditorService.name);
  private readonly client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  private readonly model =
    process.env.AUDITOR_MODEL ?? "claude-haiku-4-5-20251001";

  constructor(
    private readonly tools: ToolsService,
    private readonly sessions: SessionService,
    private readonly hub: StreamHub,
  ) {}

  async audit(input: {
    sessionId: string;
    turnId: string;
    repoPath: string;
    question: string;
    answer: string;
    citations: Citation[];
  }): Promise<AuditReport> {
    const session = await this.sessions.get(input.sessionId);
    const priorTurns = session?.turns.filter((t) => t.id !== input.turnId) ?? [];

    const priorContext =
      priorTurns.length === 0
        ? "(no prior turns)"
        : priorTurns
            .map(
              (t, i) =>
                `Turn ${i + 1}\nQ: ${t.question}\nA: ${t.answer.slice(0, 1200)}`,
            )
            .join("\n\n---\n\n");

    const userMsg = `# Prior turns\n${priorContext}\n\n# Current question\n${input.question}\n\n# Current answer\n${input.answer}\n\n# Cited ranges (please verify each)\n${
      input.citations.length === 0
        ? "(no inline citations parsed)"
        : input.citations
            .map((c) => `- ${c.path}:${c.startLine}-${c.endLine}`)
            .join("\n")
    }\n\nVerify and produce your audit JSON.`;

    const toolDefs = [
      {
        name: "read_file",
        description: "Read a file or line range to verify a citation.",
        input_schema: {
          type: "object" as const,
          properties: {
            path: { type: "string" },
            start_line: { type: "number" },
            end_line: { type: "number" },
          },
          required: ["path"],
        },
      },
    ];

    const messages: Array<{
      role: "user" | "assistant";
      content: unknown;
    }> = [{ role: "user", content: userMsg }];

    for (let i = 0; i < 8; i++) {
      const resp = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: AUDITOR_SYSTEM,
        tools: toolDefs,
        messages: messages as never,
      });

      const toolUses: Array<{
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      }> = [];
      let textPiece = "";
      for (const block of resp.content) {
        if (block.type === "text") textPiece += block.text;
        else if (block.type === "tool_use")
          toolUses.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
      }

      if (resp.stop_reason !== "tool_use" || toolUses.length === 0) {
        const report = this.parseReport(textPiece);
        this.hub.emit(input.sessionId, {
          type: "audit",
          turnId: input.turnId,
          report,
        });
        return report;
      }

      messages.push({
        role: "assistant",
        content: [
          ...(textPiece ? [{ type: "text", text: textPiece }] : []),
          ...toolUses,
        ],
      });

      const toolResults = [];
      for (const tu of toolUses) {
        const result = await this.runTool(input.repoPath, tu.input);
        toolResults.push({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: result,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    const fallback: AuditReport = {
      verdict: "shaky",
      hallucinatedCitations: [],
      unsupportedClaims: [],
      contradictionsWithEarlierTurns: [],
      notes: "auditor exhausted tool budget without producing JSON",
    };
    this.hub.emit(input.sessionId, {
      type: "audit",
      turnId: input.turnId,
      report: fallback,
    });
    return fallback;
  }

  private async runTool(
    repoRoot: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    try {
      return await this.tools.readFile(
        repoRoot,
        String(input.path),
        input.start_line as number | undefined,
        input.end_line as number | undefined,
      );
    } catch (e) {
      return `[error: ${(e as Error).message}]`;
    }
  }

  private parseReport(text: string): AuditReport {
    const fence = text.match(/```json\s*([\s\S]*?)```/);
    const raw = fence ? fence[1] : text;
    try {
      const parsed = JSON.parse(raw);
      return AuditReportSchema.parse(parsed);
    } catch (e) {
      this.logger.warn(`auditor JSON parse failed: ${(e as Error).message}`);
      return {
        verdict: "shaky",
        hallucinatedCitations: [],
        unsupportedClaims: [],
        contradictionsWithEarlierTurns: [],
        notes: `auditor output unparseable. raw: ${text.slice(0, 400)}`,
      };
    }
  }
}
