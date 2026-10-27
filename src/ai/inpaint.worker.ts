import { inpaint, type InpaintInput } from './inpaint'

self.onmessage = (e: MessageEvent<InpaintInput>) => {
  const res = inpaint(e.data)
  ;(self as unknown as Worker).postMessage(res, [res.rgb.buffer, res.srcX.buffer, res.srcY.buffer])
}
