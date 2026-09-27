import { Socket } from 'socket.io';
import { TokenService } from '../auth/tokens/token.service';
import { CallService } from '../calls/call.service';
import { PresenceService } from '../presence/presence.service';
import { ChatGateway } from './chat.gateway';

function fakeSocket(userId: string): Socket {
  return { data: { userId } } as unknown as Socket;
}

describe('ChatGateway — call signaling (FR-185..FR-188)', () => {
  let gateway: ChatGateway;
  let callService: jest.Mocked<Pick<CallService, 'assertSignalable' | 'end'>>;
  let emit: jest.Mock;
  let to: jest.Mock;

  beforeEach(() => {
    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    callService = {
      assertSignalable: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
    };

    gateway = new ChatGateway(
      {} as unknown as TokenService,
      callService as unknown as CallService,
      {} as unknown as PresenceService,
    );
    // @WebSocketServer() is populated by Nest at runtime — set it directly
    // for this unit test, matching how this codebase already unit-tests
    // gateway-adjacent logic without a real Socket.IO server.
    Object.defineProperty(gateway, 'server', {
      value: { to },
      writable: true,
    });
  });

  describe('call:signal', () => {
    it('re-validates the sender via assertSignalable on every single signal, not just once', async () => {
      callService.assertSignalable.mockResolvedValue({
        session: { id: 's1' } as never,
        match: {} as never,
        otherId: 'user-2',
      });

      await gateway.handleCallSignal(fakeSocket('user-1'), {
        callSessionId: 's1',
        toUserId: 'user-2',
        payload: { type: 'offer', sdp: 'fake-sdp' },
      });

      expect(callService.assertSignalable).toHaveBeenCalledWith('s1', 'user-1');
    });

    it('relays the opaque payload verbatim to the real other participant', async () => {
      callService.assertSignalable.mockResolvedValue({
        session: { id: 's1' } as never,
        match: {} as never,
        otherId: 'user-2',
      });

      await gateway.handleCallSignal(fakeSocket('user-1'), {
        callSessionId: 's1',
        toUserId: 'user-2',
        payload: { type: 'offer', sdp: 'fake-sdp' },
      });

      expect(to).toHaveBeenCalledWith('user:user-2');
      expect(emit).toHaveBeenCalledWith('call:signal', {
        callSessionId: 's1',
        fromUserId: 'user-1',
        payload: { type: 'offer', sdp: 'fake-sdp' },
      });
    });

    it('never relays if the claimed toUserId is not the real other participant (defense in depth)', async () => {
      callService.assertSignalable.mockResolvedValue({
        session: { id: 's1' } as never,
        match: {} as never,
        otherId: 'user-2',
      });

      await gateway.handleCallSignal(fakeSocket('user-1'), {
        callSessionId: 's1',
        toUserId: 'someone-else-entirely',
        payload: { type: 'offer', sdp: 'fake-sdp' },
      });

      expect(to).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('propagates a rejection from assertSignalable (e.g. a since-blocked participant) without relaying anything', async () => {
      callService.assertSignalable.mockRejectedValue(
        new Error('not accessible'),
      );

      await expect(
        gateway.handleCallSignal(fakeSocket('user-1'), {
          callSessionId: 's1',
          toUserId: 'user-2',
          payload: {},
        }),
      ).rejects.toThrow('not accessible');
      expect(to).not.toHaveBeenCalled();
    });
  });

  describe('call:hangup', () => {
    it('calls the same CallService.end() the REST endpoint uses, then relays to the other participant', async () => {
      callService.assertSignalable.mockResolvedValue({
        session: { id: 's1', matchId: 'match-1' } as never,
        match: {} as never,
        otherId: 'user-2',
      });

      await gateway.handleCallHangup(fakeSocket('user-1'), {
        callSessionId: 's1',
        reason: 'DECLINED',
      });

      expect(callService.end).toHaveBeenCalledWith(
        'user-1',
        'match-1',
        's1',
        {},
      );
      expect(to).toHaveBeenCalledWith('user:user-2');
      expect(emit).toHaveBeenCalledWith('call:hangup', {
        callSessionId: 's1',
        reason: 'DECLINED',
      });
    });

    it('defaults the relayed reason to COMPLETED when none is given', async () => {
      callService.assertSignalable.mockResolvedValue({
        session: { id: 's1', matchId: 'match-1' } as never,
        match: {} as never,
        otherId: 'user-2',
      });

      await gateway.handleCallHangup(fakeSocket('user-1'), {
        callSessionId: 's1',
      });

      expect(emit).toHaveBeenCalledWith('call:hangup', {
        callSessionId: 's1',
        reason: 'COMPLETED',
      });
    });
  });

  describe('server-initiated pushes', () => {
    it("pushIncoming emits call:incoming to the recipient's room (FR-186)", () => {
      gateway.pushIncoming('user-2', {
        callSessionId: 's1',
        matchId: 'match-1',
        type: 'VOICE',
        fromUserId: 'user-1',
      });
      expect(to).toHaveBeenCalledWith('user:user-2');
      expect(emit).toHaveBeenCalledWith('call:incoming', {
        callSessionId: 's1',
        matchId: 'match-1',
        type: 'VOICE',
        fromUserId: 'user-1',
      });
    });

    it("pushLimitReached emits call:limit-reached to the given user's room (FR-192)", () => {
      gateway.pushLimitReached('user-1', { callSessionId: 's1' });
      expect(to).toHaveBeenCalledWith('user:user-1');
      expect(emit).toHaveBeenCalledWith('call:limit-reached', {
        callSessionId: 's1',
      });
    });

    it("pushIncoming never throws even if the underlying emit does (2026-09-18 audit — defensive-in-depth, matching MessageService.pushNewMessage's own precedent)", () => {
      emit.mockImplementation(() => {
        throw new Error('Redis pub client error: getaddrinfo ENOTFOUND');
      });
      expect(() =>
        gateway.pushIncoming('user-2', {
          callSessionId: 's1',
          matchId: 'match-1',
          type: 'VOICE',
          fromUserId: 'user-1',
        }),
      ).not.toThrow();
    });

    it('pushLimitReached never throws even if the underlying emit does', () => {
      emit.mockImplementation(() => {
        throw new Error('Redis pub client error: getaddrinfo ENOTFOUND');
      });
      expect(() =>
        gateway.pushLimitReached('user-1', { callSessionId: 's1' }),
      ).not.toThrow();
    });
  });
});
