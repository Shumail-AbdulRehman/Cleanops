export type ToiletStyle = 'WESTERN' | 'SQUAT' | 'UNCERTAIN';

const squatSurfaces: Record<string, string[]> = {
  bowl_seat: ['pan', 'drain', 'footrests'],
  exterior_base: ['pan_edges', 'surrounding_floor'],
};

/** Default toilet steps accept either physical toilet design, including older snapshots. */
export function toiletSurfaceVariants(fixtureType: string | undefined, view: string | undefined, westernSurfaces: string[]) {
  if (fixtureType?.toUpperCase() !== 'TOILET' || !view || !Object.hasOwn(squatSurfaces, view)) return null;
  return [
    { style: 'WESTERN' as const, surfaces: westernSurfaces },
    { style: 'SQUAT' as const, surfaces: [...squatSurfaces[view]] },
  ];
}

export function toiletPhotoInstruction(view: string): string | null {
  if (view === 'bowl_seat') return 'Western toilet: show the whole bowl and seat. Indian/squat toilet: show the whole pan, drain and both footrests.';
  if (view === 'exterior_base') return 'Western toilet: show the outside and base. Indian/squat toilet: show the pan edges and the floor around it.';
  return null;
}

export function toiletViewDescription(view: string | undefined, style?: ToiletStyle): string | null {
  if (view === 'bowl_seat') return style === 'SQUAT' ? 'the whole toilet pan, drain and both footrests'
    : style === 'WESTERN' ? 'the whole toilet bowl and seat'
    : 'the whole toilet bowl and seat, or the Indian toilet pan, drain and both footrests';
  if (view === 'exterior_base') return style === 'SQUAT' ? 'the toilet pan edges and the floor around it'
    : style === 'WESTERN' ? 'the outside and base of the toilet'
    : 'the outside and base of the Western toilet, or the Indian toilet pan edges and the floor around it';
  return null;
}
