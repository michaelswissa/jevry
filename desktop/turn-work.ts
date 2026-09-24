/** Serial native/provider work whose cleanup must finish before its turn releases ownership. */
export class OwnedTurnWork {
  private tail:Promise<void>=Promise.resolve();
  private closed=false;

  constructor(private readonly signal:AbortSignal) {}

  private assertOpen() {
    this.signal.throwIfAborted();
    if(this.closed)throw new Error('This turn is closed and cannot start more work.');
  }

  run<T>(work:()=>Promise<T>):Promise<T> {
    try{this.assertOpen();}catch(error){return Promise.reject(error);}
    const result=this.tail.then(()=>{
      this.assertOpen();
      // Do not race an already-started operation against abort. Its promise owns
      // input release, provider termination and any other necessary cleanup.
      return work();
    });
    this.tail=result.then(()=>undefined,()=>undefined);
    return result;
  }

  async closeAndDrain():Promise<void> {
    this.closed=true;
    await this.tail;
  }
}
