import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/entities/user.entity';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  function makeContext(role?: UserRole) {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn(() => ({
        getRequest: jest.fn(() => ({
          user: role ? { role } : undefined,
        })),
      })),
    } as any;
  }

  it('allows admin when admin role is required', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => [UserRole.ADMIN]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(makeContext(UserRole.ADMIN))).toBe(true);
  });

  it('rejects customer when admin role is required', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => [UserRole.ADMIN]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(makeContext(UserRole.CUSTOMER))).toThrow(
      ForbiddenException,
    );
  });
});
