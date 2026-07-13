// lib/draft-logic.ts
// Pure functions for snake-draft math — no I/O, safe to import both
// server-side (for validating a pick) and client-side (for displaying
// "whose turn is it" without waiting on a round-trip).

export interface PickInfo {
  round: number;
  teamId: string;
  isLastPickOfDraft: boolean;
}

/**
 * Given the team order and how many picks have been made so far, returns
 * whose turn it is. Snake draft: even rounds go in team_order order, odd
 * rounds reverse.
 */
export function getCurrentPick(
  teamOrder: string[],
  currentPickIndex: number,
  totalRounds: number | null
): PickInfo | null {
  if (teamOrder.length === 0) return null;

  if (totalRounds !== null && currentPickIndex >= teamOrder.length * totalRounds) {
    return null;
  }

  const round = Math.floor(currentPickIndex / teamOrder.length);
  const indexInRound = currentPickIndex % teamOrder.length;
  const isReversedRound = round % 2 === 1;
  const teamIndex = isReversedRound ? teamOrder.length - 1 - indexInRound : indexInRound;

  const isLastPickOfDraft =
    totalRounds !== null && currentPickIndex === teamOrder.length * totalRounds - 1;

  return {
    round,
    teamId: teamOrder[teamIndex],
    isLastPickOfDraft,
  };
}