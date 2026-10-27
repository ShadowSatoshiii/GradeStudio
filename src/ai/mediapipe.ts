// Shared loader for the MediaPipe vision runtime (served from /mediapipe and /models).

type Vision = typeof import('@mediapipe/tasks-vision')

let runtime: Promise<{ vision: Vision; files: Awaited<ReturnType<Vision['FilesetResolver']['forVisionTasks']>> }> | null = null

export function visionRuntime() {
  if (!runtime) {
    runtime = (async () => {
      const vision = await import('@mediapipe/tasks-vision')
      const files = await vision.FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe`)
      return { vision, files }
    })()
    runtime.catch(() => (runtime = null))
  }
  return runtime
}

export const modelUrl = (name: string) => `${import.meta.env.BASE_URL}models/${name}`

/** Tries the GPU delegate first and falls back to the CPU. */
export async function withDelegate<T>(make: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await make('GPU')
  } catch {
    return await make('CPU')
  }
}
