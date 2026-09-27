import { computeAge } from '../../../common/age.util';
import { MatchExplanationFacts } from './match-explanation-provider.interface';

interface UserFactSource {
  displayName: string | null;
  birthDate: Date | null;
  city: string | null;
  bio: string | null;
  interests: string[];
  datingIntent: MatchExplanationFacts['datingIntent'];
}

/** FR-118: the exact same field set every caller must build facts from. */
export function toMatchExplanationFacts(
  user: UserFactSource,
): MatchExplanationFacts {
  return {
    displayName: user.displayName,
    age: user.birthDate ? computeAge(user.birthDate) : null,
    city: user.city,
    bio: user.bio,
    interests: user.interests,
    datingIntent: user.datingIntent,
  };
}
