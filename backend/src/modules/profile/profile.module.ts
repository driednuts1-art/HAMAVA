import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { ImageProcessorService } from './image-processor.service';
import { STORAGE_PROVIDER } from './storage/storage-provider.interface';
import { S3StorageProvider } from './storage/s3-storage.provider';
import { MALWARE_SCAN_PROVIDER } from './moderation/malware-scan-provider.interface';
import { ClamAvMalwareScanProvider } from './moderation/clamav-malware-scan.provider';
import { AttributeProvenanceService } from './attribute-provenance.service';

@Module({
  imports: [
    AuthModule,
    MulterModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: config.getOrThrow<number>('PROFILE_MAX_UPLOAD_BYTES'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ProfileController],
  providers: [
    ProfileService,
    ImageProcessorService,
    AttributeProvenanceService,
    // Real provider — S3-compatible object storage (docs/roadmap.md §3, Feature 7).
    { provide: STORAGE_PROVIDER, useClass: S3StorageProvider },
    // Real provider — scans via a clamd daemon (docs/roadmap.md §4).
    { provide: MALWARE_SCAN_PROVIDER, useClass: ClamAvMalwareScanProvider },
  ],
  // Exported so ProductionSafetyService can check none of these is still a mock,
  // and so other modules (e.g. Settings, Feature 6) can reuse STORAGE_PROVIDER.
  // CONTENT_MODERATION_PROVIDER moved to the global CommonModerationModule (shared
  // with Chat, Feature 4) — no longer bound or exported here.
  // ProfileService exported so Feature 11's ConversationalSetupModule can
  // reuse the exact same PATCH /v1/profile write path (FR-141) rather than
  // reimplementing it.
  exports: [STORAGE_PROVIDER, MALWARE_SCAN_PROVIDER, ProfileService],
})
export class ProfileModule {}
