export function sliderClip(percent: number): string;
export function frameBox(zoom: string, width: number, height: number): {
  width: string;
  height: string;
  aspectRatio?: string;
  mode: 'pixel' | 'fit';
};
