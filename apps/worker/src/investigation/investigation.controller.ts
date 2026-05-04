import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Sse,
  MessageEvent,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import {
  AskQuestionSchema,
  StartInvestigationSchema,
  type SseEvent,
} from "@investigator/shared";
import { SessionService } from "../session/session.service";
import { RepoService } from "../repo/repo.service";
import { AgentService } from "../agent/agent.service";
import { AuditorService } from "../auditor/auditor.service";
import { StreamHub } from "../stream/stream.hub";

@Controller("investigations")
export class InvestigationController {
  constructor(
    private readonly sessions: SessionService,
    private readonly repos: RepoService,
    private readonly agent: AgentService,
    private readonly auditor: AuditorService,
    private readonly hub: StreamHub,
  ) {}

  @Post()
  async start(@Body() body: unknown) {
    const parsed = StartInvestigationSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.message, HttpStatus.BAD_REQUEST);
    }
    let repoPath: string;
    try {
      repoPath = await this.repos.cloneIfNeeded(parsed.data.repoUrl);
    } catch (e) {
      throw new HttpException(
        `clone failed: ${(e as Error).message}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const session = await this.sessions.create({
      repoUrl: parsed.data.repoUrl,
      repoPath,
    });
    return { sessionId: session.id, repoUrl: session.repoUrl };
  }

  @Sse(":id/events")
  events(@Param("id") id: string): Observable<MessageEvent> {
    return this.hub.observable(id).pipe(
      map((event: SseEvent): MessageEvent => ({
        data: event,
      })),
    );
  }

  @Post(":id/ask")
  async ask(@Param("id") id: string, @Body() body: unknown) {
    const parsed = AskQuestionSchema.safeParse({ ...((body as object) ?? {}), sessionId: id });
    if (!parsed.success) {
      throw new HttpException(parsed.error.message, HttpStatus.BAD_REQUEST);
    }
    const session = await this.sessions.get(id);
    if (!session) {
      throw new HttpException("session not found", HttpStatus.NOT_FOUND);
    }

    // run agent then auditor — both stream events to the SSE channel
    queueMicrotask(async () => {
      try {
        const result = await this.agent.run(session, parsed.data.question);
        await this.auditor.audit({
          sessionId: session.id,
          turnId: result.turnId,
          repoPath: session.repoPath,
          question: parsed.data.question,
          answer: result.answer,
          citations: result.citations,
        });
        this.hub.emit(session.id, { type: "done" });
      } catch (e) {
        this.hub.emit(session.id, {
          type: "error",
          message: (e as Error).message,
        });
      }
    });

    return { accepted: true };
  }
}
