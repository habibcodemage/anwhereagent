import { Module } from "@nestjs/common";
import { InvestigationController } from "./investigation/investigation.controller";
import { SessionService } from "./session/session.service";
import { RepoService } from "./repo/repo.service";
import { ToolsService } from "./repo/tools.service";
import { AgentService } from "./agent/agent.service";
import { AuditorService } from "./auditor/auditor.service";
import { StreamHub } from "./stream/stream.hub";

@Module({
  controllers: [InvestigationController],
  providers: [
    SessionService,
    RepoService,
    ToolsService,
    AgentService,
    AuditorService,
    StreamHub,
  ],
})
export class AppModule {}
