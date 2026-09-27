import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsEventProviderInterface } from './analytics-event-provider.interface';

/**
 * FR-151: the only implementation for now — persists to a real
 * `AnalyticsEvent` row rather than only logging (a deliberate departure
 * from the OTP/liveness mocks' log-only precedent), because the reason
 * this exists at all is to let a real product decision ("was Feature 11's
 * OpenAI cost worth it?") be answered by querying real accumulated data.
 * A real analytics vendor (`product.md` §11 — PostHog EU Cloud or
 * equivalent) is a distinct, future, explicitly-flagged swap
 * (`docs/roadmap.md`), like every other mocked provider in this project —
 * "mock" here describes the vendor, not the data's reality.
 */
@Injectable()
export class MockAnalyticsEventProvider implements AnalyticsEventProviderInterface {
  constructor(private readonly prisma: PrismaService) {}

  async track(
    event: string,
    userId: string,
    properties: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.analyticsEvent.create({
      data: { userId, event, properties: properties as Prisma.InputJsonValue },
    });
  }
}
