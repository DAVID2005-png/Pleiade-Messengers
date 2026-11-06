const maxSourceSize = 50 * 1024 * 1024

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Impossible de compresser cette image sur cet appareil.'))
    }, 'image/webp', quality)
  })
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Impossible de lire l’image compressée.'))
    reader.readAsDataURL(blob)
  })
}

export async function compressImage(file, { maxBytes, maxDimension = 1400 }) {
  if (!file?.type.startsWith('image/')) {
    throw new Error('Choisissez un fichier image valide.')
  }
  if (file.size > maxSourceSize) {
    throw new Error('Cette image dépasse 50 Mo. Choisissez une image plus petite.')
  }

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch (error) {
    console.error('Unable to decode the selected image:', error)
    throw new Error('Ce format d’image ne peut pas être ouvert par ce navigateur.')
  }

  try {
    let scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    for (let resizeAttempt = 0; resizeAttempt < 8; resizeAttempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('La compression d’image n’est pas disponible sur cet appareil.')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

      for (const quality of [0.82, 0.7, 0.58, 0.46]) {
        const blob = await canvasBlob(canvas, quality)
        if (blob.size <= maxBytes) {
          return {
            dataUrl: await blobDataUrl(blob),
            contentType: blob.type || 'image/png',
            size: blob.size,
            name: file.name
          }
        }
      }

      scale *= 0.75
    }
  } finally {
    bitmap.close()
  }

  throw new Error('Cette image reste trop volumineuse après compression. Choisissez une autre photo.')
}
