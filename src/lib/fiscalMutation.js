export async function persistFiscalMutation(mutate, refresh) {
  const persisted = await mutate()
  try {
    await refresh?.()
    return { persisted, refreshError:null }
  } catch (refreshError) {
    return { persisted, refreshError }
  }
}

