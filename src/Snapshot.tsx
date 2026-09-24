import { useEffect, useRef } from "react";
import {
  ImageGeneration,
  setFrameRate,
  type ImageGenerationHandle,
} from "img-fx";
export default function Snapshot({
  src,
  reduced,
}: {
  src: string;
  reduced: boolean;
}) {
  const ref = useRef<ImageGenerationHandle>(null);
  useEffect(() => {
    setFrameRate(15);
    if (!reduced) void ref.current?.triggerReveal({ hold: "manual" });
  }, [src, reduced]);
  return (
    <div className="snapshot-image">
      <img src={src} alt="Screenshot of the current browser tab" />
      {!reduced && (
        <ImageGeneration
          ref={ref}
          preset="sweep-gradient"
          images={[src]}
          theme="dark"
        >
          <div style={{ width: "100%", height: "100%" }} />
        </ImageGeneration>
      )}
    </div>
  );
}
