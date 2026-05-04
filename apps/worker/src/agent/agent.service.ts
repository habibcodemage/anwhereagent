import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import { ToolsService } from "../repo/tools.service";
import { SessionService, SessionState } from "../session/session.service";
import { StreamHub } from "../stream/stream.hub";
import type { Citation } from "@investigator/shared";

const SYSTEM_PROMPT = `You are a senior engineer investigating an unfamiliar codebase to answer the user's questions.

Hard rules:
- Ground every non-trivial claim in specific files and line ranges. Use the tools to verify before stating facts.
- Cite using the format \`path/to/file.ts:42-58\` inline in your answer. Cite the smallest range that proves your point.
- If you are uncertain, say so. Do NOT invent function names, file paths, or line numbers — readers will check.
- Stay coherent across the conversation. If an earlier turn made a claim and a new finding contradicts it, name the contradiction explicitly and explain which is correct.
- Skip the obvious. The user is technical. Get to the surprising or load-bearing parts.

You have these tools:
- list_dir(path): list a directory
- read_file(path, start_line?, end_line?): read a file (optionally a slice)
- grep(pattern, path_glob?): ripgrep across the repo

Investigate, then answer. Keep tool calls focused — don't dump whole files when a slice will do.`;

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | ToolUseBlock
        | { type: "tool_result"; tool_use_id: string; content: string }
      >;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  private readonly model = process.env.AGENT_MODEL ?? "claude-sonnet-4-6";

  constructor(
    private readonly tools: ToolsService,
    private readonly sessions: SessionService,
    private readonly hub: StreamHub,
  ) {}

  async run(
    session: SessionState,
    question: string,
  ): Promise<{ turnId: string; answer: string; citations: Citation[] }> {
    const messages: AnthropicMessage[] = this.buildHistory(session);
    messages.push({ role: "user", content: question });

    const toolDefs = this.toolDefs();
    let answer = "";
    const MAX_TURNS = 12;

    for (let i = 0; i < MAX_TURNS; i++) {
      this.hub.emit(session.id, {
        type: "status",
        message: i === 0 ? "investigating…" : `step ${i + 1}…`,
      });

      const resp = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: toolDefs,
        messages: messages as never,
      });

      const toolUses: ToolUseBlock[] = [];
      let textPiece = "";
      for (const block of resp.content) {
        if (block.type === "text") {
          textPiece += block.text;
        } else if (block.type === "tool_use") {
          toolUses.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      if (textPiece) {
        this.hub.emit(session.id, { type: "token", text: textPiece });
        answer = textPiece;
      }

      if (resp.stop_reason !== "tool_use" || toolUses.length === 0) {
        break;
      }

      messages.push({
        role: "assistant",
        content: [
          ...(textPiece ? [{ type: "text" as const, text: textPiece }] : []),
          ...toolUses,
        ],
      });

      const toolResults: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
      }> = [];
      for (const tu of toolUses) {
        this.hub.emit(session.id, {
          type: "tool_call",
          name: tu.name,
          input: tu.input,
        });
        const result = await this.runTool(session.repoPath, tu.name, tu.input);
        this.hub.emit(session.id, {
          type: "tool_result",
          name: tu.name,
          ok: !result.startsWith("[error"),
          preview: result.slice(0, 240),
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: result,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    const turnId = nanoid(10);
    const citations = this.parseCitations(answer);
    await this.sessions.appendTurn(session.id, {
      id: turnId,
      question,
      answer,
      citations,
    });

    this.hub.emit(session.id, {
      type: "answer",
      turnId,
      text: answer,
      citations,
    });

    return { turnId, answer, citations };
  }

  private buildHistory(session: SessionState): AnthropicMessage[] {
    const out: AnthropicMessage[] = [];
    for (const turn of session.turns) {
      out.push({ role: "user", content: turn.question });
      out.push({ role: "assistant", content: turn.answer });
    }
    return out;
  }

  private toolDefs() {
    return [
      {
        name: "list_dir",
        description: "List entries in a directory relative to the repo root.",
        input_schema: {
          type: "object" as const,
          properties: {
            path: { type: "string", description: "directory path, '.' for root" },
          },
          required: ["path"],
        },
      },
      {
        name: "read_file",
        description:
          "Read a file (optionally a line range). Always pass a range for files >300 lines.",
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
      {
        name: "grep",
        description:
          "Ripgrep search across the repo. Use this to locate symbols, strings, or patterns.",
        input_schema: {
          type: "object" as const,
          properties: {
            pattern: { type: "string" },
            path_glob: {
              type: "string",
              description: "optional glob, e.g. '*.ts'",
            },
          },
          required: ["pattern"],
        },
      },
    ];
  }

  private async runTool(
    repoRoot: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    try {
      if (name === "list_dir") {
        return await this.tools.listDir(repoRoot, String(input.path ?? "."));
      }
      if (name === "read_file") {
        return await this.tools.readFile(
          repoRoot,
          String(input.path),
          input.start_line as number | undefined,
          input.end_line as number | undefined,
        );
      }
      if (name === "grep") {
        return await this.tools.grep(
          repoRoot,
          String(input.pattern),
          input.path_glob as string | undefined,
        );
      }
      return `[error: unknown tool ${name}]`;
    } catch (e) {
      return `[error: ${(e as Error).message}]`;
    }
  }

  private parseCitations(text: string): Citation[] {
    const out: Citation[] = [];
    const re = /([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+):(\d+)(?:-(\d+))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = parseInt(m[2], 10);
      const end = m[3] ? parseInt(m[3], 10) : start;
      out.push({ path: m[1], startLine: start, endLine: end });
    }
    return out;
  }
}
