import { useRef } from 'react';
import { ImageGeneration, type ImageGenerationHandle } from 'img-fx';
export default function ImageDemo({paused}:{paused:boolean}) {
  const ref=useRef<ImageGenerationHandle>(null);
  const src=`${import.meta.env.BASE_URL}brand/social-card.png`;
  return <div className="image-demo">{paused?<img src={src} alt="Jevry brand artwork"/>:<ImageGeneration ref={ref} preset="pixels-organic" images={[src]} theme="light" paused={paused}><div style={{width:230,height:120}}/></ImageGeneration>}<button onClick={()=>void ref.current?.triggerReveal({hold:"auto"})} disabled={paused}>Reveal image</button></div>;
}
