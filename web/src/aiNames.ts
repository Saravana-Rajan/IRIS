/** The name of the AI model behind each role, as the server reports it (`/api/models` labels: model_client.labels), for
 * the words on screen. App sets them once it has asked; until then, the defaults Iris ships with. */

export type AiRole = "proposal" | "escalation" | "triage" | "image" | "voice";
export type AiNames = Record<AiRole, string>;

export const DEFAULT_AI_NAMES: AiNames = {
  proposal: "Gemini Pro", escalation: "Gemini Pro (deep think)", triage: "Gemini Flash", image: "Gemini Image", voice: "Gemini Flash",
};

let names: AiNames = DEFAULT_AI_NAMES;

export function setAiNames(given: Partial<AiNames> | undefined): AiNames {
  names = { ...DEFAULT_AI_NAMES, ...(given ?? {}) };
  return names;
}

/** The model a role runs on, by name ("Gemini Pro"). */
export function aiName(role: AiRole): string {
  return names[role];
}
