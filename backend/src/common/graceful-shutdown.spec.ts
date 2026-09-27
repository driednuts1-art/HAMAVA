import { registerGracefulShutdown } from './graceful-shutdown';

// Pure timeout-race/guard logic — platform-independent, exercises the exact
// code main.ts calls (no reconstruction). Real cross-process SIGTERM
// delivery itself is POSIX-specific and covered separately by
// scripts/graceful-shutdown-probe.ts + test/graceful-shutdown-signal.e2e-spec.ts.
describe('registerGracefulShutdown', () => {
  let handlers: Record<string, () => void>;
  let originalOn: typeof process.on;

  beforeEach(() => {
    handlers = {};
    originalOn = process.on.bind(process);
    jest.spyOn(process, 'on').mockImplementation((event: string, cb: any) => {
      handlers[event] = cb;
      return process;
    });
  });

  afterEach(() => {
    process.on = originalOn;
    jest.restoreAllMocks();
  });

  it('calls onShutdown and exits 0 when it resolves before the timeout', async () => {
    const onShutdown = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    registerGracefulShutdown({ timeoutMs: 5000, onShutdown, exit });

    handlers['SIGTERM']();
    // Let the async shutdown() microtasks flush.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('forces exit(0) via the timeout branch when onShutdown hangs (the fail-safe)', async () => {
    jest.useFakeTimers();
    const onShutdown = jest.fn(() => new Promise<void>(() => {})); // never resolves
    const exit = jest.fn();
    registerGracefulShutdown({ timeoutMs: 5000, onShutdown, exit });

    handlers['SIGTERM']();
    await Promise.resolve(); // let shutdown() start and register the timeout
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();

    expect(exit).toHaveBeenCalledWith(0);
    jest.useRealTimers();
  });

  it('only runs once even if both SIGTERM and SIGINT arrive', async () => {
    const onShutdown = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    registerGracefulShutdown({ timeoutMs: 5000, onShutdown, exit });

    handlers['SIGTERM']();
    handlers['SIGINT']();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('registers handlers for both SIGTERM and SIGINT', () => {
    registerGracefulShutdown({
      timeoutMs: 5000,
      onShutdown: () => Promise.resolve(),
    });
    expect(handlers['SIGTERM']).toBeDefined();
    expect(handlers['SIGINT']).toBeDefined();
  });
});
