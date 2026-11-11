'use client';

import { useEffect } from 'react';

type DocRedirectProps = {
  href: string;
};

export function DocRedirect({ href }: DocRedirectProps) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  return (
    <p>
      Redirecting… <a href={href}>Continue</a>
    </p>
  );
}
