'use client';

const SCRIPT_TAG_WARNING = 'Encountered a script tag while rendering React component';
const PATCH_FLAG = '__zsphereDocSiteConsoleFilterPatched';

declare global {
  interface Window {
    [PATCH_FLAG]?: boolean;
  }
}

if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && !window[PATCH_FLAG]) {
  const originalError = console.error;

  console.error = (...args: Parameters<typeof console.error>) => {
    if (typeof args[0] === 'string' && args[0].includes(SCRIPT_TAG_WARNING)) {
      return;
    }

    originalError(...args);
  };

  window[PATCH_FLAG] = true;
}

export function DevConsoleFilter() {
  return null;
}
