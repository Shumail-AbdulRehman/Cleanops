import {
  v2 as cloudinary,
  type UploadApiErrorResponse,
  type UploadApiOptions,
  type UploadApiResponse,
} from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadBufferToCloudinary = (
  fileBuffer: Buffer,
  options: UploadApiOptions = {}
) =>
  new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) {
        return reject(error as UploadApiErrorResponse);
      }

      if (!result) {
        return reject(new Error("Cloudinary upload did not return a result"));
      }

      resolve(result);
    });

    stream.end(fileBuffer);
  });

const isTransientUploadError = (error: unknown): boolean => {
  const err = error as { http_code?: number; name?: string };
  return (
    err?.name === "TimeoutError" ||
    err?.http_code === 499 ||
    (typeof err?.http_code === "number" && err.http_code >= 500)
  );
};

const uploadWithRetry = async (
  fileBuffer: Buffer,
  options: UploadApiOptions = {},
  retries = 2
): Promise<UploadApiResponse> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await uploadBufferToCloudinary(fileBuffer, options);
    } catch (error) {
      lastError = error;

      if (!isTransientUploadError(error) || attempt === retries) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw lastError;
};

export const uploadSingleImage = (
  file: Express.Multer.File,
  folder: string
) =>
  uploadWithRetry(file.buffer, {
    folder,
    resource_type: "image",
  });

export const uploadMultipleImages = (
  files: Express.Multer.File[],
  folder: string
) =>
  Promise.all(
    files.map((file) =>
      uploadWithRetry(file.buffer, {
        folder,
        resource_type: "image",
      })
    )
  );

export default cloudinary;
