export const TURN_CREDENTIAL_PROVIDER = Symbol('TURN_CREDENTIAL_PROVIDER');

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * FR-174..FR-176: mints a short-lived, single-purpose ICE-server credential
 * set for one WebRTC call leg. The standing vendor secret this is built on
 * top of (`CLOUDFLARE_TURN_KEY_ID`/`CLOUDFLARE_TURN_API_TOKEN`) never
 * reaches the implementation's caller, let alone a client — structurally
 * identical in spirit to `StorageProviderInterface.getUrl()`'s presigned
 * URLs (Feature 7).
 */
export interface TurnCredentialProviderInterface {
  generateIceServers(): Promise<IceServer[]>;
}
