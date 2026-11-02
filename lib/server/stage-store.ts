import 'server-only';
import { createStage, type StageState } from '../stage';
const state = globalThis as typeof globalThis & { bugQuestStage?: StageState };
export function stageStore() { return state.bugQuestStage ??= createStage(); }
