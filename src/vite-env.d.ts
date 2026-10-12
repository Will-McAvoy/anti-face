/// <reference types="vite/client" />

declare module '*.cjs' {
  const content: any;
  export default content;
  export const copyThemeParts: any;
  export const ALLOWED_COPY_GROUPS: any;
  export const normalizeTag: any;
  export const normalizeTags: any;
  export const deriveColorScheme: any;
  export const matchesThemeFilters: any;
  export const getTagCounts: any;
  export const frameBox: any;
  export const sliderClip: any;
  export const AppearanceHistory: any;
}
