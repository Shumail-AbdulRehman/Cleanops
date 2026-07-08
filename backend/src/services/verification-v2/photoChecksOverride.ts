/** Owner decision (2026-11-13): allow photo checking before privacy screening
 * and measured accuracy exist. Off unless PHOTO_CHECKS_OWNER_OVERRIDE is exactly
 * "true". When on, photos are processed and AI "clean" verdicts pass without a
 * manager, with no privacy screening. Unset the variable to close the gate again.
 */
export function photoChecksOwnerOverride() {
  return process.env.PHOTO_CHECKS_OWNER_OVERRIDE === 'true';
}
