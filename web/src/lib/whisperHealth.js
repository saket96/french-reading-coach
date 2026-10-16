/**
 * Ping Whisper OpenAPI docs as a cheap readiness check.
 * @param {'base' | 'small'} model
 */
export async function checkWhisperReady(model = 'base') {
  const path = model === 'small' ? '/whisper-small-health' : '/whisper-health'
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch(path, { method: 'GET', signal: controller.signal })
    return {
      ready: response.ok,
      status: response.status,
      model,
    }
  } catch {
    return { ready: false, status: 0, model }
  } finally {
    window.clearTimeout(timer)
  }
}
