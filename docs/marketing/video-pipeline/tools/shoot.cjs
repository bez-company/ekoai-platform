const p=require('puppeteer-core');
// Caminho do HTML do protótipo (v29), por variável de ambiente. Rode a partir da pasta video-pipeline.
const URL='file://'+require('path').resolve(process.env.PROTO_HTML);
// [nome, tela, variante, papel]
const L=[
 ['site-preenchido','ob-site-033','preenchido','admin'],
 ['lendo-marca','ob-lendo-033','lendo','admin'],
 ['marca-lida','ob-confirma-033','completo','admin'],
 ['paleta','palette-033','seis','admin'],
 ['criar-post','create-030','padrao','admin'],
 ['vitrine','create-030','vitrine','admin'],
 ['criar-ideias','create-025','ideias','admin'],
 ['gerando','generating-030','andamento','admin'],
 ['aprovar-3','approve-030','tres','admin'],
 ['aprovar-detalhe','inbox','detalhe-info','admin'],
 ['ajuste-antes-depois','inbox','ajuste-resultado','admin'],
 ['redes-3','create-028','tres-redes','admin'],
 ['aprovar-linkedin','inbox-028','linkedin','admin'],
 ['aprovar-x','inbox-028','x','admin'],
 ['carrossel','carousel','cheio','admin'],
 ['studio-editor','studio-027','multi','admin'],
 ['studio-texto','studio-027','texto','admin'],
 ['agenda-campanha','agenda','campanha','admin'],
 ['agenda-horarios','agenda','horarios-reco','admin'],
 ['campanha','campaigns','detalhe','admin'],
 ['inicio','home','campanha','admin'],
 ['aprendizado','learning','regras','admin'],
 ['publico','learning','publico','admin'],
 ['publicados','published','detalhe','admin'],
 ['analytics','analytics','completo','admin'],
 ['fatos','settings-facts','validade','admin'],
 ['equipe','settings-team','lista','admin'],
 ['grade','grid','cheio-34','admin'],
];
(async()=>{
 const b=await p.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
 for(const vp of ['desktop','mobile']){
  const pg=await b.newPage();
  await pg.setViewport(vp==='desktop'?{width:1440,height:900,deviceScaleFactor:2}:{width:390,height:844,deviceScaleFactor:3});
  for(const [n,s,v,r] of L){
   await pg.goto(URL+`#${s}/${v}/${r}/${vp}/x/light`); await pg.reload(); await pg.addStyleTag({content:'.pbar,.notes{display:none!important}.stage{padding:0!important;margin:0!important}body{background:#f7f1ef}'});
   await new Promise(r=>setTimeout(r,900));
   const h=await pg.$('#frame'); const box=await h.boundingBox();
   try{await (vp==='mobile'?pg:h).screenshot({path:`takes/${n}-${vp==='desktop'?'d':'m'}.png`});console.log('ok',n,vp,Math.round(box.width),Math.round(box.height));}catch(e){console.log('fail',n,vp,e.message)}
  }
  await pg.close();
 }
 await b.close();
})();
