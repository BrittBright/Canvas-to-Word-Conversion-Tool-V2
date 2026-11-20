// No instructor content is stored here. Pass a real exported ZIP as argv[2].
// TEST_NODE_MODULES can point to an existing development install of jsdom.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require(path.join(process.env.TEST_NODE_MODULES||'jsdom',process.env.TEST_NODE_MODULES?'jsdom':''));
const root=path.resolve(__dirname,'..');
const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://studio.example/'}),w=dom.window;
w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.setImmediate=setImmediate;
for(const f of ['vendor/jszip.min.js','question-types.js','app.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),dom.getInternalVMContext(),{filename:f});
const js=source=>w.eval(source),node=value=>JSON.parse(JSON.stringify(value));
const bytes=blob=>new Promise((resolve,reject)=>{const r=new w.FileReader();r.onerror=()=>reject(r.error);r.onload=()=>resolve(new w.Uint8Array(r.result));r.readAsArrayBuffer(blob);});
const zipBlob=async blob=>w.JSZip.loadAsync(await bytes(blob));
const sourceTree=n=>{if(n.nodeType===3)return n.textContent.trim()?n.textContent:null;if(n.nodeType!==1)return null;return [n.localName,[...n.attributes].filter(a=>!a.name.startsWith('xmlns')).map(a=>[a.localName,a.value]).sort(),[...n.childNodes].map(sourceTree).filter(x=>x!==null)];};
const xmlElement=(source,name)=>w.first(w.parseXml(source),name);
const makeFile=async z=>new w.File([await z.generateAsync({type:'uint8array'})],'test.zip');
(async()=>{
  if(process.argv[2]){
    const input=new w.File([fs.readFileSync(process.argv[2])],'instructor.zip');await w.handleQti(input);const course=js('qtiState');assert(course,w.document.getElementById('qti-status').textContent);
    assert.equal(course.items.length,100);assert.equal(course.warnings.length,0,JSON.stringify(course.warnings));
    const counts={};course.items.forEach(q=>counts[q.type]=(counts[q.type]||0)+1);assert.deepEqual(counts,{multiple_choice:77,multiple_answer:12,ordering:1,numerical:5,categorization:4,matching:1});
    assert.equal(course.items[5].sequence.length,6);for(const q of course.items.filter(q=>q.type==='numerical'))assert.deepEqual(node(q.numericRules),[{kind:'exact',value:w.text(w.first(w.parseXml(q.sourceXml),'varequal'))}]);
    assert.equal(course.items[53].choices.length,12,'Category options are not triplicated');assert.deepEqual(node(course.items[53].groups.map(g=>g.correctIds.length)),[1,2,2]);assert.equal(course.items[84].choices.length,4);assert.equal(course.items[84].groups.length,4);
    for(const q of course.items.filter(q=>q.type==='multiple_answer')){
      const raw=w.parseXml(q.sourceXml),positive=new Set();
      for(const c of w.descendants(raw,'respcondition'))if(Number(w.text(w.first(c,'setvar')))>0)for(const v of w.descendants(c,'varequal'))if(!w.hasNegatedAncestor(v,c))positive.add(w.text(v));
      assert.deepEqual(node(q.choices.filter(c=>c.correct).map(c=>c.id).sort()),[...positive].sort(),'Negated choices must not be marked correct');
    }
    const editable=await w.makeDocx(course.title,course.items,'editable',false,course);const lines=await w.docxParagraphs(editable),parsed=w.parseStructuredTemplate(lines);w.attachSource(parsed,lines.sourcePackage);assert.deepEqual(node(parsed.errors),[]);
    assert(lines.sourcePackage,'Original source survives in the editable DOCX');assert.equal(parsed.items.length,100);
    const round=await w.makeQti(course.title,parsed.items,parsed),rebuilt=await w.readQti(await bytes(round));assert.equal(rebuilt.items.length,100);assert.equal(rebuilt.warnings.length,0);
    for(let i=0;i<100;i++){
      assert.deepEqual(node(sourceTree(w.parseXml(course.items[i].sourceXml).documentElement)),node(sourceTree(w.parseXml(rebuilt.items[i].sourceXml).documentElement)),`Question ${i+1} unchanged content, key, feedback, points, and settings`);
    }
    const zround=await zipBlob(round);for(const [name,entry] of Object.entries(course.zip.files))if(!entry.dir&&name!==course.assessmentPath){if(name.endsWith('/assessment_meta.xml')){const before=w.parseXml(w.repairCanvasMetadata(await entry.async('string'))),after=w.parseXml(await zround.file(name).async('string'));assert.deepEqual(node(sourceTree(before.documentElement)),node(sourceTree(after.documentElement)),'Quiz settings retained after narrow namespace repair');}else assert.equal(await entry.async('base64'),await zround.file(name).async('base64'),'Original companion files retained');}
    await w.handleWord(new w.File([await bytes(editable)],'edited.docx'));assert.equal(w.document.getElementById('download-qti').disabled,false);assert.equal(js('wordState.items.length'),100);assert.equal(w.document.querySelectorAll('#qti-preview .question').length,100);
    // Exercise edits in every advanced type without rebuilding unrelated rules.
    const edited=w.parseStructuredTemplate(lines);w.attachSource(edited,lines.sourcePackage);const qs=edited.items;
    qs[5].sequence.reverse();qs[37].numericRules=[{kind:'range',min:'1.9',max:'2.1',minInclusive:true,maxInclusive:true}];
    const c=qs[53];c.groups[0].correctIds=[c.choices[0].id];qs[84].groups[0].correctIds=[qs[84].choices[0].id];qs[90].stem+='\nEdited directions.';qs[95].groups[0].label+=' edited';
    const editRound=await w.readQti(await bytes(await w.makeQti(course.title,qs,edited)));
    assert.deepEqual(node(editRound.items[5].sequence),node(qs[5].sequence));assert.deepEqual(node(editRound.items[37].numericRules),node(qs[37].numericRules));assert.deepEqual(node(editRound.items[53].groups[0].correctIds),node(c.groups[0].correctIds));assert.deepEqual(node(editRound.items[84].groups[0].correctIds),node(qs[84].groups[0].correctIds));assert(editRound.items[90].stem.endsWith('Edited directions.'));assert(editRound.items[95].groups[0].label.endsWith(' edited'));
    const before=xmlElement(course.items[53].sourceXml,'resprocessing'),after=xmlElement(editRound.items[53].sourceXml,'resprocessing');assert.deepEqual(node(w.descendants(before,'setvar').map(n=>[n.getAttribute('action'),n.textContent])),node(w.descendants(after,'setvar').map(n=>[n.getAttribute('action'),n.textContent])),'Original category scoring weights retained');
    const noSource=w.parseStructuredTemplate(lines);w.attachSource(noSource,null);assert(noSource.errors.length,'Missing original data must block a misleading re-upload');
    const reordered=w.parseStructuredTemplate(lines);w.attachSource(reordered,lines.sourcePackage);reordered.items.reverse();const reorderedRound=await w.readQti(await bytes(await w.makeQti('Reordered quiz',reordered.items,reordered)));assert.equal(reorderedRound.title,'Reordered quiz');assert.equal(reorderedRound.items[0].id,course.items[99].id,'Word question order is retained');
    const out=process.env.QTI_TEST_OUTPUT;if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'roundtrip.zip'),await bytes(round));
      for(const mode of ['blank','answer-key']){
        const full=await w.makeDocx(course.title,course.items,mode),z=await zipBlob(full);assert(!Object.keys(z.files).some(n=>n.startsWith('customXml/')),'Clean copies do not contain the original answer payload');
        const xml=await z.file('word/document.xml').async('string');assert(!xml.includes('Source ID:'));if(mode==='blank')assert(!/Correct order:|Exact answer:|Accepted range:|Instructor key/.test(xml));
        fs.writeFileSync(path.join(out,mode+'.docx'),await bytes(full));
        const sample=course.items.filter(q=>[6,38,54,73,85,91,96].includes(q.number));fs.writeFileSync(path.join(out,'sample-'+mode+'.docx'),await bytes(await w.makeDocx(course.title,sample,mode)));
      }fs.writeFileSync(path.join(out,'editable.docx'),await bytes(editable));
    }
    console.log('PASS real course: 100 questions; all 11 formerly flagged items; 12 multiple-answer negation checks; exact unchanged round-trip; edits in all four new types; original scoring and companion files retained; student/key separation.');
  }
  const fixture=[
    '[[QUESTION]]','Type: Ordering','Points: 2','Stem: Arrange the steps.','Choices:','a. Second step','b. First step','c. Last step','Correct order: b, a, c','Feedback:','[[END QUESTION]]',
    '[[QUESTION]]','Type: Numerical','Points: 1','Stem: Enter a number.','Range: 1.9 | 2.1 | exclusive | inclusive','Exact: 5','Feedback:','[[END QUESTION]]',
    '[[QUESTION]]','Type: Matching','Points: 3','Stem: Match each letter.','Choices:','a. Beta','b. Alpha','c. Distractor','Prompts:','1. A','2. B','Matches:','1 = b','2 = a','Feedback:','[[END QUESTION]]',
    '[[QUESTION]]','Type: Categorization','Points: 4','Stem: Select two items.','Choices:','a. Red','b. Green','c. Blue','d. Unused','Categories:','1. Warm','2. Cool','Assignments:','1 = a','2 = b, c','Feedback:','[[END QUESTION]]'
  ];
  const s=w.parseStructuredTemplate(fixture);assert.deepEqual(node(s.errors),[]);const modern=await w.readQti(await bytes(await w.makeQti('Synthetic',s.items,null)));assert.equal(modern.items.length,4);assert.equal(modern.warnings.length,0);assert.equal(modern.items[1].numericRules[0].minInclusive,false);assert.equal(modern.items[2].choices.length,3);assert.equal(modern.items[3].choices.length,4);
  const duplicate=w.parseStructuredTemplate(fixture.map(s=>s==='Correct order: b, a, c'?'Correct order: a, a, c':s));assert(duplicate.errors.length);
  const reversed=w.parseStructuredTemplate(fixture.map(s=>s.startsWith('Range:')?'Range: 9 | 2':s));assert(reversed.errors.length);
  const missing=w.parseStructuredTemplate(fixture.map(s=>s==='1 = b'?'1 = z':s));assert(missing.errors.length);
  // Baseline compatibility includes correct answers, zero points and line breaks.
  const legacy=w.parseTemplate(['[[QUESTION]]','Type: Short answer','Points: 0','Stem: First line','Second line','Answer: yes | YES','Feedback: Good.','[[END QUESTION]]']);assert.deepEqual(node(legacy.errors),[]);assert.equal(legacy.items[0].points,0);assert(legacy.items[0].stem.includes('\n'));assert.equal((await w.readQti(await bytes(await w.makeQti('Legacy',legacy.items,null)))).items[0].answers.length,2);
  console.log('PASS synthetic: fresh questions for all four types; exclusive/inclusive ranges and alternative answers; matching/category distractors; malformed key/range rejection; legacy template compatibility.');
  // Exercise the real download button, including when an instructor's source
  // quiz is already loaded. Authoring examples must never inherit that source.
  let templateDownload;const priorDownload=w.download;w.download=(blob,name)=>{templateDownload={blob,name};};await w.document.getElementById('download-template').onclick();w.download=priorDownload;
  assert.equal(templateDownload.name,'QTI_Word_Studio_Template.docx');const templateZip=await zipBlob(templateDownload.blob);assert(!Object.keys(templateZip.files).some(n=>n.startsWith('customXml/')),'New authoring template excludes imported source data');
  const templateLines=await w.docxParagraphs(templateDownload.blob),template=w.parseTemplate(templateLines);w.attachSource(template,templateLines.sourcePackage);assert.deepEqual(node(template.errors),[]);assert.equal(template.items.length,11);
  assert.deepEqual([...new Set(template.items.map(q=>q.type))].sort(),['categorization','essay','matching','multiple_answer','multiple_choice','numerical','ordering','short_answer','text_only','true_false']);
  assert.equal(template.items.find(q=>q.type==='text_only').points,0);assert.equal(template.items.find(q=>q.type==='essay').points,5);
  assert.deepEqual(node(template.items.find(q=>q.type==='multiple_choice').choices.map(c=>c.correct)),[true,false,false,false]);
  assert.deepEqual(node(template.items.find(q=>q.type==='multiple_answer').choices.map(c=>c.correct)),[true,false,true,false]);
  assert.deepEqual(node(template.items.find(q=>q.type==='true_false').choices.map(c=>c.correct)),[true,false]);
  assert.deepEqual(node(template.items.find(q=>q.type==='short_answer').answers),['Tuesday','Tue','Tues']);
  const order=template.items.find(q=>q.type==='ordering');assert.deepEqual(node(order.sequence.map(id=>order.choices.findIndex(c=>c.id===id))),[1,2,0]);
  assert.deepEqual(node(template.items.filter(q=>q.type==='numerical').map(q=>q.numericRules)),[[{kind:'exact',value:'120'}],[{kind:'range',min:'3.32',max:'3.34',minInclusive:true,maxInclusive:true}]]);
  const matching=template.items.find(q=>q.type==='matching'),category=template.items.find(q=>q.type==='categorization');
  assert.deepEqual(node(matching.groups.map(g=>g.correctIds.map(id=>matching.choices.findIndex(c=>c.id===id)))),[[1],[0]]);
  assert.deepEqual(node(category.groups.map(g=>g.correctIds.map(id=>category.choices.findIndex(c=>c.id===id)))),[[0,3],[1,4]]);
  assert(!template.items.some(q=>/Star exactly one|How to Use This Template|Keep each field label/.test(q.stem)),'How-to notes are not imported as question text');
  const templateQti=await w.readQti(await bytes(await w.makeQti('Template check',template.items,null)));assert.equal(templateQti.items.length,11);assert.equal(templateQti.warnings.length,0);
  const editTemplate=await w.makeDocx(templateQti.title,templateQti.items,'editable',false,templateQti),editLines=await w.docxParagraphs(editTemplate),editParsed=w.parseTemplate(editLines);w.attachSource(editParsed,editLines.sourcePackage);assert.deepEqual(node(editParsed.errors),[],'Every supported example can be edited after QTI export, including essay and short answer');
  const reread=await w.readQti(await bytes(await w.makeQti(templateQti.title,editParsed.items,editParsed)));for(let i=0;i<11;i++)assert.deepEqual(node(sourceTree(w.parseXml(templateQti.items[i].sourceXml).documentElement)),node(sourceTree(w.parseXml(reread.items[i].sourceXml).documentElement)),'All template examples retain their source through re-upload');
  if(process.env.QTI_TEMPLATE_OUTPUT){const p=process.env.QTI_TEMPLATE_OUTPUT;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,await bytes(templateDownload.blob));}
  console.log('PASS template download: 11 worked examples for all 10 types; exact/range variants; guide text excluded; no imported source payload; all answers and point values validated; Word/QTI/editable Word/QTI round-trip.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>w.close());
