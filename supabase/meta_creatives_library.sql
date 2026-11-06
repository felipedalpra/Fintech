-- Biblioteca de criativos: guarda o conteúdo do anúncio (texto, imagem, publicação) junto
-- da estrutura que já era sincronizada.
-- Executar depois de meta_ads_phase1.sql.
--
-- ESTRITAMENTE ADITIVA: nenhuma coluna removida, renomeada ou convertida; nenhuma linha
-- reescrita. Os anúncios já sincronizados continuam válidos — as colunas novas nascem nulas
-- e só são preenchidas na próxima sincronização, e a tela distingue "ainda não veio" de
-- "a Meta não tem", em vez de exibir vazio como se fosse conteúdo.

begin;

alter table public.meta_ads
  add column if not exists image_url       text,
  add column if not exists body_text       text,
  add column if not exists title_text      text,
  add column if not exists object_story_id text;

comment on column public.meta_ads.body_text is 'Texto principal do anúncio, normalizado de object_story_spec/asset_feed_spec. NULL = a Meta nao devolveu.';
comment on column public.meta_ads.object_story_id is 'Id da publicacao, quando existe: permite abrir o post real no Facebook.';

commit;

-- Conferencia apos aplicar (nenhuma linha pode ter perdido dado; as colunas novas comecam
-- vazias e enchem no proximo sync):
-- select count(*) as anuncios,
--        count(thumbnail_url) as com_miniatura,
--        count(body_text) as com_texto
-- from public.meta_ads;
