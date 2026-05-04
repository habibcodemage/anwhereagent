import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { nanoid } from "nanoid";
import type { AuditReport } from "@investigator/shared";

export interface ConversationTurn {
  id: string;
  question: string;
  answer: string;
  citations: { path: string; startLine: number; endLine: number }[];
  audit?: AuditReport;
}

export interface SessionState {
  id: string;
  repoUrl: string;
  repoPath: string;
  createdAt: number;
  turns: ConversationTurn[];
}

@Injectable()
export class SessionService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly ttlSeconds = 60 * 60 * 6;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6382", {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  private key(id: string) {
    return `session:${id}`;
  }

  async create(input: {
    repoUrl: string;
    repoPath: string;
  }): Promise<SessionState> {
    const state: SessionState = {
      id: nanoid(12),
      repoUrl: input.repoUrl,
      repoPath: input.repoPath,
      createdAt: Date.now(),
      turns: [],
    };
    await this.save(state);
    return state;
  }

  async get(id: string): Promise<SessionState | null> {
    const raw = await this.redis.get(this.key(id));
    return raw ? (JSON.parse(raw) as SessionState) : null;
  }

  async save(state: SessionState): Promise<void> {
    await this.redis.set(
      this.key(state.id),
      JSON.stringify(state),
      "EX",
      this.ttlSeconds,
    );
  }

  async appendTurn(id: string, turn: ConversationTurn): Promise<void> {
    const state = await this.get(id);
    if (!state) throw new Error(`session ${id} not found`);
    state.turns.push(turn);
    await this.save(state);
  }

  async setTurnAudit(
    sessionId: string,
    turnId: string,
    audit: AuditReport,
  ): Promise<void> {
    const state = await this.get(sessionId);
    if (!state) return;
    const turn = state.turns.find((t) => t.id === turnId);
    if (!turn) return;
    turn.audit = audit;
    await this.save(state);
  }
}
