-- Fix gemini_model to a stable pinned model available in the Gemini API
-- gemini-2.5-flash-002 does not exist; gemini-2.0-flash-001 is the stable GA pinned alias
UPDATE app_config SET val = 'gemini-2.5-flash' WHERE key = 'gemini_model';

-- Also reset any failed synthetic rows back to 'received' so replay can reprocess them
UPDATE submissions SET status = 'received' WHERE is_synthetic = true AND status = 'failed';
