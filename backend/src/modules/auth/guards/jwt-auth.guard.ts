import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { TokenService } from '../tokens/token.service';
import { UsersService } from '../../users/users.service';

export interface AuthenticatedRequest extends Request {
  user: { id: string };
}

/**
 * Feature 20, found during pre-implementation verification (not by a test):
 * a real access token is purely a signed, self-contained claim — verifying
 * it (TokenService.verifyAccessToken) only checks the signature and
 * expiry, never whether the user it names still exists. Before this fix,
 * a still-unexpired token for a just-deleted account (Feature 6's real,
 * synchronous `DELETE /v1/users/me`) passed this guard exactly as if the
 * account were real, and whatever ran next either 500'd on a Prisma "not
 * found" (most `findUniqueOrThrow` call sites) or, worse, could silently
 * act on a nonexistent user's id on any endpoint that doesn't re-fetch the
 * row. Confirmed directly against the real running backend before this fix
 * (not assumed): delete a real user, then reuse its real, still-valid
 * access token against `GET /v1/users/me/settings` — real 500, not 401/403.
 * Fixed by re-checking real existence on every request, the one place that
 * protects every authenticated endpoint uniformly rather than requiring
 * each service to defend against a deleted-but-still-token-bearing caller
 * on its own.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    const payload = await this.tokenService.verifyAccessToken(
      authHeader.slice('Bearer '.length),
    );

    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('This account no longer exists.');
    }

    request.user = { id: payload.sub };
    return true;
  }
}
