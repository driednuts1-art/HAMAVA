import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IceServer,
  TurnCredentialProviderInterface,
} from './turn-credential-provider.interface';

const ENDPOINT_TEMPLATE =
  'https://rtc.live.cloudflare.com/v1/turn/keys/{keyId}/credentials/generate-ice-servers';

interface CloudflareGenerateIceServersResponse {
  iceServers?: IceServer[];
}

/**
 * FR-174: real Cloudflare Realtime TURN credential minting. Fails CLOSED,
 * mirroring every other real vendor call in this codebase — a network
 * error, timeout, non-2xx response, or unparseable body throws
 * `ServiceUnavailableException` (503) rather than a silently-empty or
 * guessed credential set (FR-176).
 */
@Injectable()
export class CloudflareTurnCredentialProvider implements TurnCredentialProviderInterface {
  constructor(private readonly config: ConfigService) {}

  async generateIceServers(): Promise<IceServer[]> {
    const keyId = this.config.getOrThrow<string>('CLOUDFLARE_TURN_KEY_ID');
    const apiToken = this.config.getOrThrow<string>(
      'CLOUDFLARE_TURN_API_TOKEN',
    );
    const ttl = this.config.getOrThrow<number>(
      'CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS',
    );
    const endpoint = ENDPOINT_TEMPLATE.replace('{keyId}', keyId);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(
        `Could not reach the TURN credential service: ${message}`,
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `TURN credential service returned ${response.status}.`,
      );
    }

    let body: CloudflareGenerateIceServersResponse;
    try {
      body = (await response.json()) as CloudflareGenerateIceServersResponse;
    } catch {
      throw new ServiceUnavailableException(
        'TURN credential service returned an unparseable response.',
      );
    }

    if (!Array.isArray(body.iceServers) || body.iceServers.length === 0) {
      throw new ServiceUnavailableException(
        'TURN credential service returned no ICE servers.',
      );
    }

    return body.iceServers;
  }
}
