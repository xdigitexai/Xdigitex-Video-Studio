-- Seed catalogue: subscription plans, credit packages, AI providers, models and pricing.
-- Idempotent (INSERT OR IGNORE) so it is safe to re-apply on existing databases.
-- Administrators can edit every value afterwards from the admin console.

INSERT OR IGNORE INTO pricing_settings (id, default_margin_bps, min_charge_micros, credit_value_micros, usd_to_kes_rate_micros, grace_period_days, currency, version, updated_at)
VALUES (1, 4000, 100000, 10000, 130000000, 3, 'USD', 1, CAST(strftime('%s','now') AS INTEGER) * 1000);--> statement-breakpoint

INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('support_email', 'support@xdigitex.com', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('signup_enabled', 'true', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('maintenance_mode', 'false', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('email_verification_required', 'true', CAST(strftime('%s','now') AS INTEGER) * 1000);--> statement-breakpoint

INSERT OR IGNORE INTO plans (id, code, name, description, price_cents, currency, interval_months, credits_per_period, video_limit, image_limit, max_video_duration_seconds, resolutions, queue_priority, max_concurrent_jobs, storage_limit_mb, premium_features, is_active, sort_order, version, created_at, updated_at) VALUES
  ('plan_starter', 'starter', 'Starter', 'Everything you need to launch: 1,000 credits every month, HD video and image generation.', 1000, 'USD', 1, 1000, 30, 150, 10, '["720p"]', 5, 1, 2048, '[]', 1, 1, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('plan_premium', 'premium', 'Premium', 'For creators shipping daily: 2,200 credits, 1080p, priority queue and advanced models.', 2000, 'USD', 1, 2200, 120, 800, 30, '["720p","1080p"]', 8, 3, 10240, '["1080p","priority_queue","advanced_models"]', 1, 2, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);--> statement-breakpoint

INSERT OR IGNORE INTO credit_packages (id, code, name, credits, bonus_credits, price_cents, currency, is_active, sort_order, created_at, updated_at) VALUES
  ('pack_500', 'pack_500', 'Boost 500', 500, 0, 500, 'USD', 1, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('pack_1200', 'pack_1200', 'Creator 1,200', 1200, 100, 1000, 'USD', 1, 2, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('pack_3000', 'pack_3000', 'Studio 3,000', 3000, 500, 2500, 'USD', 1, 3, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);--> statement-breakpoint

INSERT OR IGNORE INTO ai_providers (id, code, name, base_url, is_enabled, status, sort_order, created_at, updated_at) VALUES
  ('prov_runway', 'runway', 'Runway', 'https://api.dev.runwayml.com', 1, 'unconfigured', 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('prov_openai', 'openai', 'OpenAI', 'https://api.openai.com', 1, 'unconfigured', 2, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('prov_google', 'google', 'Google Gemini', 'https://generativelanguage.googleapis.com', 1, 'unconfigured', 3, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('prov_anthropic', 'anthropic', 'Anthropic', 'https://api.anthropic.com', 1, 'unconfigured', 4, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('prov_deepseek', 'deepseek', 'DeepSeek', 'https://api.deepseek.com', 1, 'unconfigured', 5, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('prov_kling', 'kling', 'Kling AI', 'https://api-singapore.klingai.com', 1, 'unconfigured', 6, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('prov_replicate', 'replicate', 'Replicate', 'https://api.replicate.com', 1, 'unconfigured', 7, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('prov_fal', 'fal', 'fal.ai', 'https://queue.fal.run', 1, 'unconfigured', 8, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('prov_stability', 'stability', 'Stability AI', 'https://api.stability.ai', 1, 'unconfigured', 9, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);--> statement-breakpoint

INSERT OR IGNORE INTO ai_models (id, provider_id, code, display_name, description, capabilities, pricing_unit, unit_cost_micros, min_charge_micros, pricing_meta, max_duration_seconds, resolutions, is_active, is_default_video, is_default_image, is_estimated, sort_order, version, created_at, updated_at) VALUES
  ('mdl_runway_gen45', 'prov_runway', 'gen4.5', 'Runway Gen-4.5', 'Cinematic text-to-video and image-to-video with strong motion coherence.', '["text_to_video","image_to_video"]', 'per_second', 120000, 0, '{"resolutionMultipliers":{"720p":1,"1080p":1.5},"providerCreditUsdMicros":10000}', 10, '["720p","1080p"]', 1, 1, 0, 1, 1, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('mdl_runway_aleph2', 'prov_runway', 'aleph2', 'Runway Aleph 2', 'Video-to-video restyling and transformation of an existing clip.', '["video_to_video"]', 'per_second', 280000, 560000, '{"providerCreditUsdMicros":10000}', 30, '["720p"]', 1, 0, 0, 1, 2, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('mdl_openai_gpt_image_1', 'prov_openai', 'gpt-image-1', 'GPT Image 1', 'OpenAI image generation and editing with strong prompt adherence.', '["text_to_image","image_edit"]', 'per_image', 80000, 0, '{"sizeMultipliers":{"1024x1024":1,"1536x1024":1.5,"1024x1536":1.5}}', 1, '["1024x1024","1536x1024","1024x1536"]', 1, 0, 1, 1, 4, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('mdl_openai_whisper', 'prov_openai', 'whisper-1', 'Whisper transcription', 'Timed audio transcription for captions.', '["transcription"]', 'per_minute', 6000, 0, '{}', 1, '[]', 1, 0, 0, 0, 5, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('mdl_openai_prompt', 'prov_openai', 'gpt-4o-mini', 'GPT-4o mini prompt writer', 'Prompt enhancement and creative copy.', '["prompt_enhance"]', 'per_request', 1000, 0, '{}', 1, '[]', 1, 0, 0, 0, 6, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('mdl_google_image', 'prov_google', 'gemini-2.5-flash-image', 'Gemini 2.5 Flash Image', 'Fast, prompt-driven image generation and editing.', '["text_to_image","image_edit"]', 'per_image', 39000, 0, '{}', 1, '["1024x1024"]', 1, 0, 0, 1, 7, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('mdl_google_prompt', 'prov_google', 'gemini-2.5-flash', 'Gemini 2.5 Flash prompt writer', 'Prompt enhancement and structured creative direction.', '["prompt_enhance"]', 'per_request', 300, 0, '{}', 1, '[]', 1, 0, 0, 0, 8, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('mdl_anthropic_prompt', 'prov_anthropic', 'claude-sonnet-4-20250514', 'Claude Sonnet 4 prompt writer', 'Long-form creative direction and prompt refinement.', '["prompt_enhance"]', 'per_request', 3000, 0, '{}', 1, '[]', 1, 0, 0, 0, 9, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('mdl_deepseek_prompt', 'prov_deepseek', 'deepseek-chat', 'DeepSeek Chat prompt writer', 'Cost-efficient prompt enhancement.', '["prompt_enhance"]', 'per_request', 500, 0, '{}', 1, '[]', 1, 0, 0, 0, 10, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('mdl_kling_v2', 'prov_kling', 'kling-v2-master', 'Kling 2.0 Master', 'High-motion text-to-video and image-to-video generation.', '["text_to_video","image_to_video"]', 'per_second', 140000, 0, '{}', 10, '["720p","1080p"]', 1, 0, 0, 1, 11, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('mdl_replicate_flux', 'prov_replicate', 'black-forest-labs/flux-schnell', 'FLUX schnell (Replicate)', 'Fast text-to-image generation through Replicate.', '["text_to_image"]', 'per_image', 3000, 0, '{}', 1, '["1024x1024"]', 1, 0, 0, 1, 12, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('mdl_fal_flux', 'prov_fal', 'fal-ai/flux/schnell', 'FLUX schnell (fal.ai)', 'Fast text-to-image generation through fal.ai queues.', '["text_to_image"]', 'per_image', 3000, 0, '{}', 1, '["1024x1024"]', 1, 0, 0, 1, 13, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('mdl_stability_sd35', 'prov_stability', 'sd3.5-large', 'Stable Diffusion 3.5 Large', 'High-quality text-to-image generation from Stability AI.', '["text_to_image"]', 'per_image', 65000, 0, '{}', 1, '["1024x1024"]', 1, 0, 0, 1, 14, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);--> statement-breakpoint

INSERT OR IGNORE INTO plan_models (plan_id, model_id) SELECT 'plan_premium', id FROM ai_models;--> statement-breakpoint

INSERT OR IGNORE INTO plan_models (plan_id, model_id) VALUES
  ('plan_starter', 'mdl_runway_gen45'),
  ('plan_starter', 'mdl_openai_gpt_image_1'),
  ('plan_starter', 'mdl_openai_whisper'),
  ('plan_starter', 'mdl_google_image'),
  ('plan_starter', 'mdl_replicate_flux'),
  ('plan_starter', 'mdl_stability_sd35');
