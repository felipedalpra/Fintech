-- A conclusão do upload clínico passou para o endpoint autenticado,
-- que baixa o objeto e recalcula hash/MIME antes de marcar o ativo como disponível.
revoke all on function public.complete_clinical_asset_upload(uuid) from public, anon, authenticated;
grant execute on function public.complete_clinical_asset_upload(uuid) to service_role;
