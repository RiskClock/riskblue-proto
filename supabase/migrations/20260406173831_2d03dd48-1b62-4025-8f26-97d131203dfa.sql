ALTER TABLE awp_class_prompts
  ADD COLUMN detection_method text NOT NULL DEFAULT 'drawing',
  ADD COLUMN condition_rule jsonb DEFAULT NULL;

ALTER TABLE awp_class_prompts
  ADD CONSTRAINT awp_class_prompts_detection_method_check
  CHECK (detection_method IN ('drawing', 'always', 'conditional'));