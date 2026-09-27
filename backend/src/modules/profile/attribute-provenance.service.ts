import { Injectable, Logger } from '@nestjs/common';
import { AttributeSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * FR-286..FR-289 (Feature 21): records which real entry path produced each
 * profile field's current value. Latest-known-provenance only (upsert on
 * `(userId, field)`), not a full history — see docs/requirements.md Feature
 * 21 §3 for why. Deliberately fail-open: a provenance-write hiccup must
 * never block a real profile save, the same posture
 * ProfileService.recomputeBioEmbedding() already established for a
 * different non-critical side effect of the same write.
 */
@Injectable()
export class AttributeProvenanceService {
  private readonly logger = new Logger(AttributeProvenanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    userId: string,
    field: string,
    source: AttributeSource,
    confidence: number | null,
  ): Promise<void> {
    try {
      await this.prisma.profileAttributeProvenance.upsert({
        where: { userId_field: { userId, field } },
        create: { userId, field, source, confidence },
        update: { source, confidence, confirmedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        `Could not record attribute provenance for user ${userId}, field ${field}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async recordMany(
    userId: string,
    fields: string[],
    source: AttributeSource,
    confidenceByField?: Partial<Record<string, number>>,
  ): Promise<void> {
    await Promise.all(
      fields.map((field) =>
        this.record(userId, field, source, confidenceByField?.[field] ?? null),
      ),
    );
  }
}
