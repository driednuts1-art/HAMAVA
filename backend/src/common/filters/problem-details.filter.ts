import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { MulterError } from 'multer';
import { Prisma } from '@prisma/client';

// Database/connection-manager error codes that mean "the database is having
// a transient bad moment" (e.g. a Neon cold-start or connection-pool
// pressure — docs/architecture.md §5.1) rather than an application bug.
// Handled here, globally, so every endpoint gets the same 503 treatment
// instead of each call site that happens to touch the DB needing its own
// try/catch (requirements.md FR-52).
const TRANSIENT_PRISMA_CODES = new Set([
  'P1001', // Can't reach database server
  'P1002', // Database server timed out
  'P1008', // Operations timed out
  'P1017', // Server has closed the connection
  'P2024', // Timed out fetching a new connection from the pool
  'P2028', // Transaction API error (transaction manager)
]);

/**
 * Formats every error response as RFC 7807 problem-details, per product.md §8.2:
 * consistent `type`, `title`, `status`, `detail`, `instance` fields across every endpoint.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail = 'An unexpected error occurred.';
    let type = 'about:blank';
    // RFC 7807 §3.2 explicitly allows extension members beyond the core
    // five — `field` lets a client route a validation error to the specific
    // form control it's about (e.g. ProfileService's bio-moderation
    // rejection) without string-matching `detail` (Feature 15, FR-231).
    // Undefined/omitted whenever an exception doesn't set one — never
    // guessed or inferred here.
    let field: string | undefined;

    if (exception instanceof MulterError) {
      // multer throws outside Nest's HttpException hierarchy (FR-26).
      status =
        exception.code === 'LIMIT_FILE_SIZE'
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : HttpStatus.BAD_REQUEST;
      title = 'Upload Error';
      detail = exception.message;
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      TRANSIENT_PRISMA_CODES.has(exception.code)
    ) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      title = 'Service Unavailable';
      detail =
        'The service is temporarily unavailable. Please try again in a few seconds.';
      this.logger.warn(
        `Transient database error (${exception.code}): ${exception.message}`,
      );
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2025'
    ) {
      // Defense-in-depth, found alongside the real JwtAuthGuard fix
      // (Feature 20): `findUniqueOrThrow`/`update`/`delete` all throw this
      // exact code for "no matching row" anywhere in the app, and until now
      // it fell through to the generic 500 branch below — a real, wrong
      // status for what is, by definition, a genuine "not found" case.
      // JwtAuthGuard's own fix means a deleted user's stale token can no
      // longer reach this point at all, but this branch protects every
      // *other* real P2025 site (present or future) the same uniform way,
      // rather than requiring each one to catch and remap it individually.
      status = HttpStatus.NOT_FOUND;
      title = 'Not Found';
      detail = 'The requested resource was not found.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        detail = body;
        title = exception.name;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        title = (b.error as string) ?? exception.name;
        detail = Array.isArray(b.message)
          ? (b.message as string[]).join('; ')
          : ((b.message as string) ?? title);
        if (typeof b.type === 'string') type = b.type;
        if (typeof b.field === 'string') field = b.field;
      }
    } else {
      // Never leak internal error details to the client.
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
    }

    response
      .status(status)
      .type('application/problem+json')
      .json({
        type,
        title,
        status,
        detail,
        instance: request.url,
        ...(field ? { field } : {}),
      });
  }
}
