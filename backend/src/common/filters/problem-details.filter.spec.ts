import {
  ArgumentsHost,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { ProblemDetailsFilter } from './problem-details.filter';

function makeResponseMock() {
  const res: { status: jest.Mock; type: jest.Mock; json: jest.Mock } = {
    status: jest.fn(),
    type: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.type.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function makeHost(
  response: ReturnType<typeof makeResponseMock>,
  url = '/v1/test',
): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url }),
    }),
  } as unknown as ArgumentsHost;
}

describe('ProblemDetailsFilter', () => {
  let filter: ProblemDetailsFilter;

  beforeEach(() => {
    filter = new ProblemDetailsFilter();
  });

  it('formats a NestJS HttpException as RFC 7807', () => {
    const res = makeResponseMock();
    filter.catch(new NotFoundException('Candidate not found.'), makeHost(res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: HttpStatus.NOT_FOUND,
        detail: 'Candidate not found.',
      }),
    );
  });

  // Feature 15 FR-231: ProfileService throws
  // `new UnprocessableEntityException({field: 'bio', message: reason})` for
  // a moderation-rejected bio — this is the real, exact shape that call
  // site uses (backend/src/modules/profile/profile.service.ts), not a
  // guessed one.
  it('passes through a `field` extension member when the exception body sets one (RFC 7807 §3.2)', () => {
    const res = makeResponseMock();
    filter.catch(
      new UnprocessableEntityException({
        field: 'bio',
        message: 'Contains harassment.',
      }),
      makeHost(res),
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        detail: 'Contains harassment.',
        field: 'bio',
      }),
    );
  });

  it('omits `field` entirely when the exception body does not set one — never a stray `field: undefined`', () => {
    const res = makeResponseMock();
    filter.catch(new NotFoundException('Candidate not found.'), makeHost(res));

    const body = res.json.mock.calls[0][0] as Record<string, unknown>;
    expect('field' in body).toBe(false);
  });

  it('maps a MulterError file-size violation to 413', () => {
    const res = makeResponseMock();
    const error = new MulterError('LIMIT_FILE_SIZE');
    filter.catch(error, makeHost(res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
  });

  // requirements.md FR-52: this is what makes the swipe-transaction 503 (and
  // any other DB call's transient failure) work — handled once here, not
  // duplicated per call site (see docs/architecture.md §5.1).
  it('maps a transient Prisma error (P2028, transaction manager) to a clear 503, not a bare 500', () => {
    const res = makeResponseMock();
    const error = new Prisma.PrismaClientKnownRequestError(
      'Transaction API error: Unable to start a transaction in the given time.',
      { code: 'P2028', clientVersion: '0.0.0' },
    );
    filter.catch(error, makeHost(res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: expect.stringMatching(/try again/i),
      }),
    );
  });

  it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028'])(
    'treats %s as a transient/retry-worthy database error (503)',
    (code) => {
      const res = makeResponseMock();
      const error = new Prisma.PrismaClientKnownRequestError(
        'db is having a moment',
        {
          code,
          clientVersion: '0.0.0',
        },
      );
      filter.catch(error, makeHost(res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    },
  );

  // Feature 20: found alongside the real JwtAuthGuard fix — `findUniqueOrThrow`
  // (and friends) throw this exact code for "no matching row" anywhere in
  // the app, and it used to fall through to the generic 500 branch below,
  // a real, wrong status for what is, by definition, a genuine not-found case.
  it('treats P2025 (Prisma "record not found") as a real 404, not the generic 500', () => {
    const res = makeResponseMock();
    const error = new Prisma.PrismaClientKnownRequestError(
      'An operation failed because it depends on one or more records that were required but not found.',
      { code: 'P2025', clientVersion: '0.0.0' },
    );
    filter.catch(error, makeHost(res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: HttpStatus.NOT_FOUND }),
    );
  });

  it('does not treat an unrelated Prisma error code (e.g. P2002) as transient — falls through to a generic 500', () => {
    const res = makeResponseMock();
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '0.0.0',
      },
    );
    filter.catch(error, makeHost(res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('never leaks a raw, unrecognized error message to the client', () => {
    const res = makeResponseMock();
    filter.catch(new Error('some internal secret detail'), makeHost(res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'An unexpected error occurred.' }),
    );
  });
});
