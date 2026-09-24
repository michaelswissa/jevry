import {request} from '@playwright/test';
import assert from 'node:assert/strict';

/** Public benchmark-account login only; no task-specific application actions. */
export async function bootstrapGitLab(app,environment) {
 const origin=new URL(environment.urls[0]).origin;
 const client=await request.newContext({baseURL:origin});
 try {
  const form=await client.get('/users/sign_in');
  const html=await form.text();
  const token=html.match(/<input\b[^>]*name="authenticity_token"[^>]*value="([^"]+)"/)?.[1];
  assert.ok(token,'The benchmark GitLab sign-in form is not available.');
  const response=await client.post('/users/sign_in',{form:{authenticity_token:token,'user[login]':environment.credentials.username,'user[password]':environment.credentials.password,'user[remember_me]':'0'}});
  assert.ok(response.ok()&&new URL(response.url()).origin===origin&&!response.url().includes('/users/sign_in'),'Benchmark GitLab login did not complete.');
  const storage=await client.storageState();
  await app.evaluate(async({session},{origin,cookies})=>{
   const jar=session.fromPartition('persist:jevry-browser').cookies;
   for(const cookie of cookies)await jar.set({url:origin,name:cookie.name,value:cookie.value,path:cookie.path,secure:cookie.secure,httpOnly:cookie.httpOnly,sameSite:cookie.sameSite.toLowerCase(),...(cookie.expires>0?{expirationDate:cookie.expires}:{})});
  },{origin,cookies:storage.cookies});
 }finally{await client.dispose();}
}
