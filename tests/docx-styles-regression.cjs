// Exercise the actual browser bundles and inspect the generated Office XML.
// Run with Node and Python with lxml; TEST_PYTHON can select the interpreter.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const dist=fs.existsSync(path.join(root,'dist/converter.js'))?path.join(root,'dist'):root;
const context=vm.createContext({Blob,Buffer,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,setTimeout,clearTimeout,setImmediate,clearImmediate,console});
context.window=context;
for(const file of ['vendor/jszip.min.js','vendor/docx.js','converter.js']){
  const source=file==='converter.js'&&process.env.TEST_CONVERTER?process.env.TEST_CONVERTER:path.join(dist,file);
  vm.runInContext(fs.readFileSync(source,'utf8'),context,{filename:source});
}
(async()=>{
  const model={course:{title:'Style regression'},item:{title:'Heading structure',type:'Page'},options:{},issues:[],
    blocks:Array.from({length:6},(_,i)=>({kind:'heading',level:i+1,inlines:[{text:`Section ${i+1}`}]}))};
  model.blocks.push({kind:'paragraph',inlines:[{text:'Reference',link:'https://example.com/'}]});
  const blob=await context.CanvasWord.toDocx(model);
  const archive=await context.JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
  const input={styles:await archive.file('word/styles.xml').async('string'),document:await archive.file('word/document.xml').async('string')};
  const python=process.env.TEST_PYTHON||process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3';
  const result=spawnSync(python,['-c',[
    'import json,sys',
    'from lxml import etree',
    'data=json.load(sys.stdin)',
    'ns={"w":"http://schemas.openxmlformats.org/wordprocessingml/2006/main"}',
    'val="{"+ns["w"]+"}val"',
    'styles=etree.fromstring(data["styles"].encode())',
    'document=etree.fromstring(data["document"].encode())',
    'entries=styles.findall("w:style",ns)',
    'ids=[s.get("{"+ns["w"]+"}styleId") for s in entries]',
    'assert len(ids)==len(set(ids)), "Duplicate Word style IDs: "+str([i for i in set(ids) if ids.count(i)>1])',
    'names=[s.find("w:name",ns).get(val).casefold() for s in entries]',
    'assert len(names)==len(set(names)), "Duplicate Word style names"',
    'by_id=dict(zip(ids,entries))',
    'assert by_id["Title"].find("w:name",ns).get(val)=="Title"',
    'assert by_id["Title"].find("w:pPr/w:outlineLvl",ns) is None',
    'for level in range(1,7):',
    ' s=by_id["Heading"+str(level)]',
    ' assert s.find("w:name",ns).get(val)=="Heading "+str(level)',
    ' assert s.find("w:pPr/w:outlineLvl",ns).get(val)==str(level-1)',
    ' assert s.find("w:rPr/w:color",ns).get(val)=="000000"',
    'refs=document.findall(".//w:pPr/w:pStyle",ns)',
    'assert [r.get(val) for r in refs]==["Title","Metadata"]+["Heading"+str(i) for i in range(1,7)]',
    'assert all(r.get(val) in by_id for r in document.findall(".//w:pStyle",ns)+document.findall(".//w:rStyle",ns))',
    'print("PASS: unique Word styles; Title and Heading 1–6 have correct names and outline levels; paragraph and hyperlink references resolve.")'
  ].join('\n')],{input:JSON.stringify(input),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  console.log(result.stdout.trim());
})().catch(error=>{console.error(error);process.exitCode=1;});
