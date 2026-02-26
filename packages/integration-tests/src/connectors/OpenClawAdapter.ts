/**
 * Compatibility shim for historical integration-test import path.
 * Runtime behavior is canonicalized to @eidolon/toolkit OpenClawAdapter.
 */
export {
  OpenClawAdapter,
  type ActionInput as OpenClawExecuteInput,
  type ActionOutput as OpenClawExecuteResult,
  type SkillDefinition as OpenClawSkill
} from '@eidolon/toolkit';
