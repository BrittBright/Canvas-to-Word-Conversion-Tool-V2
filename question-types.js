"use strict";

// Canvas's QTI 1.2 extensions use response identifiers to distinguish category
// assignments and matching pairs. Never infer a key from option display order.
const ADVANCED_TYPES=new Set(["ordering","numerical","categorization","matching"]);
const ALL_TYPES=new Set(["multiple_choice","multiple_answer","true_false","essay","short_answer","text_only",...ADVANCED_TYPES]);
function choiceLetter(index){let s="";for(index++;index;index=Math.floor((index-1)/26))s=String.fromCharCode(65+(index-1)%26)+s;return s;}
function letterIndex(s){return [...s.toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;}
function hasNegatedAncestor(node,root){for(let p=node.parentElement;p&&p!==root;p=p.parentElement)if(p.localName==="not")return true;return false;}
function positiveConditions(item){return descendants(item,"respcondition").filter(c=>descendants(c,"setvar").some(s=>["SCORE","ORDERSCORE",null].includes(s.getAttribute("varname"))&&Number(text(s))>0));}
function correctByResponse(item){const map=new Map();for(const c of positiveConditions(item))for(const v of descendants(c,"varequal")){if(hasNegatedAncestor(v,c))continue;const id=v.getAttribute("respident")||"response1";if(!map.has(id))map.set(id,[]);if(!map.get(id).includes(text(v)))map.get(id).push(text(v));}return map;}
function responseOptions(response){return descendants(response,"response_label").map(l=>({id:l.getAttribute("ident"),text:stripHtml(text(first(l,"mattext"))),correct:false}));}
function numericRules(item){
  const rules=[];let unknown=false;
  function parse(node){
    if(!node)return [];
    const name=node.localName;
    if(name==="conditionvar"&&node.children.length===1)return parse(node.children[0]);
    if(name==="or")return [...node.children].flatMap(parse);
    if(name==="varequal"&&text(node)!==""&&Number.isFinite(Number(text(node)))){
      if([...node.attributes].some(a=>!["respident","case"].includes(a.name))){unknown=true;return [];}
      return [{kind:"exact",value:text(node)}];
    }
    if(name==="and"||name==="conditionvar"){
      const bounds={kind:"range",min:null,max:null,minInclusive:true,maxInclusive:true};
      for(const c of node.children){const n=c.localName,value=text(c);if(!Number.isFinite(Number(value))||!value){unknown=true;return [];}
        if(n==="vargte"||n==="vargt"){bounds.min=value;bounds.minInclusive=n==="vargte";}
        else if(n==="varlte"||n==="varlt"){bounds.max=value;bounds.maxInclusive=n==="varlte";}
        else{unknown=true;return [];}}
      if(bounds.min===null||bounds.max===null){unknown=true;return [];}
      if(Number(bounds.min)===Number(bounds.max)&&bounds.minInclusive&&bounds.maxInclusive)return [{kind:"exact",value:bounds.min}];
      return [bounds];
    }
    unknown=true;return [];
  }
  for(const c of positiveConditions(item))rules.push(...parse(first(c,"conditionvar")));
  const unique=rules.filter((r,i)=>rules.findIndex(x=>JSON.stringify(x)===JSON.stringify(r))===i);
  return {rules:unique,unknown};
}
function extendQuestion(q,item){
  q.sourceXml=new XMLSerializer().serializeToString(item);q.notes=[];
  if(["essay","short_answer","text_only"].includes(q.type))q.choices=[];
  const responses=localChildren(first(item,"presentation"),"response_lid"),keys=correctByResponse(item);
  if(q.type==="ordering"){
    q.choices=responses.length?responseOptions(responses[0]):[];q.sequence=keys.get(responses[0]?.getAttribute("ident"))||[];
    if(!q.choices.length||q.sequence.length!==q.choices.length||new Set(q.sequence).size!==q.choices.length||q.sequence.some(id=>!q.choices.some(c=>c.id===id)))q.notes.push("The complete ordering key could not be recovered. Check the source assessment.");
  }else if(q.type==="numerical"){
    const n=numericRules(item);q.numericRules=n.rules;q.numericUnknown=n.unknown;
    if(n.unknown||!n.rules.length)q.notes.push("Numerical scoring contains rules that need instructor review. The original scoring is retained in the editable file.");
    q.choices=[];
  }else if(q.type==="matching"||q.type==="categorization"){
    const options=new Map();q.groups=responses.map((r,i)=>{
      const choices=responseOptions(r);for(const c of choices){if(options.has(c.id)&&options.get(c.id).text!==c.text)q.notes.push("The same option identifier has conflicting text; check the source question.");else if(!options.has(c.id))options.set(c.id,c);}
      return {id:r.getAttribute("ident"),label:stripHtml(text(first(localChildren(r,"material")[0],"mattext")))||`Group ${i+1}`,optionIds:choices.map(c=>c.id),correctIds:keys.get(r.getAttribute("ident"))||[]};
    });q.choices=[...options.values()];
    if(!q.groups.length||q.groups.some(g=>!g.correctIds.length||g.correctIds.some(id=>!g.optionIds.includes(id))))q.notes.push("One or more category or matching keys could not be recovered. Check the source assessment.");
    if(q.type==="matching"&&q.groups.some(g=>g.correctIds.length!==1))q.notes.push("This matching item has a nonstandard key and requires instructor review.");
  }
  if(!ADVANCED_TYPES.has(q.type)&&["multiple_choice","multiple_answer","true_false"].includes(q.type)&&!q.choices.some(c=>c.correct))q.notes.push("No correct choice was recovered; check the answer key.");
  if(/<(img|iframe|video|audio|math)\b/i.test(q.stemHtml)||/\\\(|\\\[/.test(q.stemHtml))q.notes.push("The question includes media or complex math that needs review in the Word output.");
  return q;
}
function keyLetters(q,ids){return ids.map(id=>{const i=q.choices.findIndex(c=>c.id===id);return i<0?"?":choiceLetter(i);}).join(", ");}
function numericDescription(r){return r.kind==="exact"?`Exact answer: ${r.value}`:`Accepted range: ${r.min}${r.minInclusive?" ≤":" <"} answer ${r.maxInclusive?"≤":"<"} ${r.max}`;}
function advancedPreview(q){
  if(!ADVANCED_TYPES.has(q.type))return null;
  const options=q.choices.map((c,i)=>`<div class="choice">${choiceLetter(i)}. ${escapeHtml(c.text)}</div>`).join("");
  let key="";
  if(q.type==="numerical")key=(q.numericRules||[]).map(numericDescription).map(escapeHtml).join("<br>")||"Review numerical scoring.";
  if(q.type==="ordering")key=`Correct order: ${keyLetters(q,q.sequence||[])||"Review required"}`;
  if(q.type==="matching"||q.type==="categorization")key=(q.groups||[]).map((g,i)=>`${i+1}. ${escapeHtml(g.label)}: ${keyLetters(q,g.correctIds)}`).join("<br>");
  return `${options}<div class="key-preview"><strong>Instructor key</strong><br>${key}</div>`;
}
function editableAdvanced(q,body){
  if(!ADVANCED_TYPES.has(q.type))return false;
  if(q.type==="numerical"){
    for(const r of q.numericRules||[])body.push(paragraphXml(r.kind==="exact"?`Exact: ${r.value}`:`Range: ${r.min} | ${r.max} | ${r.minInclusive?"inclusive":"exclusive"} | ${r.maxInclusive?"inclusive":"exclusive"}`));
    if(!q.numericRules?.length)body.push(paragraphXml("Numerical scoring: Preserve original rules"));
  }else{
    body.push(paragraphXml("Choices:"));q.choices.forEach((c,i)=>body.push(paragraphXml(`${choiceLetter(i).toLowerCase()}. ${c.text}`)));
    if(q.type==="ordering")body.push(paragraphXml(`Correct order: ${keyLetters(q,q.sequence||[])}`));
    else{
      body.push(paragraphXml(q.type==="matching"?"Prompts:":"Categories:"));q.groups.forEach((g,i)=>body.push(paragraphXml(`${i+1}. ${g.label}`)));
      body.push(paragraphXml(q.type==="matching"?"Matches:":"Assignments:"));q.groups.forEach((g,i)=>body.push(paragraphXml(`${i+1} = ${keyLetters(q,g.correctIds)}`)));
    }
  }return true;
}
function printableAdvanced(q,body,key){
  if(!ADVANCED_TYPES.has(q.type))return false;
  const start=body.length;
  const instruction=s=>body.push(paragraphXml(s,"<w:i/>","<w:keepNext/>"));
  const option=(c,i,prefix="")=>body.push(paragraphXml(`${prefix}${choiceLetter(i)}. ${c.text}`));
  if(q.type==="numerical"){
    if(key){for(const r of q.numericRules||[])body.push(paragraphXml(numericDescription(r),"<w:b/>"));if(!q.numericRules?.length)body.push(paragraphXml("Review numerical scoring in Canvas."));}
    else{if(!/_{3,}/.test(q.stem))body.push(paragraphXml("Answer: ________________________________________"));body.push(paragraphXml("Work: ______________________________________________________________"));}
  }else if(q.type==="ordering"){
    instruction("Write each step's position in the blank. Use every step.");q.choices.forEach((c,i)=>option(c,i,key?`${(q.sequence||[]).indexOf(c.id)+1}.  `:"_____  "));
    if(key)body.push(paragraphXml(`Correct order: ${keyLetters(q,q.sequence||[])}`,"<w:b/>"));
  }else if(q.type==="matching"){
    instruction("Write the letter of the matching choice beside each prompt. Follow the question's directions about reusing choices.");
    q.groups.forEach((g,i)=>body.push(paragraphXml(`${i+1}. ${key?keyLetters(q,g.correctIds):"_____"}   ${g.label}`)));
    body.push(paragraphXml("Choices","<w:b/>","<w:keepNext/>"));q.choices.forEach((c,i)=>option(c,i));
  }else{
    instruction("Write the letters of your selected choices for each category. Use the number of choices specified in the question.");
    q.groups.forEach((g,i)=>body.push(paragraphXml(`${i+1}. ${g.label}: ${key?keyLetters(q,g.correctIds):"________________________________"}`)));
    body.push(paragraphXml("Choices","<w:b/>","<w:keepNext/>"));q.choices.forEach((c,i)=>option(c,i));
  }
  if(key)for(const note of q.notes||[])body.push(paragraphXml(`Review: ${note}`,"<w:i/>"));
  if(q.choices.length+(q.groups||[]).length<=20&&q.choices.every(c=>c.text.length<350))for(let i=Math.max(0,start-1);i<body.length-1;i++)body[i]=keepWithNext(body[i]);
  return true;
}
function keepWithNext(xml){if(xml.includes("<w:keepNext"))return xml;return xml.includes("<w:pPr>")?xml.replace("<w:pPr>","<w:pPr><w:keepNext/>"):xml.replace("<w:p>","<w:p><w:pPr><w:keepNext/></w:pPr>");}

// Preserve paragraph boundaries, explicit superscripts/subscripts and inline
// emphasis. Media is reported, never fetched from the instructor's network.
function richParagraphs(source){
  const d=document.createElement("div");d.innerHTML=source;d.querySelectorAll("script,style,iframe,video,audio").forEach(n=>n.remove());
  const blocks=[],runs=[];
  function flush(){if(runs.length){blocks.push(`<w:p>${runs.join("")}</w:p>`);runs.length=0;}}
  function walk(n,format=""){
    if(n.nodeType===3){if(n.textContent.trim()||runs.length)runs.push(`<w:r>${format?`<w:rPr>${format}</w:rPr>`:""}<w:t xml:space="preserve">${escapeXml(n.textContent.replace(/\u00a0/g," "))}</w:t></w:r>`);return;}
    if(n.nodeType!==1)return;const tag=n.tagName.toLowerCase();
    if(tag==="br"){runs.push("<w:r><w:br/></w:r>");return;}
    if(tag==="img"){runs.push(`<w:r><w:t>${escapeXml(`[Image requires review${n.getAttribute("alt")?": "+n.getAttribute("alt"):""}]`)}</w:t></w:r>`);return;}
    const block=/^(p|div|li|h[1-6]|tr|table)$/.test(tag);if(block)flush();
    const f=format+({strong:"<w:b/>",b:"<w:b/>",em:"<w:i/>",i:"<w:i/>",sup:'<w:vertAlign w:val="superscript"/>',sub:'<w:vertAlign w:val="subscript"/>'}[tag]||"");
    if(tag==="li")runs.push("<w:r><w:t>• </w:t></w:r>");
    for(const c of n.childNodes)walk(c,f);
    if(tag==="td"||tag==="th")runs.push("<w:r><w:t xml:space=\"preserve\">   </w:t></w:r>");
    if(block)flush();
  }
  for(const c of d.childNodes)walk(c);flush();return blocks.length?blocks:[paragraphXml("")];
}
function addWordStyles(zip){
  zip.file("word/styles.xml",`<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="260" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="200"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="000000"/></w:rPr></w:style></w:styles>`);
  zip.file("word/_rels/document.xml.rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
}
function base64Bytes(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
async function embedSource(zip,source){
  if(!source?.zip)return;
  const b64=await source.zip.generateAsync({type:"base64",compression:"DEFLATE"});
  zip.file("customXml/item1.xml",`<?xml version="1.0" encoding="UTF-8"?><qtiSource xmlns="urn:brightpoint:qti-word:source" version="1.3">${b64}</qtiSource>`);
  zip.file("customXml/itemProps1.xml",'<?xml version="1.0" encoding="UTF-8"?><ds:datastoreItem ds:itemID="{1B25648F-4D44-4279-90C4-82D98914AD51}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="urn:brightpoint:qti-word:source"/></ds:schemaRefs></ds:datastoreItem>');
  zip.file("customXml/_rels/item1.xml.rels",'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="properties" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>');
  const rel=await zip.file("word/_rels/document.xml.rels").async("string");zip.file("word/_rels/document.xml.rels",rel.replace("</Relationships>",'<Relationship Id="source" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>'));
  const ct=await zip.file("[Content_Types].xml").async("string");zip.file("[Content_Types].xml",ct.replace("</Types>",'<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>'));
}

function parseStructuredTemplate(lines){
  const result={items:[],errors:[]};let start=-1;
  for(let i=0;i<lines.length;i++){
    if(lines[i]==="[[QUESTION]]"){if(start>=0)result.errors.push("A question is missing [[END QUESTION]].");start=i+1;continue;}
    if(lines[i]!=="[[END QUESTION]]")continue;
    if(start<0){result.errors.push("Found [[END QUESTION]] without [[QUESTION]].");continue;}
    const q={number:result.items.length+1,id:uid(),title:"",type:"",points:1,stem:"",stemHtml:"",choices:[],groups:[],answers:[],feedback:"",numericRules:[],supported:true,notes:[]},assignments=new Map();let mode="",order="";
    const error=s=>result.errors.push(`Question ${q.number}: ${s}`);
    for(const line of lines.slice(start,i)){
      let m;
      if((m=/^Source ID:\s*(.*)$/i.exec(line))){q.sourceId=m[1];mode="";}
      else if((m=/^Type:\s*(.*)$/i.exec(line))){q.type=normalizeType(m[1]);mode="";}
      else if((m=/^Points:\s*(.*)$/i.exec(line))){q.points=m[1].trim()?Number(m[1]):NaN;mode="";}
      else if((m=/^Title:\s*(.*)$/i.exec(line))){q.title=m[1];mode="";}
      else if((m=/^Stem:\s*(.*)$/i.exec(line))){q.stem=m[1];mode="stem";}
      else if(/^(Choices|Options):\s*$/i.test(line)){mode="choices";}
      else if(/^(Prompts|Categories):\s*$/i.test(line)){mode="groups";}
      else if(/^(Matches|Assignments):\s*$/i.test(line)){mode="assignments";}
      else if((m=/^Correct order:\s*(.*)$/i.exec(line))){order=m[1];mode="";}
      else if((m=/^Exact:\s*(.*)$/i.exec(line))){q.numericRules.push({kind:"exact",value:m[1].trim()});mode="";}
      else if((m=/^Range:\s*(.*)$/i.exec(line))){const [min,max,lo="inclusive",hi="inclusive"]=m[1].split("|").map(s=>s.trim());if(!["inclusive","exclusive"].includes(lo)||!["inclusive","exclusive"].includes(hi))error("Range boundaries must be inclusive or exclusive.");q.numericRules.push({kind:"range",min,max,minInclusive:lo==="inclusive",maxInclusive:hi==="inclusive"});mode="";}
      else if(/^Numerical scoring:\s*Preserve original rules$/i.test(line)){q.numericPreserve=true;mode="";}
      else if((m=/^Answer:\s*(.*)$/i.exec(line))){q.answers=m[1].split("|").map(s=>s.trim()).filter(Boolean);mode="";}
      else if((m=/^Feedback:\s*(.*)$/i.exec(line))){q.feedback=m[1];mode="feedback";}
      else if(mode==="choices"&&(m=/^(\*?)([a-z]+)\.\s*(.*)$/i.exec(line))){if(letterIndex(m[2])!==q.choices.length)error("Choice letters must be consecutive, beginning with a.");q.choices.push({id:uid("a"),text:m[3],correct:!!m[1]});}
      else if(mode==="choices"&&line&&q.choices.length)q.choices.at(-1).text+="\n"+line;
      else if(mode==="groups"&&(m=/^(\d+)\.\s*(.*)$/.exec(line))){if(Number(m[1])!==q.groups.length+1)error("Prompt/category numbers must be consecutive, beginning with 1.");q.groups.push({id:uid("r"),label:m[2],correctIds:[]});}
      else if(mode==="groups"&&line&&q.groups.length)q.groups.at(-1).label+="\n"+line;
      else if(mode==="assignments"&&(m=/^(\d+)\s*=\s*(.*)$/.exec(line))){if(assignments.has(Number(m[1])))error("Each prompt/category may have only one assignment line.");assignments.set(Number(m[1]),m[2]);}
      else if(mode==="assignments"&&line)error("Use assignment lines such as 1 = a, c.");
      else if(mode==="stem")q.stem+=(q.stem?"\n":"")+line;
      else if(mode==="feedback"&&line)q.feedback+=(q.feedback?"\n":"")+line;
    }
    q.title=q.title||`Question ${q.number}`;q.stemHtml=escapeHtml(q.stem).replace(/\n/g,"<br>");
    if(!ALL_TYPES.has(q.type))error("unsupported or missing Type.");if(!q.stem)error("missing Stem text.");if(!Number.isFinite(q.points)||q.points<0)error("Points must be zero or a positive number.");
    const letters=s=>s.split(/[,\s]+/).filter(Boolean).map(token=>{const index=/^[a-z]+$/i.test(token)?letterIndex(token):-1;if(index<0||index>=q.choices.length){error(`Unknown choice “${token}” in the key.`);return "";}return q.choices[index].id;});
    if(["multiple_choice","multiple_answer","true_false"].includes(q.type)){
      const n=q.choices.filter(c=>c.correct).length;if(q.choices.length<2)error("at least two choices are required.");if(["multiple_choice","true_false"].includes(q.type)&&n!==1)error("exactly one starred answer is required.");if(q.type==="multiple_answer"&&!n)error("at least one starred answer is required.");if(q.type==="true_false"&&q.choices.length!==2)error("True/False requires two choices.");
    }
    if(q.type==="short_answer"&&!q.answers.length)error("short answer requires at least one Answer.");
    if(q.type==="ordering"){
      q.sequence=letters(order);if(q.choices.length<2||q.sequence.length!==q.choices.length||new Set(q.sequence).size!==q.choices.length)error("Correct order must list every choice exactly once.");
    }
    if(q.type==="matching"||q.type==="categorization"){
      if(!q.groups.length||q.choices.length<2)error("prompts/categories and at least two choices are required.");
      q.groups.forEach((g,index)=>{g.optionIds=q.choices.map(c=>c.id);if(!assignments.has(index+1))error(`Missing assignment for prompt/category ${index+1}.`);g.correctIds=letters(assignments.get(index+1)||"");if(new Set(g.correctIds).size!==g.correctIds.length)error("An assignment repeats a choice.");if(q.type==="matching"&&g.correctIds.length!==1)error("Each matching prompt needs exactly one answer.");});
      for(const n of assignments.keys())if(n<1||n>q.groups.length)error(`Unknown prompt/category ${n}.`);
    }
    if(q.type==="numerical"){
      if(!q.numericRules.length&&!q.numericPreserve)error("Add an Exact or Range answer.");
      for(const r of q.numericRules){const values=r.kind==="exact"?[r.value]:[r.min,r.max];if(values.some(v=>v===undefined||v===""||!Number.isFinite(Number(v))))error("Numerical answers must be finite numbers.");if(r.kind==="range"&&(Number(r.min)>Number(r.max)||(Number(r.min)===Number(r.max)&&(!r.minInclusive||!r.maxInclusive))))error("The numerical range is empty or reversed.");}
    }
    if(q.choices.some(c=>!c.text))error("Choice text cannot be empty.");if(q.groups.some(g=>!g.label))error("Prompt/category text cannot be empty.");
    result.items.push(q);start=-1;
  }
  if(start>=0)result.errors.push("The final question is missing [[END QUESTION]].");if(!result.items.length)result.errors.push("No complete [[QUESTION]] blocks were found.");return result;
}
function attachSource(parsed,source){
  parsed.sourcePackage=source||null;const seen=new Set();
  for(const q of parsed.items){
    const fail=s=>parsed.errors.push(`Question ${q.number}: ${s}`);
    if(q.sourceId){
      if(!source){fail("The original quiz data is missing. Use the original editable DOCX without copying its questions into another document.");continue;}
      const old=source.items.find(o=>o.id===q.sourceId);if(!old){fail("Source ID does not belong to this quiz.");continue;}if(seen.has(q.sourceId))fail("Source ID is duplicated; remove Source ID when creating a new question.");seen.add(q.sourceId);
      q.original=old;q.sourceXml=old.sourceXml;q.id=old.id;
      if(q.type!==old.type){fail("Keep the original Type for imported questions. Add a new question to change its type.");continue;}
      if(q.choices.length!==old.choices.length){fail("Keep the number of choices in an imported question to preserve its scoring. Add a new question for a different choice layout.");continue;}
      const map=new Map(q.choices.map((c,i)=>[c.id,old.choices[i].id]));q.choices.forEach((c,i)=>c.id=old.choices[i].id);
      if(q.sequence)q.sequence=q.sequence.map(id=>map.get(id));
      if(q.groups.length!==(old.groups||[]).length){fail("Keep the number of imported prompts/categories to preserve their scoring.");continue;}
      q.groups.forEach((g,i)=>{g.id=old.groups[i].id;g.optionIds=old.groups[i].optionIds;g.correctIds=g.correctIds.map(id=>map.get(id));if(g.correctIds.some(id=>!g.optionIds.includes(id)))fail("An answer is not among that prompt/category's original choices.");});
      if(q.numericPreserve)q.numericRules=old.numericRules;
    }else if(q.numericPreserve)fail("Preserve original rules requires a Source ID and the original quiz data.");
  }
  if(!parsed.errors.length)for(const q of parsed.items)if(q.original){try{patchedSourceItem(q);}catch(e){parsed.errors.push(e.message);}}
}
function numericalProcessing(rules,response="response1"){
  const rid=escapeXml(response),terms=rules.map(r=>r.kind==="exact"?`<varequal respident="${rid}">${escapeXml(r.value)}</varequal>`:`<and><${r.minInclusive?"vargte":"vargt"} respident="${rid}">${escapeXml(r.min)}</${r.minInclusive?"vargte":"vargt"}><${r.maxInclusive?"varlte":"varlt"} respident="${rid}">${escapeXml(r.max)}</${r.maxInclusive?"varlte":"varlt"}></and>`);
  return `<resprocessing><outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes><respcondition continue="No"><conditionvar>${terms.length>1?"<or>"+terms.join("")+"</or>":terms[0]||""}</conditionvar><setvar action="Set" varname="SCORE">100</setvar></respcondition></resprocessing>`;
}
function advancedItemXml(q){
  const type={ordering:"ordering_question",numerical:"numerical_question",categorization:"categorization_question",matching:"matching_question"}[q.type],id=q.id||uid();
  const material=s=>`<material><mattext texttype="text/plain">${escapeXml(s)}</mattext></material>`,labels=choices=>choices.map(c=>`<response_label ident="${escapeXml(c.id)}">${material(c.text)}</response_label>`).join("");
  let presentation=`<presentation><material><mattext texttype="text/html">${escapeXml(q.stemHtml)}</mattext></material>`,processing="";
  if(q.type==="numerical"){
    presentation+='<response_str ident="response1" rcardinality="Single"><render_fib fibtype="Decimal"><response_label ident="answer1"/></render_fib></response_str>';processing=numericalProcessing(q.numericRules);
  }else if(q.type==="ordering"){
    presentation+=`<response_lid ident="response1" rcardinality="Ordered"><render_extension><ims_render_object shuffle="No"><flow_label>${labels(q.choices)}</flow_label></ims_render_object></render_extension></response_lid>`;
    processing=`<resprocessing><outcomes><decvar defaultval="1" varname="ORDERSCORE" vartype="Integer"/></outcomes><respcondition continue="No"><conditionvar>${q.sequence.map(id=>`<varequal respident="response1">${escapeXml(id)}</varequal>`).join("")}</conditionvar><setvar action="Set" varname="SCORE">100</setvar></respcondition></resprocessing>`;
  }else{
    for(const g of q.groups)presentation+=`<response_lid ident="${escapeXml(g.id)}" rcardinality="${q.type==="categorization"?"Multiple":"Single"}">${material(g.label)}<render_choice>${labels(q.choices)}</render_choice></response_lid>`;
    processing=`<resprocessing><outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>${q.groups.map(g=>`<respcondition><conditionvar>${g.correctIds.map(id=>`<varequal respident="${escapeXml(g.id)}">${escapeXml(id)}</varequal>`).join("")}</conditionvar><setvar action="Add" varname="SCORE">${100/q.groups.length}</setvar></respcondition>`).join("")}</resprocessing>`;
  }
  const feedback=q.feedback?`<itemfeedback ident="general_fb"><flow_mat>${material(q.feedback)}</flow_mat></itemfeedback>`:"";
  return `<item ident="${escapeXml(id)}" title="${escapeXml(q.title)}">${qtiMetadata(type,q.points,q.choices.map(c=>c.id).join(","))}${presentation}</presentation>${processing}${feedback}</item>`;
}
function keySignature(q){
  return JSON.stringify({choices:q.choices.map(c=>!!c.correct),sequence:q.sequence||[],groups:(q.groups||[]).map(g=>g.correctIds),numerical:q.numericRules||[],answers:q.answers||[]});
}
function comparableText(s){return String(s||"").split("\n").map(l=>l.trim()).join("\n").replace(/\n{3,}/g,"\n\n").trim();}
function patchedSourceItem(q){
  const old=q.original,doc=parseXml(old.sourceXml),item=doc.documentElement;
  const add=xml=>parseXml(`<root xmlns="${item.namespaceURI}">${xml}</root>`).documentElement.firstElementChild;
  if(q.title.trim()!==old.title.trim())item.setAttribute("title",q.title);
  const pointField=descendants(item,"qtimetadatafield").find(f=>text(first(f,"fieldlabel"))==="points_possible");if(pointField&&q.points!==old.points)first(pointField,"fieldentry").textContent=String(q.points);
  if(comparableText(q.stem)!==comparableText(old.stem)){const presentation=first(item,"presentation"),m=localChildren(presentation,"material")[0];if(!m)throw new Error(`Question ${q.number}: missing source stem.`);first(m,"mattext").textContent=escapeHtml(q.stem).replace(/\n/g,"<br>");}
  const byId=new Map(q.choices.map(c=>[c.id,c]));
  for(const label of descendants(item,"response_label")){const c=byId.get(label.getAttribute("ident"));if(c&&comparableText(c.text)!==comparableText(old.choices.find(o=>o.id===c.id)?.text)){const mt=first(label,"mattext");if(!mt)throw new Error(`Question ${q.number}: option text could not be updated.`);mt.setAttribute("texttype","text/plain");mt.textContent=c.text;}}
  for(const g of q.groups||[]){const oldGroup=old.groups.find(o=>o.id===g.id);if(g.label!==oldGroup.label){const response=descendants(item,"response_lid").find(r=>r.getAttribute("ident")===g.id);first(localChildren(response,"material")[0],"mattext").textContent=g.label;}}
  if(keySignature(q)!==keySignature(old)){
    if(q.type==="matching"||q.type==="categorization"||q.type==="ordering"){
      const keys=q.type==="ordering"?[{id:descendants(item,"response_lid")[0].getAttribute("ident"),correctIds:q.sequence}]:q.groups;
      for(const g of keys){const cs=positiveConditions(item).filter(c=>descendants(c,"varequal").some(v=>v.getAttribute("respident")===g.id));if(cs.length!==1||descendants(cs[0],"varequal").some(v=>v.getAttribute("respident")!==g.id)||descendants(cs[0],"not").length)throw new Error(`Question ${q.number}: this scoring rule needs a manual key edit in Canvas.`);const cv=first(cs[0],"conditionvar");cv.replaceChildren(...g.correctIds.map(id=>add(`<varequal respident="${escapeXml(g.id)}">${escapeXml(id)}</varequal>`)));}
    }else{
      // Rebuild only the answer conditions when a key is edited. Original
      // scoring is retained byte-for-byte when answers have not changed.
      if(descendants(item,"displayfeedback").length)throw new Error(`Question ${q.number}: changing the key would affect conditional feedback. Edit that key in Canvas.`);
      if(q.type==="numerical"&&old.numericUnknown)throw new Error(`Question ${q.number}: edit this nonstandard numerical scoring rule in Canvas.`);
      const generated=parseXml(`<root xmlns="${item.namespaceURI}">${q.type==="numerical"?numericalProcessing(q.numericRules,first(item,"response_str").getAttribute("ident")):itemXml(q)}</root>`),rp=first(generated,"resprocessing");const prior=first(item,"resprocessing");if(prior)prior.replaceWith(rp);else item.append(rp);
    }
  }
  if(stripHtml(q.feedback)!==stripHtml(old.feedback)){let fb=first(item,"itemfeedback");if(!fb){fb=add('<itemfeedback ident="general_fb"><flow_mat><material><mattext texttype="text/plain"/></material></flow_mat></itemfeedback>');item.append(fb);}first(fb,"mattext").textContent=q.feedback;}
  return item;
}
async function rebuildSourceQti(title,items,source){
  const zip=await JSZip.loadAsync(await source.zip.generateAsync({type:"uint8array"})),doc=parseXml(await zip.file(source.assessmentPath).async("string")),assessment=first(doc,"assessment"),existing=descendants(assessment,"item"),selected=new Map(items.filter(q=>q.original).map(q=>[q.id,q]));
  assessment.setAttribute("title",title);
  const parents=new Set(existing.map(n=>n.parentElement));
  if(parents.size===1){const parent=existing[0].parentElement;for(const n of existing)n.remove();for(const q of items)parent.append(q.original?patchedSourceItem(q):parseXml(`<root xmlns="${assessment.namespaceURI}">${itemXml(q)}</root>`).documentElement.firstElementChild);}
  else{
    const originalOrder=existing.map(n=>n.getAttribute("ident")).filter(id=>selected.has(id)),wordOrder=items.filter(q=>q.original).map(q=>q.id);if(JSON.stringify(originalOrder)!==JSON.stringify(wordOrder))throw new Error("Reordering questions across exported groups requires review in Canvas.");
    for(const node of existing){const q=selected.get(node.getAttribute("ident"));if(!q)node.remove();else node.replaceWith(patchedSourceItem(q));}
    const section=first(assessment,"section")||assessment;for(const q of items.filter(q=>!q.original))section.append(parseXml(`<root xmlns="${assessment.namespaceURI}">${itemXml(q)}</root>`).documentElement.firstElementChild);
  }
  zip.file(source.assessmentPath,new XMLSerializer().serializeToString(doc));
  const total=items.reduce((n,q)=>n+q.points,0),originalTotal=source.items.reduce((n,q)=>n+q.points,0);
  for(const [path,entry] of Object.entries(zip.files))if(path.endsWith("/assessment_meta.xml")){const raw=await entry.async("string"),repaired=repairCanvasMetadata(raw);if(title===source.title&&total===originalTotal&&repaired===raw)continue;const meta=parseXml(repaired),t=first(meta,"title"),p=first(meta,"points_possible");if(t&&title!==source.title)t.textContent=title;if(p&&total!==originalTotal)p.textContent=String(total);zip.file(path,new XMLSerializer().serializeToString(meta));}
  return zip.generateAsync({type:"blob",mimeType:"application/zip",compression:"DEFLATE"});
}
function repairCanvasMetadata(xml){const hasLocation=/\bxsi:schemaLocation\s*=/.test(xml);return xml.replace(/\bxmlns:xsi=(["'])(https?:\/\/canvas\.instructure\.com\/xsd\/cccv1p0)\s+(https?:\/\/canvas\.instructure\.com\/xsd\/cccv1p0\.xsd)\1/g,(_,quote,ns,schema)=>`xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"${hasLocation?"":` xsi:schemaLocation="${ns} ${schema}"`}`);}

// These worked examples belong to the authoring template, never to an
// instructor's imported quiz. Guide paragraphs stay outside the question blocks.
function templateExamples(){
  const examples=[
    {type:"text_only",templateLabel:"Directions",title:"Practice quiz directions",points:0,stem:"Read each question carefully. For questions with more than one correct answer, select every correct option.",feedback:""},
    {type:"multiple_choice",title:"Word file format",stem:"Which file extension identifies a Microsoft Word document?",choices:[{text:".docx",correct:true},{text:".xlsx"},{text:".pptx"},{text:".csv"}],feedback:"A Word document uses the .docx file extension."},
    {type:"multiple_answer",title:"Even numbers",points:2,stem:"Select every even number.",choices:[{text:"2",correct:true},{text:"3"},{text:"4",correct:true},{text:"7"}],feedback:"Both 2 and 4 are even numbers."},
    {type:"true_false",title:"Triangle sides",stem:"A triangle has three sides.",choices:[{text:"True",correct:true},{text:"False"}],feedback:"A triangle has three sides."},
    {type:"short_answer",title:"Days of the week",stem:"Which day comes after Monday?",answers:["Tuesday","Tue","Tues"],feedback:"Tuesday follows Monday."},
    {type:"essay",title:"Practical application",points:5,stem:"Describe one way you could apply a skill from this course in your work. Explain why that application would be useful.",feedback:"Support your response with a specific example."},
    {type:"ordering",title:"Publishing sequence",points:3,stem:"Place these actions in order from first to last. Use every action.",choices:[{text:"Publish the final version"},{text:"Draft the initial version"},{text:"Review and revise the draft"}],orderIndexes:[1,2,0],feedback:"Draft first, review and revise second, and publish last."},
    {type:"numerical",templateLabel:"Numerical exact answer",title:"Time conversion",stem:"How many minutes are in two hours? Enter a number only.",numericRules:[{kind:"exact",value:"120"}],feedback:"Two hours equals 120 minutes."},
    {type:"numerical",templateLabel:"Numerical answer range",title:"Decimal calculation",stem:"Calculate 10 divided by 3. Give your answer to two decimal places.",numericRules:[{kind:"range",min:"3.32",max:"3.34",minInclusive:true,maxInclusive:true}],feedback:"The example key accepts values from 3.32 through 3.34, including both limits."},
    {type:"matching",title:"Matching shapes",points:3,stem:"Match each description with its shape. Write one choice letter for each description. One choice will be unused.",choices:[{text:"Triangle"},{text:"Square"},{text:"Circle"}],groupSpecs:[{label:"Four equal sides and four right angles",indexes:[1]},{label:"Three sides",indexes:[0]}],feedback:"A square has four equal sides and four right angles. A triangle has three sides."},
    {type:"categorization",title:"Animal groups",points:3,stem:"Place each mammal or bird in its correct category. Leave animals that belong to neither category unused.",choices:[{text:"Dolphin"},{text:"Eagle"},{text:"Frog"},{text:"Bat"},{text:"Sparrow"}],groupSpecs:[{label:"Mammals",indexes:[0,3]},{label:"Birds",indexes:[1,4]}],feedback:"Dolphins and bats are mammals. Eagles and sparrows are birds. The frog is unused."}
  ];
  return examples.map((entry,i)=>{
    const q={number:i+1,id:`example_${i+1}`,points:1,choices:[],groups:[],answers:[],feedback:"",supported:true,...entry};
    q.choices=q.choices.map((c,j)=>({correct:false,...c,id:`example_${i+1}_choice_${j+1}`}));
    if(q.orderIndexes)q.sequence=q.orderIndexes.map(n=>q.choices[n].id);
    if(q.groupSpecs)q.groups=q.groupSpecs.map((g,j)=>({id:`example_${i+1}_response_${j+1}`,label:g.label,optionIds:q.choices.map(c=>c.id),correctIds:g.indexes.map(n=>q.choices[n].id)}));
    return q;
  });
}
function templateIntroduction(){
  const p=s=>paragraphXml(s),heading=s=>paragraphXml(s,"",'<w:pStyle w:val="Heading1"/>');
  return [
    p("Version 1.3.1  |  Instructor template with worked answers"),
    p("Use this document to create a quiz for QTI Word Studio. It includes 11 worked examples covering all 10 supported item types, with both exact and range-based numerical answers."),
    heading("How to Use This Template"),
    p("1. Copy a complete example that matches the item you want to write, including its [[QUESTION]] and [[END QUESTION]] markers. Replace the example text and answers with your own. Delete examples you do not need."),
    p("2. Keep each field label and the Type value exactly as shown. Put question text after Stem. Use zero or a positive number for Points. Feedback is optional; its label can remain with nothing after it."),
    p("3. For multiple choice, multiple answer, and True/False, put an asterisk immediately before each correct choice letter, such as *b. Correct answer. Use consecutive choice letters. The other item types use the answer fields shown in their examples."),
    p("4. Save as a Word DOCX, choose Word to QTI in the tool, and upload the file. Fix any validation errors. Download the QTI ZIP, import it into an unpublished Canvas sandbox, and check the questions in Build and Student Preview."),
    p("The headings and how-to notes before each question block are guidance only; they are not imported into the quiz. Copy, edit, or remove them as needed. Content inside the markers is imported, including Feedback."),
    p("To revise an existing Canvas quiz while retaining its original settings, use that quiz's editable re-upload file from QTI to Word. This worked-example template creates new items.")
  ];
}
function templateTip(q){return {
  text_only:"Directions use Type: Directions and Points: 0. They provide information and have no answer key.",
  multiple_choice:"Star exactly one answer. Keep the choice labels consecutive: a., b., c., and so on.",
  multiple_answer:"Star every correct answer. At least one answer must be starred. Write a stem that tells students to select all that apply.",
  true_false:"Use exactly two choices and star the correct one. Keep the Type value True/False.",
  short_answer:"List accepted answers after Answer. Separate alternatives with a vertical bar (|). Do not use starred choice lines.",
  essay:"No answer field or choices are needed. Set the points and provide the prompt. The instructor grades the response.",
  ordering:"Keep Choices in a mixed display order. Correct order lists their letters from first to last; every letter must appear exactly once.",
  numerical:q.numericRules?.[0]?.kind==="exact"?"Use Exact followed by an accepted number. Keep units in the Stem, not the answer value. Add another Exact line to accept an alternative number.":"Use Range: minimum | maximum. Both limits are included by default. For an exclusive lower limit, use Range: minimum | maximum | exclusive | inclusive. The example uses a small acceptance range around the expected result.",
  matching:"List all answer choices, then numbered Prompts. Under Matches, pair each prompt number with one choice letter, such as 1 = b. Extra choices may remain unused.",
  categorization:"List the choices and numbered Categories. Under Assignments, list the correct choice letters for each category, such as 1 = a, d. Explain in the Stem whether unused choices are allowed. Do not star category choices."
}[q.type]||"";}
async function makeTemplateDocx(){return makeDocx("QTI Word Studio Question Types Template",templateExamples(),"editable",true);}
