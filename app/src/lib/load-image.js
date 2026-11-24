// Loading an image so its pixels can be read back off a <canvas>.
//
// This exists because published catalogues no longer carry their images inline.
// A snapshot used to hold every photo as a `data:` URI, which a canvas can
// always read. Images now live as files in Supabase Storage and the snapshot
// holds their URLs, so the drawing trim, the cutout quality check and the
// background remover are all suddenly working on cross-origin images — and a
// cross-origin image drawn to a canvas taints it, making getImageData() throw.
//
// `crossOrigin = 'anonymous'` fixes that for any host that sends CORS headers,
// which Supabase Storage does on a public bucket. But the same attribute makes
// the load fail outright against a host that sends none, so a bare one-liner
// would trade a readable canvas for a missing image. Hence the retry: ask for
// CORS first, and if that is refused fall back to a plain load, which still
// displays and still decodes — only the pixel read is lost, and every caller
// already handles that.
//
// Inert for `data:` URIs and same-origin paths, so it is safe everywhere.
const needsCors = src => /^https?:\/\//i.test(src ?? '') && !src.startsWith(location.origin)

const load = (src, { cors }) => new Promise((resolve, reject) => {
  const image = new Image()
  if (cors) image.crossOrigin = 'anonymous'
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('The image could not be read'))
  image.src = src // always last: crossOrigin set after src is ignored
})

/**
 * Decoded <img> for `src`, requesting CORS when the pixels could otherwise be
 * unreadable. Rejects only when the image cannot be loaded at all.
 */
export async function loadImageForCanvas(src) {
  if (!needsCors(src)) return load(src, { cors: false })
  try {
    return await load(src, { cors: true })
  } catch {
    return load(src, { cors: false })
  }
}
