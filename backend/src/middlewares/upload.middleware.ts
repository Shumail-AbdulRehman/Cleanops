import multer from "multer";
import { ApiError } from "../utils/ApiError.js";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new ApiError(400, "Only image files are allowed"));
    }

    cb(null, true);
  },
});

export default upload;
