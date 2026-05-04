import "reflect-metadata";
import * as path from "node:path";
import * as dotenv from "dotenv";

// Load .env from the workspace root before anything else imports envs.
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "[worker] ANTHROPIC_API_KEY is not set — agent/auditor calls will fail. Put it in <repo>/.env",
    );
  }
  const app = await NestFactory.create(AppModule, { cors: true });
  const port = Number(process.env.WORKER_PORT ?? 4000);
  await app.listen(port);
  console.log(`[worker] listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
