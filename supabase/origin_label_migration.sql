-- ORIGEM (rótulo livre) em lançamentos manuais
--
-- Campo de texto livre que o usuário preenche em receitas extras e despesas
-- (ex: "Indicação", "Instagram", "Convênio X"). Aparece na coluna Origem e
-- é filtrável. Lançamentos automáticos (cirurgia, consulta, produto) seguem
-- com a origem definida pela própria natureza.
--
-- Rode no SQL Editor do Supabase (projeto SurgiMetrics).

ALTER TABLE extra_revenues ADD COLUMN IF NOT EXISTS origin_label text;
ALTER TABLE expenses       ADD COLUMN IF NOT EXISTS origin_label text;
