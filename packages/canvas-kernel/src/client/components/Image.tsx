import React, { useContext, useState } from "react";
import { SessionContext } from "#canvas/runtime";

interface ImageProps {
  src: string;
  alt?: string;
  caption?: string;
  width?: number | string;
  height?: number | string;
}

export function ImageView({ src, alt, caption, width, height }: ImageProps) {
  const sessionId = useContext(SessionContext);
  const [error, setError] = useState(false);

  const imgSrc = `/api/image?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(src)}`;

  if (error) {
    return (
      <div className="mt-3 text-accent-red text-body bg-accent-red-muted rounded-md p-4">
        {src}: Failed to load image
      </div>
    );
  }

  return (
    <figure className="mt-3 relative" data-md="image" data-md-src={src}>
      <div className="rounded-md overflow-hidden border border-border-subtle bg-bg-code inline-block">
        <img
          src={imgSrc}
          alt={alt || src}
          onError={() => setError(true)}
          className="block max-w-full h-auto"
          {...(width ? { width } : {})}
          {...(height ? { height } : {})}
        />
      </div>
      {caption && (
        <figcaption className="mt-1.5 text-meta text-text-tertiary font-body">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
