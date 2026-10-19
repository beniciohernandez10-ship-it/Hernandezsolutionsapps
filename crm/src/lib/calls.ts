import { STAGE_KEYS, type CallOutcomeKey, type StageKey } from "./constants";

const idx = (s: string) => STAGE_KEYS.indexOf(s as StageKey);
const LATE = new Set<StageKey>(["CLOSED_WON", "CLOSED_LOST", "NOT_INTERESTED"]);

/**
 * The stage a call outcome moves a lead to, or null to leave it. Calls only move leads forward,
 * never back, and never out of a closed stage (except an explicit "not interested").
 */
export function stageAfterCall(current: string, outcome: CallOutcomeKey): StageKey | null {
  if (LATE.has(current as StageKey)) return null;
  const forward = (target: StageKey) => (idx(target) > idx(current) ? target : null);
  switch (outcome) {
    case "NO_ANSWER":
    case "LEFT_VOICEMAIL":
    case "RECEPTIONIST":
    case "WRONG_NUMBER":
    case "DECISION_MAKER_IDENTIFIED":
      return forward("ATTEMPTED_CONTACT");
    case "SPOKE_WITH_DECISION_MAKER":
      return forward("CONTACTED");
    case "REQUESTED_EMAIL":
    case "CALL_BACK_LATER":
      return forward("FOLLOW_UP_REQUIRED");
    case "INTERESTED":
      return forward("INTERESTED");
    case "MEETING_SCHEDULED":
      return forward("DISCOVERY_SCHEDULED");
    case "NOT_INTERESTED":
      return "NOT_INTERESTED";
  }
}

/** Suggested follow-up for an outcome: task type and days from now (null = none suggested). */
export function suggestedFollowUp(outcome: CallOutcomeKey, retryDays: number): { type: string; days: number } | null {
  switch (outcome) {
    case "NO_ANSWER":
    case "LEFT_VOICEMAIL":
    case "RECEPTIONIST":
    case "DECISION_MAKER_IDENTIFIED":
      return { type: "CALLBACK", days: retryDays };
    case "REQUESTED_EMAIL":
      return { type: "EMAIL", days: 0 };
    case "CALL_BACK_LATER":
      return { type: "CALLBACK", days: 3 };
    case "INTERESTED":
      return { type: "MEETING", days: 2 };
    case "SPOKE_WITH_DECISION_MAKER":
      return { type: "CALLBACK", days: 7 };
    default:
      return null;
  }
}
