import 'server-only';
import { createStage, reconcileStageAnimals, type StageState } from '../stage';
const state = globalThis as typeof globalThis & { bugQuestStage?: StageState };
export function stageStore() {
  const stage = state.bugQuestStage ??= createStage();
  reconcileStageAnimals(stage);
  return stage;
}
