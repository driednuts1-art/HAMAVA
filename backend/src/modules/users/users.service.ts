import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByPhoneHash(phoneHash: string) {
    return this.prisma.user.findUnique({ where: { phoneHash } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** Also stamps lastActiveAt (Feature 3 FR-49) — this runs on every successful OTP verify (login). */
  findOrCreateByPhoneHash(phoneHash: string) {
    const now = new Date();
    return this.prisma.user.upsert({
      where: { phoneHash },
      update: { lastActiveAt: now },
      create: { phoneHash, lastActiveAt: now },
    });
  }
}
