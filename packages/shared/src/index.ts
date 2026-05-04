import { z } from "zod";

export const CitationSchema = z.object({
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const AuditVerdictSchema = z.enum(["trustworthy", "shaky", "wrong"]);
export type AuditVerdict = z.infer<typeof AuditVerdictSchema>;

export const AuditReportSchema = z.object({
  verdict: AuditVerdictSchema,
  hallucinatedCitations: z.array(CitationSchema),
  unsupportedClaims: z.array(z.string()),
  contradictionsWithEarlierTurns: z.array(z.string()),
  notes: z.string(),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;

export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session"), sessionId: z.string() }),
  z.object({ type: z.literal("status"), message: z.string() }),
  z.object({ type: z.literal("token"), text: z.string() }),
  z.object({
    type: z.literal("tool_call"),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_result"),
    name: z.string(),
    ok: z.boolean(),
    preview: z.string(),
  }),
  z.object({
    type: z.literal("answer"),
    turnId: z.string(),
    text: z.string(),
    citations: z.array(CitationSchema),
  }),
  z.object({
    type: z.literal("audit"),
    turnId: z.string(),
    report: AuditReportSchema,
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;

export const StartInvestigationSchema = z.object({
  repoUrl: z.string().url(),
});
export type StartInvestigation = z.infer<typeof StartInvestigationSchema>;

export const AskQuestionSchema = z.object({
  sessionId: z.string(),
  question: z.string().min(1),
});
export type AskQuestion = z.infer<typeof AskQuestionSchema>;
