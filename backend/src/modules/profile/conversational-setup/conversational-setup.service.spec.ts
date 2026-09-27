import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConversationalSetupService } from './conversational-setup.service';
import { ConversationalSetupSessionStore } from './conversational-setup-session.store';
import { ConversationalSetupRateLimitService } from './conversational-setup-rate-limit.service';
import { ProfileService } from '../profile.service';
import type { ConversationalExtractionProviderInterface } from './conversational-extraction-provider.interface';
import type { TranscriptionProviderInterface } from '../../../common/ai/transcription-provider.interface';
import type { ConversationalSetupSession, ExtractedTurnField } from './types';

const CONFIG: Record<string, number> = {
  CONVERSATIONAL_SETUP_MAX_TURNS: 20,
};

const EMPTY_PROPOSED: ExtractedTurnField = {
  field: null,
  stringValue: null,
  interestsValue: null,
  birthDateGregorian: null,
  birthDateDisplay: null,
  confidence: null,
};

function baseSession(
  overrides: Partial<ConversationalSetupSession> = {},
): ConversationalSetupSession {
  return {
    sessionId: 's1',
    userId: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    confirmedFields: [],
    recentTurns: [],
    turnCount: 0,
    ...overrides,
  };
}

describe('ConversationalSetupService', () => {
  let service: ConversationalSetupService;
  let sessions: jest.Mocked<ConversationalSetupSessionStore>;
  let rateLimit: jest.Mocked<ConversationalSetupRateLimitService>;
  let extractionProvider: jest.Mocked<ConversationalExtractionProviderInterface>;
  let transcriptionProvider: jest.Mocked<TranscriptionProviderInterface>;
  let profileService: { updateProfile: jest.Mock };

  beforeEach(() => {
    sessions = {
      create: jest.fn(),
      get: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ConversationalSetupSessionStore>;
    rateLimit = {
      enforce: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ConversationalSetupRateLimitService>;
    extractionProvider = {
      extractTurn: jest.fn(),
    };
    transcriptionProvider = { transcribe: jest.fn() };
    profileService = { updateProfile: jest.fn().mockResolvedValue({}) };

    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new ConversationalSetupService(
      sessions,
      rateLimit,
      config,
      extractionProvider,
      transcriptionProvider,
      profileService as unknown as ProfileService,
    );
  });

  describe('start (FR-132)', () => {
    it('rate-limits, creates a session, and opens with a question about the first remaining field', async () => {
      sessions.create.mockResolvedValue(baseSession());

      const result = await service.start('user-1');

      expect(rateLimit.enforce).toHaveBeenCalledWith('user-1', 'SESSION_START');
      expect(result.sessionId).toBe('s1');
      expect(result.remainingFields).toEqual([
        'displayName',
        'birthDate',
        'city',
        'bio',
        'interests',
      ]);
      expect(result.assistantMessage).toContain('name');
    });
  });

  describe('session-scoped authorization (FR-133)', () => {
    it('throws NotFoundException for an unknown session', async () => {
      sessions.get.mockResolvedValue(null);
      await expect(service.submitText('user-1', 's1', 'hi')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException for another user's session — never a silent cross-user read", async () => {
      sessions.get.mockResolvedValue(baseSession({ userId: 'someone-else' }));
      await expect(service.submitText('user-1', 's1', 'hi')).rejects.toThrow(
        NotFoundException,
      );
      expect(extractionProvider.extractTurn).not.toHaveBeenCalled();
    });
  });

  describe('submitText / submitVoice (FR-136..FR-139)', () => {
    it('proposes at most one field and returns the assistant reply + remaining fields', async () => {
      sessions.get.mockResolvedValue(
        baseSession({ confirmedFields: ['displayName'] }),
      );
      extractionProvider.extractTurn.mockResolvedValue({
        proposed: { ...EMPTY_PROPOSED, field: 'city', stringValue: 'Toronto' },
        assistantReply: 'What a nice city!',
      });

      const result = await service.submitText(
        'user-1',
        's1',
        'I live in Toronto',
      );

      expect(rateLimit.enforce).toHaveBeenCalledWith('user-1', 'TEXT_TURN');
      expect(extractionProvider.extractTurn).toHaveBeenCalledWith(
        [],
        ['birthDate', 'city', 'bio', 'interests'],
        'I live in Toronto',
      );
      expect(result.proposed.field).toBe('city');
      expect(result.remainingFields).toEqual([
        'birthDate',
        'city',
        'bio',
        'interests',
      ]);
      expect(result.completed).toBe(false);
      expect(sessions.save).toHaveBeenCalled();
    });

    it("remembers the proposed field's confidence on the session for a later confirm to pick up (FR-287)", async () => {
      sessions.get.mockResolvedValue(baseSession());
      extractionProvider.extractTurn.mockResolvedValue({
        proposed: {
          ...EMPTY_PROPOSED,
          field: 'displayName',
          stringValue: 'Alex',
          confidence: 0.92,
        },
        assistantReply: 'Got it!',
      });

      await service.submitText('user-1', 's1', 'My name is Alex');

      const saved = sessions.save.mock.calls[0][0];
      expect(saved.lastProposal).toEqual({
        field: 'displayName',
        confidence: 0.92,
      });
    });

    it('clears lastProposal when a turn proposes nothing (field: null) — a later confirm carries no stale confidence', async () => {
      sessions.get.mockResolvedValue(
        baseSession({ lastProposal: { field: 'city', confidence: 0.5 } }),
      );
      extractionProvider.extractTurn.mockResolvedValue({
        proposed: EMPTY_PROPOSED,
        assistantReply: 'Could you say that again?',
      });

      await service.submitText('user-1', 's1', 'gibberish');

      const saved = sessions.save.mock.calls[0][0];
      expect(saved.lastProposal).toBeUndefined();
    });

    it('never persists anything from a turn — only a subsequent confirm call writes (FR-140)', async () => {
      sessions.get.mockResolvedValue(baseSession());
      extractionProvider.extractTurn.mockResolvedValue({
        proposed: {
          ...EMPTY_PROPOSED,
          field: 'displayName',
          stringValue: 'Alex',
        },
        assistantReply: 'Got it!',
      });

      await service.submitText('user-1', 's1', 'My name is Alex');

      expect(profileService.updateProfile).not.toHaveBeenCalled();
    });

    it('voice turns transcribe first, then run the identical extraction path as text (FR-137/FR-108 mirrored)', async () => {
      sessions.get.mockResolvedValue(baseSession());
      transcriptionProvider.transcribe.mockResolvedValue('My name is Alex');
      extractionProvider.extractTurn.mockResolvedValue({
        proposed: {
          ...EMPTY_PROPOSED,
          field: 'displayName',
          stringValue: 'Alex',
        },
        assistantReply: 'Got it!',
      });

      const result = await service.submitVoice(
        'user-1',
        's1',
        Buffer.from('audio'),
        'clip.mp3',
        'audio/mpeg',
      );

      expect(rateLimit.enforce).toHaveBeenCalledWith('user-1', 'VOICE_TURN');
      expect(transcriptionProvider.transcribe).toHaveBeenCalledWith(
        Buffer.from('audio'),
        'clip.mp3',
        'audio/mpeg',
      );
      expect(extractionProvider.extractTurn).toHaveBeenCalledWith(
        [],
        expect.any(Array),
        'My name is Alex',
      );
      expect(result.transcript).toBe('My name is Alex');
      expect(result.proposed.field).toBe('displayName');
    });

    it('caps recentTurns to the last 10 entries (bounded window, FR-143)', async () => {
      const manyTurns = Array.from({ length: 9 }, (_, i) => ({
        role: 'user' as const,
        content: `turn ${i}`,
      }));
      sessions.get.mockResolvedValue(
        baseSession({ recentTurns: manyTurns, turnCount: 9 }),
      );
      extractionProvider.extractTurn.mockResolvedValue({
        proposed: EMPTY_PROPOSED,
        assistantReply: 'ok',
      });

      await service.submitText('user-1', 's1', 'latest message');

      const saved = sessions.save.mock.calls[0][0];
      expect(saved.recentTurns.length).toBe(10);
      expect(saved.recentTurns[saved.recentTurns.length - 2].content).toBe(
        'latest message',
      );
    });

    it('marks completed: true once every field is confirmed', async () => {
      sessions.get.mockResolvedValue(
        baseSession({
          confirmedFields: [
            'displayName',
            'birthDate',
            'city',
            'bio',
            'interests',
          ],
        }),
      );
      extractionProvider.extractTurn.mockResolvedValue({
        proposed: EMPTY_PROPOSED,
        assistantReply: 'Got everything!',
      });

      const result = await service.submitText('user-1', 's1', 'ok');

      expect(result.remainingFields).toEqual([]);
      expect(result.completed).toBe(true);
    });

    it('rejects further turns once the max-turn ceiling is reached, without calling the vendor (Open Items #6)', async () => {
      sessions.get.mockResolvedValue(baseSession({ turnCount: 20 }));

      await expect(service.submitText('user-1', 's1', 'hi')).rejects.toThrow(
        ConflictException,
      );
      expect(extractionProvider.extractTurn).not.toHaveBeenCalled();
    });

    it('a vendor failure surfaces as 503 naming the PATCH /v1/profile fallback (FR-147)', async () => {
      sessions.get.mockResolvedValue(baseSession());
      extractionProvider.extractTurn.mockRejectedValue(
        new ServiceUnavailableException('vendor down'),
      );

      await expect(service.submitText('user-1', 's1', 'hi')).rejects.toThrow(
        /PATCH \/v1\/profile/,
      );
    });
  });

  describe('confirm (FR-140..FR-142)', () => {
    it('writes through ProfileService.updateProfile with source: CONVERSATIONAL, and only that (FR-141)', async () => {
      sessions.get.mockResolvedValue(baseSession());

      await service.confirm('user-1', 's1', { displayName: 'Alex' });

      expect(profileService.updateProfile).toHaveBeenCalledWith(
        'user-1',
        { displayName: 'Alex' },
        'CONVERSATIONAL',
        undefined, // FR-287: no matching lastProposal in this session — no confidence claim
      );
    });

    it('rejects a body with zero conversational fields set', async () => {
      sessions.get.mockResolvedValue(baseSession());
      await expect(service.confirm('user-1', 's1', {})).rejects.toThrow(
        BadRequestException,
      );
      expect(profileService.updateProfile).not.toHaveBeenCalled();
    });

    it('rejects a body with more than one conversational field set', async () => {
      sessions.get.mockResolvedValue(baseSession());
      await expect(
        service.confirm('user-1', 's1', {
          displayName: 'Alex',
          city: 'Toronto',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects gender/datingIntent — out of this feature entirely', async () => {
      sessions.get.mockResolvedValue(baseSession());
      await expect(
        service.confirm('user-1', 's1', { gender: 'MALE' }),
      ).rejects.toThrow(BadRequestException);
      expect(profileService.updateProfile).not.toHaveBeenCalled();
    });

    it('an edited value (different from what was proposed) is exactly what gets persisted', async () => {
      sessions.get.mockResolvedValue(baseSession());

      await service.confirm('user-1', 's1', { displayName: 'Edited name' });

      expect(profileService.updateProfile).toHaveBeenCalledWith(
        'user-1',
        { displayName: 'Edited name' },
        'CONVERSATIONAL',
        undefined,
      );
    });

    it("attaches the AI proposal's own confidence when confirming the SAME field it was proposed for (FR-287)", async () => {
      sessions.get.mockResolvedValue(
        baseSession({
          lastProposal: { field: 'displayName', confidence: 0.87 },
        }),
      );

      await service.confirm('user-1', 's1', { displayName: 'Alex' });

      expect(profileService.updateProfile).toHaveBeenCalledWith(
        'user-1',
        { displayName: 'Alex' },
        'CONVERSATIONAL',
        { displayName: 0.87 },
      );
    });

    it('carries no confidence claim when confirming a DIFFERENT field than the last real proposal (FR-287)', async () => {
      sessions.get.mockResolvedValue(
        baseSession({ lastProposal: { field: 'city', confidence: 0.9 } }),
      );

      await service.confirm('user-1', 's1', { displayName: 'Alex' });

      expect(profileService.updateProfile).toHaveBeenCalledWith(
        'user-1',
        { displayName: 'Alex' },
        'CONVERSATIONAL',
        undefined,
      );
    });

    it('adds the confirmed field to session state and reflects it in remainingFields', async () => {
      sessions.get.mockResolvedValue(baseSession());

      const result = await service.confirm('user-1', 's1', {
        displayName: 'Alex',
      });

      expect(result.remainingFields).toEqual([
        'birthDate',
        'city',
        'bio',
        'interests',
      ]);
      expect(sessions.save).toHaveBeenCalledWith(
        expect.objectContaining({ confirmedFields: ['displayName'] }),
      );
    });

    it('propagates a real Feature 2 validation rejection unchanged (e.g. under-18 birthDate, FR-20)', async () => {
      sessions.get.mockResolvedValue(baseSession());
      profileService.updateProfile.mockRejectedValue(
        new BadRequestException(
          'birthDate must correspond to an age between 18 and 100.',
        ),
      );

      await expect(
        service.confirm('user-1', 's1', { birthDate: '2020-01-01' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('end (FR-135)', () => {
    it('discards the session immediately', async () => {
      sessions.get.mockResolvedValue(baseSession());
      await service.end('user-1', 's1');
      expect(sessions.delete).toHaveBeenCalledWith('s1', 'user-1');
    });

    it("cannot end another user's session", async () => {
      sessions.get.mockResolvedValue(baseSession({ userId: 'someone-else' }));
      await expect(service.end('user-1', 's1')).rejects.toThrow(
        NotFoundException,
      );
      expect(sessions.delete).not.toHaveBeenCalled();
    });
  });
});
