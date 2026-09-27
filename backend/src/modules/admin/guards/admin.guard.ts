import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';

/**
 * FR-76: must run after JwtAuthGuard (needs request.user.id already
 * populated). Looks the caller's role up fresh on every request rather than
 * trusting anything cached in the JWT — a role change takes effect
 * immediately, not only on the next token refresh, same "checked fresh"
 * principle already used for block enforcement (docs/requirements.md
 * Feature 5 §8).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { role: true },
    });
    if (user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required.');
    }
    return true;
  }
}
