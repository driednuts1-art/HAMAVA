import { BadRequestException, Injectable } from '@nestjs/common';
import { DiscoveryPreferences, Gender, RelationshipGoal } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

export type EffectivePreferences = Pick<
  DiscoveryPreferences,
  | 'minAge'
  | 'maxAge'
  | 'genderPref'
  | 'relationshipGoalPref'
  | 'verifiedOnly'
  | 'activeThisWeekOnly'
  | 'newMembersOnly'
>;

// FR-47: verifiedOnly defaults to true even before a user ever saves preferences.
const DEFAULTS: EffectivePreferences = {
  minAge: 18,
  maxAge: 100,
  genderPref: [] as Gender[],
  relationshipGoalPref: [] as RelationshipGoal[],
  verifiedOnly: true,
  activeThisWeekOnly: false,
  newMembersOnly: false,
};

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async getEffective(userId: string): Promise<EffectivePreferences> {
    // A bare findUnique() previously returned the full Prisma row (userId,
    // updatedAt included) once a user had ever saved preferences once —
    // this method's own declared return type (EffectivePreferences, 6
    // fields) was a lie in that case. A real, reproduced bug: the frontend's
    // filters panel spreads this exact response into its own PATCH payload
    // (the same "edit the current values" pattern every other settings-style
    // screen in this app uses), and the backend's own class-validator
    // whitelist then genuinely rejected userId/updatedAt as unrecognized
    // properties — a real 400 on every "apply filters" click for any user
    // who had ever saved preferences before, found via direct browser
    // reproduction + a real network-request capture, not assumed. select:
    // fixes it at the root — this method can now never return more than it
    // declares, regardless of what the row actually contains.
    const row = await this.prisma.discoveryPreferences.findUnique({
      where: { userId },
      select: {
        minAge: true,
        maxAge: true,
        genderPref: true,
        relationshipGoalPref: true,
        verifiedOnly: true,
        activeThisWeekOnly: true,
        newMembersOnly: true,
      },
    });
    return row ?? DEFAULTS;
  }

  async update(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<EffectivePreferences> {
    const current = await this.getEffective(userId);
    const minAge = dto.minAge ?? current.minAge;
    const maxAge = dto.maxAge ?? current.maxAge;
    if (minAge > maxAge) {
      throw new BadRequestException('minAge must not be greater than maxAge.');
    }

    return this.prisma.discoveryPreferences.upsert({
      where: { userId },
      create: { userId, ...DEFAULTS, ...dto },
      update: { ...dto },
    });
  }
}
