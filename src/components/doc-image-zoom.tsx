'use client';

import { ImageZoom as FumaImageZoom } from 'fumadocs-ui/components/image-zoom';
import type { ComponentProps } from 'react';

type ImageZoomProps = ComponentProps<typeof FumaImageZoom>;

export function DocImageZoom({
  width = 1200,
  height = 800,
  style,
  ...props
}: ImageZoomProps) {
  return (
    <FumaImageZoom
      width={width}
      height={height}
      style={{ width: '100%', height: 'auto', ...style }}
      {...props}
    />
  );
}
