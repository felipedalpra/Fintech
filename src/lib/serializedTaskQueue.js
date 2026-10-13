export function createSerializedTaskQueue() {
  let tail = Promise.resolve()

  return function enqueue(task) {
    const result = tail.catch(() => {}).then(task)
    tail = result.catch(() => {})
    return result
  }
}
