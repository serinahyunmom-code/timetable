import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function createAppServer() {
  const assets = new Map();
  for (const [name,type] of [['index.html','text/html'],['app.js','text/javascript'],['security.mjs','text/javascript'],['style.css','text/css']]) {
    assets.set('/'+name, {body:await readFile(new URL(name, import.meta.url)),type});
  }
  return createServer((req,res)=>{
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Cache-Control','no-store');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return}
    let pathname;try{pathname=new URL(req.url,'http://localhost').pathname}catch{res.writeHead(400);res.end();return}
    if(pathname==='/healthz'){res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(req.method==='HEAD'?undefined:'ok');return}
    const asset=assets.get(pathname==='/'?'/index.html':pathname);
    if(!asset){res.writeHead(404);res.end();return}
    res.writeHead(200,{'Content-Type':asset.type+'; charset=utf-8','Content-Length':asset.body.length});
    res.end(req.method==='HEAD'?undefined:asset.body);
  });
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||8080);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
  const server=await createAppServer();server.requestTimeout=15000;server.headersTimeout=10000;
  server.listen(port,'0.0.0.0',()=>console.log('Timetable service ready'));
}
