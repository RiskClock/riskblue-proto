-- Add missing AWP class control mappings for Electrical Rooms, Mechanical Rooms, etc.
INSERT INTO awp_class_control_mappings (awp_class_name, control_id)
VALUES 
  ('Electrical Rooms', 'a5acff5a-d8a0-402b-9085-cb3aea2f6999'),
  ('Mechanical Rooms', 'a5acff5a-d8a0-402b-9085-cb3aea2f6999'),
  ('Electrical Risers', 'a5acff5a-d8a0-402b-9085-cb3aea2f6999'),
  ('Mechanical Risers', 'a5acff5a-d8a0-402b-9085-cb3aea2f6999'),
  ('Temporary Water Run', 'a5acff5a-d8a0-402b-9085-cb3aea2f6999')
ON CONFLICT (awp_class_name, control_id) DO NOTHING;