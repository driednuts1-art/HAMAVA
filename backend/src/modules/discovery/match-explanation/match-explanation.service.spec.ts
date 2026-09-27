import { ServiceUnavailableException } from '@nestjs/common';
import type {
  GeneratedExplanation,
  MatchExplanationProviderInterface,
} from './match-explanation-provider.interface';
import { MatchExplanationService } from './match-explanation.service';

const PERSON_A = {
  displayName: 'Sara',
  age: 27,
  city: 'Tehran',
  bio: 'I love hiking and reading',
  interests: ['hiking', 'books'],
  datingIntent: 'SERIOUS' as const,
};
const PERSON_B = {
  displayName: 'Ali',
  age: 29,
  city: 'Tehran',
  bio: 'Software engineer who loves the outdoors',
  interests: ['hiking'],
  datingIntent: 'SERIOUS' as const,
};

// FR-119's dedicated low-information-profile test case: only displayName +
// city (the sparsest realistic complete profile — FR-34 needs at least a
// name/birthdate/photo to match at all).
const SPARSE_PERSON = {
  displayName: 'Reza',
  age: null,
  city: 'Shiraz',
  bio: null,
  interests: [],
  datingIntent: null,
};

const HIKING_EXPLANATION: GeneratedExplanation = {
  reasons: ['You both love hiking in Tehran.'],
  mismatches: [],
};

describe('MatchExplanationService (FR-118..FR-121, extended by Feature 21 FR-302..FR-304)', () => {
  let service: MatchExplanationService;
  let provider: jest.Mocked<MatchExplanationProviderInterface>;

  beforeEach(() => {
    provider = {
      generate: jest.fn(),
      checkGrounded: jest.fn(),
    };
    service = new MatchExplanationService(provider);
  });

  it('returns the structured explanation when generation succeeds and the grounding check passes', async () => {
    provider.generate.mockResolvedValue(HIKING_EXPLANATION);
    provider.checkGrounded.mockResolvedValue({
      grounded: true,
      unsupportedClaim: null,
    });

    const result = await service.generate(PERSON_A, PERSON_B);

    expect(result).toEqual(HIKING_EXPLANATION);
    expect(provider.checkGrounded).toHaveBeenCalledWith(
      PERSON_A,
      PERSON_B,
      HIKING_EXPLANATION,
    );
  });

  it('preserves a real, honest empty mismatches array — not treated as a failure (FR-304)', async () => {
    const explanation: GeneratedExplanation = {
      reasons: ['Both are looking for something serious.'],
      mismatches: [],
    };
    provider.generate.mockResolvedValue(explanation);
    provider.checkGrounded.mockResolvedValue({
      grounded: true,
      unsupportedClaim: null,
    });

    const result = await service.generate(PERSON_A, PERSON_B);

    expect(result?.mismatches).toEqual([]);
  });

  it('discards the WHOLE explanation (reasons and mismatches) when the grounding check reports it ungrounded — proving the check actually discriminates (Open Items #3)', async () => {
    provider.generate.mockResolvedValue({
      reasons: [
        'You both grew up in the same neighborhood and love scuba diving.',
      ],
      mismatches: [],
    });
    provider.checkGrounded.mockResolvedValue({
      grounded: false,
      unsupportedClaim: 'scuba diving is not in either profile',
    });

    const result = await service.generate(PERSON_A, PERSON_B);

    expect(result).toBeNull();
  });

  it('discards the whole explanation when a MISMATCH claim (not a reason) is flagged as fabricated (FR-302)', async () => {
    provider.generate.mockResolvedValue({
      reasons: ['Both love hiking.'],
      mismatches: ["One of them secretly dislikes the other's favorite band"],
    });
    provider.checkGrounded.mockResolvedValue({
      grounded: false,
      unsupportedClaim:
        "a secret dislike of the other's favorite band is not in either profile",
    });

    const result = await service.generate(PERSON_A, PERSON_B);

    expect(result).toBeNull();
  });

  it('returns null, never throws, when the generation call itself fails (fail-open, FR-121)', async () => {
    // OpenAiMatchExplanationProvider's own real fail-closed contract throws
    // ServiceUnavailableException, not a bare Error — matching that shape
    // keeps this test accurate even though generate()'s own catch block
    // doesn't currently discriminate by type.
    provider.generate.mockRejectedValue(
      new ServiceUnavailableException('vendor down'),
    );

    await expect(service.generate(PERSON_A, PERSON_B)).resolves.toBeNull();
    expect(provider.checkGrounded).not.toHaveBeenCalled();
  });

  it('returns null, never throws, when the grounding-check call itself fails (fail-open, FR-121)', async () => {
    provider.generate.mockResolvedValue(HIKING_EXPLANATION);
    provider.checkGrounded.mockRejectedValue(new Error('vendor down'));

    await expect(service.generate(PERSON_A, PERSON_B)).resolves.toBeNull();
  });

  it('handles a very low-information profile (name + city only, no bio) without fabricating — dedicated test requested in review', async () => {
    // The real vendor call is mocked here (this is a unit test); the actual
    // no-fabrication guarantee for this exact scenario is proven for real
    // against the live vendor in the e2e suite. This test proves the
    // service passes the sparse facts through unmodified and still respects
    // whatever the grounding check reports — it doesn't silently enrich or
    // skip verification just because one side has little data.
    const explanation: GeneratedExplanation = {
      reasons: ['Reza and Sara might get along well.'],
      mismatches: [],
    };
    provider.generate.mockResolvedValue(explanation);
    provider.checkGrounded.mockResolvedValue({
      grounded: true,
      unsupportedClaim: null,
    });

    const result = await service.generate(PERSON_A, SPARSE_PERSON);

    expect(provider.generate).toHaveBeenCalledWith(PERSON_A, SPARSE_PERSON);
    expect(provider.checkGrounded).toHaveBeenCalledWith(
      PERSON_A,
      SPARSE_PERSON,
      explanation,
    );
    expect(result).toEqual(explanation);
  });

  it('discards a sparse-profile explanation the grounding check flags as fabricated', async () => {
    provider.generate.mockResolvedValue({
      reasons: ['You both love photography and travel.'],
      mismatches: [],
    });
    provider.checkGrounded.mockResolvedValue({
      grounded: false,
      unsupportedClaim: 'photography and travel are not in either profile',
    });

    const result = await service.generate(PERSON_A, SPARSE_PERSON);

    expect(result).toBeNull();
  });
});
