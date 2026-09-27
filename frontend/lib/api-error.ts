// Mirrors backend/src/common/filters/problem-details.filter.ts's real RFC
// 7807 response shape exactly (docs/requirements.md Feature 14 FR-203) —
// read from the actual filter, not guessed.
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  /** Feature 15 FR-231 — an RFC 7807 extension member, present only when the
   *  backend exception set one (e.g. ProfileService's bio-moderation 422). */
  field?: string;
}

export class ApiRequestError extends Error {
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.detail);
    this.name = "ApiRequestError";
    this.problem = problem;
  }
}

export async function parseProblemDetails(
  response: Response,
): Promise<ProblemDetails> {
  try {
    const body = (await response.json()) as Partial<ProblemDetails>;
    return {
      type: body.type ?? "about:blank",
      title: body.title ?? response.statusText,
      status: body.status ?? response.status,
      detail: body.detail ?? "An unexpected error occurred.",
      instance: body.instance ?? "",
      ...(typeof body.field === "string" ? { field: body.field } : {}),
    };
  } catch {
    return {
      type: "about:blank",
      title: response.statusText,
      status: response.status,
      detail: "An unexpected error occurred.",
      instance: "",
    };
  }
}
