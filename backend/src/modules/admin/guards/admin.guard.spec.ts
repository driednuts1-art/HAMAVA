import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminGuard } from './admin.guard';

function contextWithUser(userId: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: userId } }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  let guard: AdminGuard;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    guard = new AdminGuard(prisma as unknown as PrismaService);
  });

  it('allows a caller whose role is ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.ADMIN });
    await expect(guard.canActivate(contextWithUser('admin-1'))).resolves.toBe(
      true,
    );
  });

  it('rejects a caller whose role is USER (FR-76)', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.USER });
    await expect(guard.canActivate(contextWithUser('user-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects when the user record cannot be found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(contextWithUser('ghost-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('looks the role up fresh every call — no caching', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.ADMIN });
    await guard.canActivate(contextWithUser('admin-1'));
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      select: { role: true },
    });
  });
});
