-- Expansão da anamnese médica (padrão CFM)
alter table public.patients
  add column if not exists hda text,
  add column if not exists previous_surgeries text,
  add column if not exists hospitalizations text,
  add column if not exists chronic_diseases text,
  add column if not exists allergies text,
  add column if not exists current_medications text,
  add column if not exists smoking text,
  add column if not exists alcohol text,
  add column if not exists physical_activity text,
  add column if not exists family_history text,
  add column if not exists gynecological_history text;
