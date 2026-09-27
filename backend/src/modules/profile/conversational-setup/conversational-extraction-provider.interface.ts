import {
  ConversationalField,
  ConversationalTurn,
  TurnExtractionResult,
} from './types';

export const CONVERSATIONAL_EXTRACTION_PROVIDER = Symbol(
  'CONVERSATIONAL_EXTRACTION_PROVIDER',
);

/**
 * FR-138/FR-139: a single real structured-output call that both proposes at
 * most one field/value from the latest turn and generates the next
 * question — one call, not two, since both decisions need the same context
 * (recent turns, which fields remain unfilled).
 */
export interface ConversationalExtractionProviderInterface {
  extractTurn(
    recentTurns: ConversationalTurn[],
    remainingFields: ConversationalField[],
    latestUserMessage: string,
  ): Promise<TurnExtractionResult>;
}
