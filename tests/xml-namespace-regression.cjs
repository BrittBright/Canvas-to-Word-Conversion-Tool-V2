// Regression for the malformed Canvas quiz namespace rejected by Chrome.
// Run with Node and Python with lxml; TEST_PYTHON can select the interpreter.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const context={window:{}};
const projectRoot=path.join(__dirname,'..');
const converterPath=fs.existsSync(path.join(projectRoot,'dist/converter.js'))
  ? path.join(projectRoot,'dist/converter.js') : path.join(projectRoot,'converter.js');
vm.runInNewContext(fs.readFileSync(converterPath,'utf8'),context);
const normalize=context.window.CanvasWord.normalizeCanvasXml;
const valid='<quiz xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="example"><title>Example quiz</title><description>&lt;p&gt;Keep these directions &amp; punctuation.&lt;/p&gt;</description></quiz>';
const badUri='http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd';
const malformed=valid.replace('http://www.w3.org/2001/XMLSchema-instance',badUri);
const singleQuoted=malformed.replace('xmlns:xsi="'+badUri+'"',"xmlns:xsi='"+badUri+"'");
const corrected=normalize(malformed);
assert.equal(corrected,valid);
assert.equal(normalize(singleQuoted),valid);
assert.equal(normalize(valid),valid);
assert.equal(normalize(corrected),corrected);
const broken='<quiz><title>Unclosed';
assert.equal(normalize(broken),broken);
const python=process.env.TEST_PYTHON||process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3';
const result=spawnSync(python,['-c',[
  'import json,sys',
  'from lxml import etree',
  'results=[]',
  'for source in json.load(sys.stdin):',
  ' try: etree.fromstring(source.encode(),etree.XMLParser(resolve_entities=False,no_network=True,recover=False)); results.append(True)',
  ' except etree.XMLSyntaxError: results.append(False)',
  'print(json.dumps(results))'
].join('\n')],{input:JSON.stringify([malformed,corrected,normalize(singleQuoted),valid,broken]),encoding:'utf8'});
assert.equal(result.status,0,result.stderr||result.error?.message);
assert.deepEqual(JSON.parse(result.stdout),[false,true,true,true,false]);
console.log('PASS: malformed quiz namespace rejected before repair; repaired and valid XML accepted; other invalid XML still rejected.');
