export const createImagePart = (
  uri: string,
  fileName: string,
  mimeType: string | null | undefined
) =>
  ({
    uri,
    name: fileName,
    type: mimeType ?? "image/jpeg",
  }) as unknown as Blob;
