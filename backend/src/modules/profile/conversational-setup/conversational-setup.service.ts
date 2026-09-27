import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationalSetupSessionStore } from './conversational-setup-session.store';
import { ConversationalSetupRateLimitService } from './conversational-setup-rate-limit.service';
import { CONVERSATIONAL_EXTRACTION_PROVIDER } from './conversational-extraction-provider.interface';
import type { ConversationalExtractionProviderInterface } from './conversational-extraction-provider.interface';
import { TRANSCRIPTION_PROVIDER } from '../../../common/ai/transcription-provider.interface';
import type { TranscriptionProviderInterface } from '../../../common/ai/transcription-provider.interface';
import { withProfileFallbackHint } from './vendor-failure.util';
import { ProfileService } from '../profile.service';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import {
  CONVERSATIONAL_FIELDS,
  ConversationalField,
  ConversationalSetupSession,
  ConversationalTurn,
  ExtractedTurnField,
} from './types';

const MAX_RECENT_TURNS = 10;

const OPENING_QUESTION: Record<ConversationalField, string> = {
  displayName:
    "Hi! Let's build your profile together. First, what's your name?",
  birthDate:
    "Hi! Let's build your profile together. First, what's your date of birth?",
  city: "Hi! Let's build your profile together. First, where do you live?",
  bio: "Hi! Let's build your profile together. Tell me a bit about yourself?",
  interests:
    "Hi! Let's build your profile together. What are you interested in?",
};

export interface StartResult {
  sessionId: string;
  remainingFields: ConversationalField[];
  assistantMessage: string;
}

export interface TurnResult {
  transcript?: string;
  proposed: ExtractedTurnField;
  assistantReply: string;
  remainingFields: ConversationalField[];
  completed: boolean;
}

export interface ConfirmResult {
  remainingFields: ConversationalField[];
  completed: boolean;
}

/**
 * Orchestrates FR-132..FR-148: session lifecycle, both turn entry points
 * (text/voice sharing one extraction call — FR-136..FR-139), and the
 * confirm-only write path (FR-140..FR-142). `ProfileService.updateProfile`
 * is called with source: 'CONVERSATIONAL' and is otherwise identical to
 * the direct `PATCH /v1/profile` call — no separate validation logic here.
 */
@Injectable()
export class ConversationalSetupService {
  constructor(
    private readonly sessions: ConversationalSetupSessionStore,
    private readonly rateLimit: ConversationalSetupRateLimitService,
    private readonly config: ConfigService,
    @Inject(CONVERSATIONAL_EXTRACTION_PROVIDER)
    private readonly extractionProvider: ConversationalExtractionProviderInterface,
    @Inject(TRANSCRIPTION_PROVIDER)
    private readonly transcriptionProvider: TranscriptionProviderInterface,
    private readonly profileService: ProfileService,
  ) {}

  private remainingFields(
    session: ConversationalSetupSession,
  ): ConversationalField[] {
    return CONVERSATIONAL_FIELDS.filter(
      (f) => !session.confirmedFields.includes(f),
    );
  }

  /** FR-133: every session-scoped call goes through this — 404 for missing OR wrong-owner, never a silent cross-user read. */
  private async loadOwnedSession(
    userId: string,
    sessionId: string,
  ): Promise<ConversationalSetupSession> {
    const session = await this.sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Conversational-setup session not found.');
    }
    return session;
  }

  /** FR-132/FR-134: no LLM call needed for the opening message — deterministic, from the first remaining field. */
  async start(userId: string): Promise<StartResult> {
    await this.rateLimit.enforce(userId, 'SESSION_START');
    const session = await this.sessions.create(userId);
    const remaining = this.remainingFields(session);
    return {
      sessionId: session.sessionId,
      remainingFields: remaining,
      assistantMessage: OPENING_QUESTION[remaining[0]],
    };
  }

  /** FR-136: text turn. */
  async submitText(
    userId: string,
    sessionId: string,
    text: string,
  ): Promise<TurnResult> {
    const session = await this.loadOwnedSession(userId, sessionId);
    await this.rateLimit.enforce(userId, 'TEXT_TURN');
    return this.runTurn(session, text);
  }

  /**
   * FR-137: voice turn — transcribes via the shared Whisper provider, then
   * feeds the transcript through the identical `runTurn` path the text
   * endpoint uses (FR-108's "one implementation, two entry points" mirrored
   * exactly). FR-145: the audio buffer is only ever read here, once, and
   * discarded — nothing in this method (or its caller) writes it anywhere.
   */
  async submitVoice(
    userId: string,
    sessionId: string,
    audio: Buffer,
    originalFilename: string,
    mimeType: string,
  ): Promise<TurnResult> {
    const session = await this.loadOwnedSession(userId, sessionId);
    await this.rateLimit.enforce(userId, 'VOICE_TURN');
    const transcript = await withProfileFallbackHint(() =>
      this.transcriptionProvider.transcribe(audio, originalFilename, mimeType),
    );
    const result = await this.runTurn(session, transcript);
    return { ...result, transcript };
  }

  private async runTurn(
    session: ConversationalSetupSession,
    latestUserMessage: string,
  ): Promise<TurnResult> {
    const maxTurns = this.config.getOrThrow<number>(
      'CONVERSATIONAL_SETUP_MAX_TURNS',
    );
    if (session.turnCount >= maxTurns) {
      // Open Items #6: a concrete ceiling — the flow itself points at the
      // always-available manual fallback rather than continuing indefinitely.
      throw new ConflictException(
        'This conversation has reached its turn limit. Please finish via PATCH /v1/profile.',
      );
    }

    const remaining = this.remainingFields(session);
    const { proposed, assistantReply } = await withProfileFallbackHint(() =>
      this.extractionProvider.extractTurn(
        session.recentTurns,
        remaining,
        latestUserMessage,
      ),
    );

    const newTurns: ConversationalTurn[] = [
      { role: 'user', content: latestUserMessage },
      { role: 'assistant', content: assistantReply },
    ];
    session.recentTurns = [...session.recentTurns, ...newTurns].slice(
      -MAX_RECENT_TURNS,
    );
    session.turnCount += 1;
    // FR-287: remembered only when a real field was actually proposed —
    // cleared otherwise, so a later confirm() for an unrelated field never
    // picks up a stale confidence value from an earlier turn.
    session.lastProposal = proposed.field
      ? { field: proposed.field, confidence: proposed.confidence }
      : undefined;
    await this.sessions.save(session);

    return {
      proposed,
      assistantReply,
      remainingFields: remaining,
      completed: remaining.length === 0,
    };
  }

  /**
   * FR-140/FR-141: the ONLY path by which anything this feature produces
   * reaches the real `User` row — routed through `ProfileService.updateProfile`
   * unmodified (same validation/age-check/moderation as `PATCH /v1/profile`).
   */
  async confirm(
    userId: string,
    sessionId: string,
    dto: UpdateProfileDto,
  ): Promise<ConfirmResult> {
    const session = await this.loadOwnedSession(userId, sessionId);
    const field = this.singleConversationalField(dto);

    // FR-287: only attributed when the field being confirmed matches the
    // most recent real proposal — an unrelated/edited-from-scratch confirm
    // (no matching proposal in this session) carries no confidence claim.
    const confidenceByField =
      session.lastProposal?.field === field &&
      session.lastProposal.confidence !== null
        ? { [field]: session.lastProposal.confidence }
        : undefined;

    await this.profileService.updateProfile(
      userId,
      dto,
      'CONVERSATIONAL',
      confidenceByField,
    );

    if (!session.confirmedFields.includes(field)) {
      session.confirmedFields = [...session.confirmedFields, field];
      await this.sessions.save(session);
    }

    const remaining = this.remainingFields(session);
    return { remainingFields: remaining, completed: remaining.length === 0 };
  }

  /** FR-135: explicit end — discards immediately, without waiting for the TTL. */
  async end(userId: string, sessionId: string): Promise<void> {
    await this.loadOwnedSession(userId, sessionId);
    await this.sessions.delete(sessionId, userId);
  }

  /**
   * FR-141 (structural): the confirm body must name exactly one of the five
   * conversational fields — never zero, never more than one, and never
   * gender/datingIntent (out of this feature's scope entirely).
   */
  private singleConversationalField(
    dto: UpdateProfileDto,
  ): ConversationalField {
    if (dto.gender !== undefined || dto.datingIntent !== undefined) {
      throw new BadRequestException(
        'gender/datingIntent cannot be set via conversational setup.',
      );
    }
    const present = CONVERSATIONAL_FIELDS.filter((f) => dto[f] !== undefined);
    if (present.length !== 1) {
      throw new BadRequestException(
        'Exactly one field must be set to confirm (displayName, birthDate, city, bio, or interests).',
      );
    }
    return present[0];
  }
}
