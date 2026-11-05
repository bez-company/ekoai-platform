const p=require('puppeteer-core');const fs=require('fs');
const names=process.argv.slice(3);const out=process.argv[2];
(async()=>{
 const b=await p.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
 const pg=await b.newPage(); await pg.setViewport({width:1800,height:900});
 const cells=names.map(n=>`<div style="position:relative;width:590px;margin:4px"><div style="font:14px monospace">${n}</div><div style="position:relative"><img src="file://${process.cwd()}/takes/${n}-d.png" style="width:590px;display:block">`+
  [1,2,3,4,5,6,7,8,9].map(k=>`<i style="position:absolute;left:${k*10}%;top:0;bottom:0;border-left:1px dashed rgba(0,0,255,.35);font:10px monospace;color:blue">${k/10}</i><i style="position:absolute;top:${k*10}%;left:0;right:0;border-top:1px dashed rgba(255,0,0,.35);font:10px monospace;color:red">${k/10}</i>`).join('')+`</div></div>`).join('');
 fs.writeFileSync('tools/_sheet.html',`<body style="margin:0;display:flex;flex-wrap:wrap;background:#fff">${cells}</body>`);await pg.goto('file://'+process.cwd()+'/tools/_sheet.html');
 await new Promise(r=>setTimeout(r,800));
 await pg.screenshot({path:out,fullPage:true});
 await b.close();
})();
