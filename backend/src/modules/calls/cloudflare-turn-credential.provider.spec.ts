import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { CloudflareTurnCredentialProvider } from './cloudflare-turn-credential.provider';

const CONFIG: Record<string, string | number> = {
  CLOUDFLARE_TURN_KEY_ID: 'key-123',
  CLOUDFLARE_TURN_API_TOKEN: 'token-abc',
  CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS: 3600,
};

function buildConfig(): ConfigService {
  return {
    getOrThrow: (key: string) => CONFIG[key],
  } as unknown as ConfigService;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const REAL_ICE_SERVERS = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  {
    urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
    username: 'base64-username',
    credential: 'base64-credential',
  },
];

describe('CloudflareTurnCredentialProvider', () => {
  let provider: CloudflareTurnCredentialProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new CloudflareTurnCredentialProvider(buildConfig());
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('calls the real generate-ice-servers endpoint with the key id in the path, bearer auth, and the configured TTL (FR-174)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { iceServers: REAL_ICE_SERVERS }),
    );

    await provider.generateIceServers();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key-123/credentials/generate-ice-servers',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }),
      }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { ttl: number };
    expect(body.ttl).toBe(3600);
  });

  it('resolves the real iceServers array', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { iceServers: REAL_ICE_SERVERS }),
    );
    await expect(provider.generateIceServers()).resolves.toEqual(
      REAL_ICE_SERVERS,
    );
  });

  it('the API token never appears anywhere in the returned credentials (FR-174, structural)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { iceServers: REAL_ICE_SERVERS }),
    );
    const result = await provider.generateIceServers();
    expect(JSON.stringify(result)).not.toContain('token-abc');
  });

  describe('fail-closed behavior (FR-176)', () => {
    it('throws ServiceUnavailableException on a network error', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      await expect(provider.generateIceServers()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(401, { error: 'bad token' }));
      await expect(provider.generateIceServers()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException when iceServers is missing or empty', async () => {
      fetchMock.mockResolvedValue(jsonResponse(201, {}));
      await expect(provider.generateIceServers()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException on an unparseable response body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.reject(new Error('bad json')),
      });
      await expect(provider.generateIceServers()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
