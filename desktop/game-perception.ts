import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';

export interface GridLayout { target: string; rows: number; columns: number; bounds: { x: number; y: number; width: number; height: number }; cells: string[][] }
export interface SurfaceRect { node: number; rect: { x: number; y: number; width: number; height: number } | null }
export interface MotionRules {
  playerLabels: string[];
  blockedLabels?: string[];
  actors?: Array<{ labels: string[]; dr: number; dc: number; wrap: boolean }>;
  moves: Record<string, { dr: number; dc: number }>;
}
const keyOperations = ['KEY_LEFT','KEY_UP','KEY_RIGHT','KEY_DOWN','KEY_W','KEY_A','KEY_S','KEY_D','KEY_SPACE','KEY_ENTER'];
export function validMotion(value: MotionRules) {
  const labels = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= 16 && v.every(s => typeof s === 'string' && s.length > 0 && s.length <= 40);
  const vector = (v: { dr: number; dc: number }) => v && [v.dr,v.dc].every(n=>Number.isInteger(n)&&Math.abs(n)<=4);
  return !!value && labels(value.playerLabels) && (value.blockedLabels === undefined || Array.isArray(value.blockedLabels) && (!value.blockedLabels.length || labels(value.blockedLabels))) &&
    (value.actors === undefined || Array.isArray(value.actors) && value.actors.length <= 8 && value.actors.every(a=>a && labels(a.labels) && vector(a) && typeof a.wrap==='boolean')) &&
    !!value.moves && !Array.isArray(value.moves) && Object.keys(value.moves).length>0 && Object.entries(value.moves).every(([key,v])=>keyOperations.includes(key)&&vector(v));
}

/** Geometry only: facts for Jev's candidate comparison, never a hard-coded action policy. */
export function gridFacts(cells: string[][], motion?: MotionRules) {
  const rows=cells.length,columns=cells[0].length;
  const locations=cells.flatMap((row,r)=>row.map((label,c)=>({row:r+1,column:c+1,label})));
  const byLabel:Record<string,Array<{row:number;column:number}>>={};
  for(const {row,column,label} of locations)(byLabel[label]||=[]).push({row,column});
  const lines:Record<string,unknown>={};
  const line=(points:typeof locations)=>({cells:points,counts:points.reduce<Record<string,number>>((v,p)=>(v[p.label]=(v[p.label]||0)+1,v),{})});
  for(let r=1;r<=rows;r++)lines['row_'+r]=line(locations.filter(p=>p.row===r));
  for(let c=1;c<=columns;c++)lines['column_'+c]=line(locations.filter(p=>p.column===c));
  if(rows===columns){lines.diagonal_down=line(locations.filter(p=>p.row===p.column));lines.diagonal_up=line(locations.filter(p=>p.row+p.column===rows+1));}
  const moves:Record<string,unknown>={};
  const players=motion?locations.filter(p=>motion.playerLabels.includes(p.label)):[];
  if(motion&&players.length===1&&!cells.flat().includes('?')) {
    const player=players[0],hazards=motion.actors?.flatMap(actor=>locations.filter(p=>actor.labels.includes(p.label)).map(p=>({
      row:actor.wrap?((p.row-1+actor.dr)%rows+rows)%rows+1:p.row+actor.dr,
      column:actor.wrap?((p.column-1+actor.dc)%columns+columns)%columns+1:p.column+actor.dc,label:p.label
    })))||[];
    for(const [key,delta] of Object.entries(motion.moves)) {
      const row=player.row+delta.dr,column=player.column+delta.dc,inside=row>=1&&row<=rows&&column>=1&&column<=columns;
      moves[key]={from:player,destination:{row,column,currentLabel:inside?cells[row-1][column-1]:'outside'},
        insideBoard:inside,blocked:inside&&!!motion.blockedLabels?.includes(cells[row-1][column-1]),
        collisionAfterInput:hazards.some(p=>p.row===row&&p.column===column),predictedHazards:hazards,
        assumption:'Predictions use the learned rules; compare with the next screenshot.'};
    }
  }
  return {coordinateSystem:'Rows and columns start at 1, top-left. Rows increase down; columns increase right.',byLabel,lines,moves};
}
export type Pixels = { width: number; height: number; data: Buffer; region?:{x:number;y:number;width:number;height:number} };
const imageCoordinates=(pixels:Pixels,viewport:{w:number;h:number})=>({
  sx:pixels.width/(pixels.region?.width||viewport.w),sy:pixels.height/(pixels.region?.height||viewport.h),x:pixels.region?.x||0,y:pixels.region?.y||0,
});
export function surfaceFingerprint(pixels:Pixels,viewport:{w:number;h:number},rect:NonNullable<SurfaceRect['rect']>) {
  const geometry=imageCoordinates(pixels,viewport);
  const sample=Buffer.alloc(48*48*3);let out=0;
  for(let y=0;y<48;y++)for(let x=0;x<48;x++) {
    const px=Math.max(0,Math.min(pixels.width-1,Math.floor((rect.x-geometry.x+(x+.5)/48*rect.width)*geometry.sx)));
    const py=Math.max(0,Math.min(pixels.height-1,Math.floor((rect.y-geometry.y+(y+.5)/48*rect.height)*geometry.sy)));
    const i=(py*pixels.width+px)*4;
    for(let c=0;c<3;c++)sample[out++]=pixels.data[i+c]>>3;
  }
  return createHash('sha256').update(sample).digest('hex');
}
export function decodeGameImage(data: string): Pixels {
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length < 33 || bytes.length > 5 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
      bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16_000_000) throw new Error('The game screenshot is outside the supported image bounds.');
  return PNG.sync.read(bytes);
}
export function validGrid(grid: GridLayout) {
  return !!grid && typeof grid.target === 'string' && Number.isInteger(grid.rows) && grid.rows >= 2 && grid.rows <= 16 &&
    Number.isInteger(grid.columns) && grid.columns >= 2 && grid.columns <= 16 && !!grid.bounds &&
    [grid.bounds.x,grid.bounds.y,grid.bounds.width,grid.bounds.height].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) &&
    grid.bounds.width > .1 && grid.bounds.height > .1 && grid.bounds.x + grid.bounds.width <= 1.001 && grid.bounds.y + grid.bounds.height <= 1.001 &&
    Array.isArray(grid.cells) && grid.cells.length === grid.rows && grid.cells.every(row => Array.isArray(row) && row.length === grid.columns && row.every(label => typeof label === 'string' && label.length > 0 && label.length <= 40));
}

/** Learn cell appearances once; compare current pixels locally without reading game internals. */
export class GridReader {
  private templates = new Map<string, number[][]>();
  private masks = new WeakMap<number[], boolean[]>();
  constructor(readonly layout: GridLayout, readonly node: number, public rect: NonNullable<SurfaceRect['rect']>, pixels: Pixels, viewport: { w: number; h: number }) {
    const patches = this.patches(pixels, viewport);
    for (let row = 0; row < layout.rows; row++) for (let col = 0; col < layout.columns; col++) {
      const label = layout.cells[row][col], samples = this.templates.get(label) || [];
      const patch=patches[row][col];
      if(!samples.some(sample=>sample.every((n,i)=>n===patch[i])))samples.push(patch);
      this.templates.set(label, samples);
    }
    for (const row of patches) for (const patch of row) if (this.classify(patch) === '?') throw new Error('The visual grid calibration is ambiguous.');
  }
  private patches(pixels: Pixels, viewport: { w: number; h: number }) {
    const { bounds, rows, columns } = this.layout, geometry=imageCoordinates(pixels,viewport),{sx,sy}=geometry;
    const x = (this.rect.x + this.rect.width * bounds.x-geometry.x) * sx, y = (this.rect.y + this.rect.height * bounds.y-geometry.y) * sy;
    const cw = this.rect.width * bounds.width * sx / columns, ch = this.rect.height * bounds.height * sy / rows;
    if (x < 0 || y < 0 || x + cw * columns > pixels.width + 1 || y + ch * rows > pixels.height + 1) throw new Error('The game grid left the screenshot.');
    return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, col) => {
      const values: number[] = [];
      for (let py = 0; py < 20; py++) for (let px = 0; px < 20; px++) {
        const ix = Math.min(pixels.width-1, Math.floor(x + (col + .18 + px / 19 * .64) * cw));
        const iy = Math.min(pixels.height-1, Math.floor(y + (row + .18 + py / 19 * .64) * ch));
        const i = (iy * pixels.width + ix) * 4;
        values.push(pixels.data[i], pixels.data[i+1], pixels.data[i+2]);
      }
      return values;
    }));
  }
  private classify(patch: number[]) {
    const mask=(values:number[])=>{
      const cached=this.masks.get(values);if(cached)return cached;
      const background=[0,1,2].map(c=>[0,19,380,399].map(i=>values[i*3+c]).sort((a,b)=>a-b)[1]);
      const result=Array.from({length:400},(_,i)=>background.reduce((sum,n,c)=>sum+Math.abs(n-values[i*3+c]),0)>90);
      this.masks.set(values,result);return result;
    };
    const glyph=mask(patch);
    const ranked = [...this.templates].map(([label, samples]) => ({ label, error: Math.min(...samples.map(sample => {
      const color=sample.reduce((sum, n, i) => sum + Math.abs(n - patch[i]), 0) / (255 * sample.length);
      if(!/^\d+$/.test(label))return color;
      const known=mask(sample);let union=0,different=0;
      for(let i=0;i<400;i++){if(glyph[i]||known[i])union++;if(glyph[i]!==known[i])different++;}
      // Similar tile colors cannot substitute for reading a different numeral.
      return union&&different/union<=.3?color:1;
    })) })).sort((a,b) => a.error-b.error);
    return ranked[0] && ranked[0].error <= .055 && (!ranked[1] || ranked[1].error-ranked[0].error >= .012) ? ranked[0].label : '?';
  }
  read(pixels: Pixels, viewport: { w: number; h: number }, surface: SurfaceRect) {
    if (surface.node !== this.node || !surface.rect || surface.rect.width<=0 || surface.rect.height<=0 || Math.abs(surface.rect.width/surface.rect.height-this.rect.width/this.rect.height)>.025) return;
    // Responsive translation/scaling preserves grid fractions and normalized patches.
    // A changed aspect ratio or unreadable pixels still requires fresh calibration.
    this.rect={...surface.rect};
    let cells:string[][];
    try { cells=this.patches(pixels, viewport).map(row => row.map(patch => this.classify(patch))); }
    catch { return; }
    return { rows: this.layout.rows, columns: this.layout.columns, cells, unknown: cells.flat().filter(v => v === '?').length, source: 'current screenshot, local pixel matching' };
  }
  async learnNumbers(pixels:Pixels,viewport:{w:number;h:number},surface:SurfaceRect,recognize:(image:Buffer)=>Promise<{text:string;confidence:number}>,valid:(label:string)=>boolean) {
    const board=this.read(pixels,viewport,surface);
    if(!board?.unknown)return board;
    const patches=this.patches(pixels,viewport),{bounds,rows,columns}=this.layout;
    const geometry=imageCoordinates(pixels,viewport),{sx,sy}=geometry;
    const cw=this.rect.width*bounds.width*sx/columns,ch=this.rect.height*bounds.height*sy/rows;
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++) {
      if(this.classify(patches[row][col])!=='?')continue;
      const x=Math.floor((this.rect.x+this.rect.width*bounds.x-geometry.x)*sx+(col+.12)*cw);
      const y=Math.floor((this.rect.y+this.rect.height*bounds.y-geometry.y)*sy+(row+.2)*ch);
      const width=Math.max(1,Math.floor(cw*.76)),height=Math.max(1,Math.floor(ch*.6));
      const crop=new PNG({width,height});
      PNG.bitblt(pixels as PNG,crop,x,y,width,height,0,0);
      const result=await recognize(PNG.sync.write(crop));
      if(result.confidence<80||!valid(result.text))continue;
      // Learn only the observed label; unknown or low-confidence reads stay unknown.
      const samples=this.templates.get(result.text)||[];
      if(samples.length>=8)samples.shift();samples.push(patches[row][col]);
      this.templates.set(result.text,samples);
    }
    return this.read(pixels,viewport,surface);
  }
  point(row: number, col: number) {
    const b = this.layout.bounds;
    return { x: b.x + (col + .5) * b.width / this.layout.columns, y: b.y + (row + .5) * b.height / this.layout.rows };
  }
}
