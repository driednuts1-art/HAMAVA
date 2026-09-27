/**
 * Every Mock*Provider implementation in this codebase must set `isMock = true`.
 * `ProductionSafetyService` uses this marker to refuse to start the server in
 * production if a mock is still wired in for a real external vendor.
 */
export interface MockProviderMarker {
  readonly isMock: true;
}

export function isMockProvider(value: unknown): value is MockProviderMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<MockProviderMarker>).isMock === true
  );
}
