import {toiletViewDescription,type ToiletStyle} from './toiletViews.js';
export type PhotoFeedbackContext = { fixtureType?: string; viewKey?: string; toiletStyle?:ToiletStyle; missingSurfaces?:string[] };

const objects: Record<string, string> = {
  TOILET: 'toilet', INDIAN_TOILET: 'Indian toilet', WESTERN_TOILET: 'Western toilet', SINK: 'sink', MIRROR: 'mirror', BIN: 'bin', FLOOR: 'floor area',
};
const views: Record<string, string> = {
  bowl_seat: 'the whole toilet bowl and seat',
  exterior_base: 'the outside and base of the toilet',
  squat_pan: 'the whole Indian toilet pan',
  basin_tap: 'the whole sink basin, drain and tap',
  reflective_surface: 'the whole mirror',
  opening_interior: 'the bin opening and inside',
  exterior: 'the outside of the bin and the floor around it',
  wide_zone: 'the whole floor area',
};
const surfaces: Record<string, string> = {
  bowl: 'bowl', seat: 'seat', pan: 'toilet pan', footrests: 'footrests',
  exterior: 'outside', base: 'base', basin: 'basin', drain: 'drain', tap: 'tap',
  reflective_surface: 'mirror', whole_floor_zone: 'floor area', opening: 'bin opening',
  interior: 'inside', surrounding_floor: 'floor around it', pan_edges:'pan edges',
};
const list = (parts: string[]) => parts.length < 3
  ? parts.join(' and ')
  : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
const catalog = (values: Record<string, string>, key: string) => Object.hasOwn(values, key) ? values[key] : undefined;

/** Use only catalog vocabulary, never model prose, customer names or confidence. */
export function staffPhotoInstructions(input: {
  state: string; reasonCode: string | null; context?: PhotoFeedbackContext;
  dirtySurfaces?: string[];
}): string | null {
  const object = catalog(objects, input.context?.fixtureType?.toUpperCase() ?? '');
  const subject = object ? `the ${object}` : 'the required item';
  const style=input.context?.fixtureType==='WESTERN_TOILET'?'WESTERN':input.context?.toiletStyle;
  const view = (object==='toilet'||object==='Western toilet'?toiletViewDescription(input.context?.viewKey,style):null) ?? catalog(views, input.context?.viewKey ?? '') ?? (object ? `the whole ${object}` : 'the whole required item');
  const show = `Please show ${view} clearly and take another photo.`;

  // A review or privacy hold must not instruct staff to bypass the decision.
  if (input.state === 'PRIVACY_HOLD') return 'This photo needs a privacy check. Wait for your manager before taking another photo.';
  if (input.state === 'SERVICE_FAILURE' || input.state === 'RETRY_WAIT') return 'We could not finish checking this photo. Tap Refresh results. If it still does not work, ask your manager.';
  if (input.state === 'REVIEW_REQUIRED') {
    if(input.reasonCode==='OBJECT_UNCERTAIN')return `We could not confirm the item in this photo. Your manager will check it. Continue with the other required photos.`;
    if(input.reasonCode==='VIEW_UNCERTAIN')return 'We could not confirm that all required parts are visible. Your manager will check this photo. Continue with the other required photos.';
    if(input.reasonCode==='CANNOT_ASSESS')return 'We could not decide if this item is clean. Your manager will check this photo. Continue with the other required photos.';
    return 'Your manager needs to check this photo. Continue with the other required photos.';
  }
  if (input.state === 'CLEANING_REQUIRED') {
    const dirty = [...new Set((input.dirtySurfaces ?? []).map(key => catalog(surfaces,key)).filter((value): value is string => !!value))];
    return `The ${object ?? 'required item'} is not clean. Please clean ${dirty.length ? `the ${list(dirty)}` : 'it'}, then scan the task QR and take another photo.`;
  }
  if (input.state !== 'RECAPTURE_REQUIRED') return null;
  switch (input.reasonCode) {
    case 'WRONG_ITEM': return `This photo does not show ${subject}. ${show}`;
    case 'MISSING_SURFACE': {
      const missing=[...new Set((input.context?.missingSurfaces??[]).map(key=>catalog(surfaces,key)).filter((value):value is string=>!!value))];
      return missing.length?`The photo does not show the ${list(missing)}. ${show}`:`The photo does not show all the required parts. Move back a little. ${show}`;
    }
    case 'CANNOT_ASSESS':
    case 'IDENTITY_UNCERTAIN':
    case 'CONTEXT_UNCERTAIN': return `We could not clearly see ${subject}. ${show}`;
    case 'PHOTO_BLURRY': return 'This photo is blurry. Hold your phone still and take another photo.';
    case 'PHOTO_TOO_DARK': return `This photo is too dark. Turn on the light or torch. ${show}`;
    case 'PHOTO_TOO_SMALL': return `This photo is too small to check. ${show}`;
    case 'PHOTO_OF_SCREEN': return `Please photograph ${subject} at the location, not a picture on a screen.`;
    case 'DUPLICATE_EVIDENCE': return `This photo was already used. Please take a new photo of ${subject}.`;
    default: return input.reasonCode ? null : show;
  }
}
