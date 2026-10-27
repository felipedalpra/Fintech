export const CLINICAL_WORKSPACE_PAGE_SIZE = 1000

export async function collectClinicalWorkspacePages(loadPage, pageSize = CLINICAL_WORKSPACE_PAGE_SIZE) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const result = await loadPage(from, from + pageSize - 1)
    if (result.error) return { data:[], error:result.error }
    const page = result.data || []
    rows.push(...page)
    if (page.length < pageSize) return { data:rows, error:null }
  }
}
