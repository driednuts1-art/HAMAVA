// docs/design-system.md §1.2 — the signature gradient's original, always-
// allowed surface. Kept as its own small component since it appears on
// every unauthenticated screen (Feature 14) and will again in later features.
export function BrandMark({ size = 42 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl"
      style={{
        width: size,
        height: size,
        background: "var(--signature-gradient)",
      }}
    >
      <div
        className="flex items-center justify-center rounded-lg"
        style={{
          width: size - 6,
          height: size - 6,
          background: "var(--bg-deep)",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={size * 0.48}
          height={size * 0.48}
          fill="none"
          stroke="#fff"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <path d="M12 20.2c-3.6-2.6-8.6-6.4-8.6-11A5.2 5.2 0 0 1 12 6.4a5.2 5.2 0 0 1 8.6 2.8c0 4.6-5 8.4-8.6 11z" />
        </svg>
      </div>
    </div>
  );
}
