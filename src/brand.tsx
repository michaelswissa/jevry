import { useEffect, useState, type ButtonHTMLAttributes } from 'react';
import { MetalFx, type MaskFn } from 'metal-fx';

export const MARK_PATH = 'M28 21.5H38.5Q40 21.5 40 23V44C40 55 29.5 61 17 61Q15.5 61 15.5 59.5V51.8Q15.5 50.4 17 50.1C24.5 48.8 27 43.5 27 35V23Q27 21.5 28 21.5Z M33 2H46.5Q48 2 48 3.5V17.5Q48 19 46.5 19H43Q41.5 19 41.5 17.5V14L36.5 19H32Q31 19 31 18V15.5Q31 15 31.5 14.5L36.5 9.5H32.5Q31.5 9.5 31.5 8.5V3Q31.5 2 33 2Z';
export function Mark({size = 32}: {size?: number}) {
  return <svg width={size} height={size} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path d={MARK_PATH}/></svg>;
}
const mask: MaskFn = (ctx, w, h) => {
  ctx.save(); ctx.scale(w / 64, h / 64); ctx.fillStyle = '#fff'; ctx.fill(new Path2D(MARK_PATH)); ctx.restore();
};
export function MetalMark({size = 240, paused = false, theme = 'light'}: {size?: number; paused?: boolean; theme?: 'light'|'dark'}) {
  return <div className="metal-mark" aria-hidden="true" style={{width:size,height:size}}><MetalFx preset="silver" theme={theme} mask={mask} disableGlow paused={paused} shaderScale={1.1}><div style={{width:size,height:size}}><Mark size={size}/></div></MetalFx></div>;
}
export function BrandButton({tone = 'primary', className = '', ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {tone?: 'primary'|'secondary'|'quiet'}) {
  return <button {...props} className={`button ${tone} ${className}`} />;
}
export function useReducedMotion() {
  const [reduced,setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {const query=matchMedia('(prefers-reduced-motion: reduce)'); const update=()=>setReduced(query.matches); query.addEventListener('change',update); return ()=>query.removeEventListener('change',update);},[]);
  return reduced;
}

export function DisplayMark({size=330}:{size?:number}) {
  return <div className="display-mark" aria-hidden="true" style={{width:size,height:size}}><img src={`${import.meta.env.BASE_URL}brand/display-logo-chrome.png`} alt="" /></div>;
}
