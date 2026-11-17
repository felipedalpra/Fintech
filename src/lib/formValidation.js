export function validationMessage(result) {
  if (result === true || result === false || result == null || result === '') return ''
  return String(result)
}
