export const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_UPLOAD_SIZE_LABEL = '2MB';

export const ALLOWED_DOC_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
export const ALLOWED_DOC_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export const ALLOWED_IMG_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
export const ALLOWED_IMG_MIME_TYPES = ['image/jpeg', 'image/png'];

export const ACCEPT_DOC_TYPES = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
export const ACCEPT_IMG_TYPES = '.jpg,.jpeg,.png,image/jpeg,image/png';

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates any uploaded document or general file across the application.
 * Constraints: Max 2MB, allowed types: PDF, JPG, PNG only.
 */
export function validateDocumentFile(file: File | null | undefined): FileValidationResult {
  if (!file) {
    return { valid: false, error: 'No file selected.' };
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size (${(file.size / (1024 * 1024)).toFixed(2)}MB) exceeds the maximum limit of 2MB.`,
    };
  }

  const name = file.name || '';
  const lastDot = name.lastIndexOf('.');
  const ext = lastDot !== -1 ? name.slice(lastDot).toLowerCase() : '';

  const extValid = ALLOWED_DOC_EXTENSIONS.includes(ext);
  const mimeValid = file.type ? ALLOWED_DOC_MIME_TYPES.includes(file.type.toLowerCase()) : extValid;

  if (!extValid && !mimeValid) {
    return {
      valid: false,
      error: `File format '${ext || 'unknown'}' is not supported. Allowed formats are PDF, JPG, and PNG only (up to 2MB).`,
    };
  }

  return { valid: true };
}

/**
 * Validates image-only uploads (profile photo, logo, face biometrics).
 * Constraints: Max 2MB, allowed types: JPG, PNG only.
 */
export function validateImageFile(file: File | null | undefined): FileValidationResult {
  if (!file) {
    return { valid: false, error: 'No image selected.' };
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      valid: false,
      error: `Image size (${(file.size / (1024 * 1024)).toFixed(2)}MB) exceeds the maximum limit of 2MB.`,
    };
  }

  const name = file.name || '';
  const lastDot = name.lastIndexOf('.');
  const ext = lastDot !== -1 ? name.slice(lastDot).toLowerCase() : '';

  const extValid = ALLOWED_IMG_EXTENSIONS.includes(ext);
  const mimeValid = file.type ? ALLOWED_IMG_MIME_TYPES.includes(file.type.toLowerCase()) : extValid;

  if (!extValid && !mimeValid) {
    return {
      valid: false,
      error: `Image format '${ext || 'unknown'}' is not supported. Allowed formats are JPG and PNG only (up to 2MB).`,
    };
  }

  return { valid: true };
}
