-- Align the seeded DeepSeek prompt model with the model IDs exposed by the
-- production API (verified against GET /models). Idempotent and safe on an
-- existing database where the model may already have been edited by an admin.
UPDATE ai_models
SET code = 'deepseek-flash',
    display_name = 'DeepSeek Flash prompt writer',
    description = 'Cost-efficient prompt enhancement via DeepSeek Flash.',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 'mdl_deepseek_prompt' AND code = 'deepseek-chat';--> statement-breakpoint

UPDATE ai_models
SET display_name = 'DeepSeek Flash prompt writer', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 'mdl_deepseek_prompt' AND code = 'deepseek-flash';
