"use client";

import Image from "next/image";
import { shouldBypassImageOptimization } from "@/lib/private-image";
import { useState, useEffect } from "react";

export interface BabyAvatarProps {
  src?: string | null;
  alt?: string;
  size?: number;
  className?: string;
  priority?: boolean;
}

/**
 * Optimized BabyAvatar using next/image with fallback for data/blob URLs and missing/errored images.
 */
export function BabyAvatar({
  src,
  alt = "宝宝头像",
  size = 48,
  className = "w-full h-full object-cover",
  priority = false,
}: BabyAvatarProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!src || hasError) {
    return (
      <span className="flex items-center justify-center w-full h-full text-lg select-none" role="img" aria-label={alt}>
        👶
      </span>
    );
  }

  const isExternalOrBlob =
    shouldBypassImageOptimization(src) ||
    src.startsWith("http://") ||
    src.startsWith("https://");

  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      unoptimized={isExternalOrBlob}
      priority={priority}
      onError={() => setHasError(true)}
      className={className}
    />
  );
}
