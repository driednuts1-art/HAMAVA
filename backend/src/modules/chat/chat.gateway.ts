import { Inject, Logger, forwardRef } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Message } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { TokenService } from '../auth/tokens/token.service';
import { CallService } from '../calls/call.service';
import { PresenceService } from '../presence/presence.service';

function roomForUser(userId: string): string {
  return `user:${userId}`;
}

interface CallSignalPayload {
  callSessionId: string;
  toUserId: string;
  payload: unknown;
}

interface CallHangupPayload {
  callSessionId: string;
  reason?: string;
}

/**
 * FR-58..FR-61: push-only for chat (`message:new`); sending stays REST-only
 * (docs/requirements.md Feature 4 §9 Open Items — the durable, idempotent
 * write path is deliberately not the socket).
 *
 * FR-185..FR-188 (Feature 13): the same namespace/room infrastructure also
 * carries call signaling — the first client→server real-time messages this
 * gateway has needed. Deliberately NOT a second namespace/gateway/Redis
 * channel (docs/requirements.md Feature 13 §2's explicit instruction) —
 * every signaling event rides the exact `roomForUser()` delivery mechanism
 * `message:new` already proves works.
 *
 * FR-480..FR-483 (Feature 27): this connection is also the app's one
 * real-time presence signal — `handleConnection`/`handleDisconnect` register
 * and clear a live Redis-backed presence entry (`PresenceService`), and
 * `presence:heartbeat` keeps it alive for as long as the socket stays open.
 * Deliberately not a second gateway/namespace, same reasoning as Feature 13's
 * call signaling above.
 */
@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly tokenService: TokenService,
    @Inject(forwardRef(() => CallService))
    private readonly callService: CallService,
    private readonly presence: PresenceService,
  ) {}

  /** FR-60: same JWT access token as REST — no separate auth mechanism. */
  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token = this.extractToken(socket);
      const payload = await this.tokenService.verifyAccessToken(token);
      (socket.data as { userId: string }).userId = payload.sub;
      await socket.join(roomForUser(payload.sub));
      // FR-480: registers this connection and starts the 45s online TTL.
      await this.presence.recordConnect(payload.sub, socket.id);
    } catch (error) {
      this.logger.warn(
        `Rejecting WS connection: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      socket.disconnect(true);
    }
  }

  /**
   * FR-481/FR-482: fires for a normal close, a network drop (once socket.io's
   * own ping-timeout elapses), or an auth rejection above — never for this
   * app's *own process* crashing, which is exactly why FR-483's independent
   * TTL-expiry self-heal exists as a second, non-redundant safety net.
   */
  async handleDisconnect(socket: Socket): Promise<void> {
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) return; // never got past auth in handleConnection
    await this.presence.recordDisconnect(userId, socket.id);
  }

  /** FR-480: refreshes the 45s online TTL — emitted every 20s while connected. */
  @SubscribeMessage('presence:heartbeat')
  async handlePresenceHeartbeat(
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    const userId = (socket.data as { userId: string }).userId;
    await this.presence.recordHeartbeat(userId);
  }

  private extractToken(socket: Socket): string {
    const fromAuth = socket.handshake.auth?.token as string | undefined;
    const header = socket.handshake.headers.authorization;
    const fromHeader = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : undefined;
    const token = fromAuth ?? fromHeader;
    if (!token) throw new Error('Missing access token.');
    return token;
  }

  /** FR-58: best-effort — the REST persist is the durability guarantee, not this push. */
  pushNewMessage(recipientId: string, message: Message): void {
    this.server.to(roomForUser(recipientId)).emit('message:new', message);
  }

  /**
   * FR-186: pushed by CallService.start() the moment a CallSession is
   * created. Defensive-in-depth, matching `MessageService.pushNewMessage()`'s
   * own precedent exactly: `.emit()` on a Redis-adapter-backed room doesn't
   * itself await the underlying cross-instance publish (fire-and-forget,
   * same as chat's push), so a live Redis outage would most likely fail
   * *silently* (the callee's other instance never receives it) rather than
   * throw here — this guard only covers the narrower case of a genuine
   * synchronous exception. The `CallSession` row is already durably created
   * before this runs, so a failed push never loses the call record — the
   * callee just doesn't get the live ring and would need to poll
   * `GET /v1/calls/:matchId/active` instead (2026-09-18 audit: this
   * poll-based fallback already exists and was confirmed, not assumed).
   */
  pushIncoming(
    recipientId: string,
    payload: {
      callSessionId: string;
      matchId: string;
      type: string;
      fromUserId: string;
    },
  ): void {
    try {
      this.server.to(roomForUser(recipientId)).emit('call:incoming', payload);
    } catch (error) {
      this.logger.warn(
        `call:incoming push to ${recipientId} failed for session ${payload.callSessionId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /** FR-192: a UX-only nudge — see CallService.scheduleLimitNudge()'s own doc comment. */
  pushLimitReached(userId: string, payload: { callSessionId: string }): void {
    try {
      this.server.to(roomForUser(userId)).emit('call:limit-reached', payload);
    } catch (error) {
      this.logger.warn(
        `call:limit-reached push to ${userId} failed for session ${payload.callSessionId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /**
   * FR-187: relays an opaque SDP/ICE payload verbatim — this handler is not
   * WebRTC-aware and never inspects `payload.payload`'s contents. Re-checks
   * real participant/block state on every single call (assertSignalable),
   * not just once at call start, and only ever relays to the call's real
   * other participant — never wherever the client claims `toUserId` is.
   *
   * **A real, confirmed, NOT-fully-closed gap from the 2026-09-18 audit**:
   * unlike chat (durable Postgres persistence independent of the push) or
   * `pushIncoming` above (a real polling fallback exists), there is no
   * fallback of any kind for a signal message lost during a cross-instance
   * Redis outage — an SDP offer/answer/ICE candidate that never arrives is
   * simply gone, and neither side has any way to know it didn't. A real fix
   * would need an application-level acknowledgment/retry protocol for
   * signaling messages, which doesn't exist today and is a genuinely new
   * piece of protocol design, not a resilience patch — left for an explicit
   * design decision rather than built unilaterally here.
   */
  @SubscribeMessage('call:signal')
  async handleCallSignal(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: CallSignalPayload,
  ): Promise<void> {
    const userId = (socket.data as { userId: string }).userId;
    const { otherId } = await this.callService.assertSignalable(
      body.callSessionId,
      userId,
    );
    if (body.toUserId !== otherId) return; // never relay to anyone but the call's real other participant
    this.server.to(roomForUser(otherId)).emit('call:signal', {
      callSessionId: body.callSessionId,
      fromUserId: userId,
      payload: body.payload,
    });
  }

  /** FR-188: the socket entry point into the same CallService.end() the REST endpoint uses. */
  @SubscribeMessage('call:hangup')
  async handleCallHangup(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: CallHangupPayload,
  ): Promise<void> {
    const userId = (socket.data as { userId: string }).userId;
    const { session, otherId } = await this.callService.assertSignalable(
      body.callSessionId,
      userId,
    );
    await this.callService.end(userId, session.matchId, body.callSessionId, {});
    this.server.to(roomForUser(otherId)).emit('call:hangup', {
      callSessionId: body.callSessionId,
      reason: body.reason ?? 'COMPLETED',
    });
  }
}
