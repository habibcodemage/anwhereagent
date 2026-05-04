import { Injectable } from "@nestjs/common";
import { Subject, Observable } from "rxjs";
import type { SseEvent } from "@investigator/shared";

@Injectable()
export class StreamHub {
  private readonly subjects = new Map<string, Subject<SseEvent>>();

  channel(sessionId: string): Subject<SseEvent> {
    let s = this.subjects.get(sessionId);
    if (!s) {
      s = new Subject<SseEvent>();
      this.subjects.set(sessionId, s);
    }
    return s;
  }

  observable(sessionId: string): Observable<SseEvent> {
    return this.channel(sessionId).asObservable();
  }

  emit(sessionId: string, event: SseEvent): void {
    this.channel(sessionId).next(event);
  }

  close(sessionId: string): void {
    const s = this.subjects.get(sessionId);
    if (s) {
      s.complete();
      this.subjects.delete(sessionId);
    }
  }
}
