/* Canvas to Word prototype. All cartridge content stays in this browser. */
(function () {
  'use strict';
  const local = n => n?.localName || n?.nodeName;
  const children = (n, name) => [...(n?.children || [])].filter(x => local(x) === name);
  const all = (n, name) => [...(n?.getElementsByTagName('*') || [])].filter(x => local(x) === name);
  const child = (n, name) => children(n, name)[0];
  const value = (n, name) => child(n, name)?.textContent || '';
  function normalizeCanvasXml(source) {
    // These quiz exports put the schema-location pair in xmlns:xsi. Chrome's
    // strict XML parser rejects the space in that namespace URI. Repair only
    // this exact Canvas declaration on the quiz root, preserving its content.
    return String(source).replace(/<quiz\b[^>]*>/, tag => tag.replace(
      /\bxmlns:xsi\s*=\s*(["'])\s*https?:\/\/canvas\.instructure\.com\/xsd\/cccv1p0\s+https?:\/\/canvas\.instructure\.com\/xsd\/cccv1p0\.xsd\s*\1/g,
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
    ));
  }
  const xml = (s, filename='XML metadata') => {
    const d = new DOMParser().parseFromString(normalizeCanvasXml(s), 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error(`The export file “${filename}” could not be read as XML. Share this filename when reporting the error.`);
    return d;
  };
  const html = s => new DOMParser().parseFromString(s || '', 'text/html');
  const plain = s => html(s).body.textContent.replace(/\s+/g, ' ').trim();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeName = s => String(s || 'Untitled').normalize('NFKC').replace(/[\x00-\x1f<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').slice(0, 130) || 'Untitled';
  const dirname = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
  const cleanPath = p => {
    let decoded; try { decoded = decodeURIComponent(p); } catch { decoded = p; }
    const pieces = [];
    for (const part of decoded.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') pieces.pop(); else pieces.push(part);
    }
    return pieces.join('/');
  };
  const safeUrl = s => /^(https?:|mailto:)/i.test(s || '') ? s : '';
  const issuesKey = x => `${x.kind}|${x.message}`;
  const uniqueIssues = xs => [...new Map(xs.map(x => [issuesKey(x), x])).values()];

  class Cartridge {
    constructor() {
      this.items = []; this.byId = new Map(); this.byPath = new Map(); this.modules = [];
      this.resources = new Map(); this.objectUrls = []; this.imageCache = new Map();
      this.title = ''; this.exportDate = ''; this.sourceOrigin = ''; this.filename = '';
    }
    async open(file) {
      this.filename = file.name || 'course-export.imscc';
      if (file.size > 250 * 1024 * 1024) throw new Error('This prototype supports exports up to 250 MB. Please try a smaller course export.');
      try { this.zip = await JSZip.loadAsync(file); } catch { throw new Error('This file is not a readable Canvas course export. Choose an .imscc file exported from Course Settings.'); }
      const files = Object.values(this.zip.files);
      if (files.length > 50000 || files.reduce((n, f) => n + (f._data?.uncompressedSize || 0), 0) > 512 * 1024 * 1024) {
        throw new Error('This export is too large to unpack safely in this prototype. Try a smaller export.');
      }
      for (const f of files) {
        if ((f.unsafeOriginalName || f.name).split('/').some(x => x === '..')) throw new Error('The export contains an unsafe file path.');
      }
      if (!this.zip.file('imsmanifest.xml')) throw new Error('No course manifest was found. Choose a Canvas course export (.imscc), rather than a quiz or submissions ZIP.');
      const manifest = xml(await this.text('imsmanifest.xml'), 'imsmanifest.xml');
      const root = manifest.documentElement;
      const metadata = child(root, 'metadata');
      this.title = all(metadata, 'title')[0]?.textContent.trim() || this.filename;
      this.exportDate = all(metadata, 'dateTime')[0]?.textContent || '';
      for (const r of children(child(root, 'resources'), 'resource')) {
        this.resources.set(r.getAttribute('identifier'), {
          id: r.getAttribute('identifier'), type: r.getAttribute('type') || '',
          paths: children(r, 'file').map(f => cleanPath(f.getAttribute('href') || '')),
          dependencies: children(r, 'dependency').map(d => d.getAttribute('identifierref')),
        });
      }
      const topicMeta = new Map();
      for (const f of files.filter(x => !x.dir && !x.name.includes('/') && x.name.endsWith('.xml') && x.name !== 'imsmanifest.xml')) {
        const d = xml(await f.async('string'), f.name);
        if (local(d.documentElement) === 'topicMeta') topicMeta.set(value(d.documentElement, 'topic_id'), d.documentElement);
      }
      const settingsFile = this.zip.file('course_settings/course_settings.xml');
      if (settingsFile) {
        const settings = xml(await settingsFile.async('string'), settingsFile.name).documentElement;
        this.title = value(settings, 'title') || this.title;
        this.timeZone = value(settings, 'time_zone') || 'America/New_York';
      }
      for (const f of files.filter(x => !x.dir && /^wiki_content\/.*\.html?$/i.test(x.name))) {
        const content = await f.async('string'), doc = html(content);
        const id = doc.querySelector('meta[name="identifier"]')?.content || [...this.resources.values()].find(r => r.paths.includes(f.name))?.id || f.name;
        this.add({id, type: 'Page', title: doc.title || f.name, path: f.name, html: doc.body.innerHTML,
          published: doc.querySelector('meta[name="workflow_state"]')?.content !== 'unpublished'});
      }
      for (const f of files.filter(x => !x.dir && /(^|\/)assignment_settings\.xml$/.test(x.name))) {
        const d = xml(await f.async('string'), f.name).documentElement;
        const folder = dirname(f.name), id = d.getAttribute('identifier') || folder.slice(0, -1);
        const bodyFile = files.find(x => !x.dir && x.name.startsWith(folder) && /\.html?$/i.test(x.name));
        let content = bodyFile ? html(await bodyFile.async('string')).body.innerHTML : value(d, 'description');
        this.add({id, type: 'Assignment', title: value(d, 'title') || id, path: bodyFile?.name || f.name, html: content,
          points: value(d, 'points_possible'), due: value(d, 'due_at'), dueDate: value(d, 'all_day_date'),
          submissionTypes: value(d, 'submission_types'), published: !['unpublished','deleted'].includes(value(d,'workflow_state')),
          rubric: child(d,'rubric') ? this.parseRubric(child(d,'rubric')) : null});
      }
      for (const r of this.resources.values()) {
        const path = r.paths.find(p => this.zip.file(p));
        if (!path) continue;
        if (r.type.includes('imsdt_')) {
          const d = xml(await this.text(path), path).documentElement, meta = topicMeta.get(r.id);
          this.add({id:r.id, type: value(meta,'type') === 'announcement' ? 'Announcement' : 'Discussion',
            title:value(d,'title') || r.id, path, html:value(d,'text'),
            published: !['unpublished','deleted'].includes(value(meta,'workflow_state'))});
        } else if (r.type.includes('imsqti_') && r.type.includes('assessment')) {
          const folder = dirname(path), metaFile = this.zip.file(folder + 'assessment_meta.xml');
          const meta = metaFile ? xml(await metaFile.async('string'), metaFile.name).documentElement : null;
          const full = this.zip.file(`non_cc_assessments/${r.id}.xml.qti`);
          const d = xml(await (full || this.zip.file(path)).async('string'), full?.name || path);
          const assessment = all(d,'assessment')[0];
          const questions = all(assessment,'item').map(q => this.parseQuestion(q));
          const banks = all(assessment,'sourcebank_ref');
          this.add({id:r.id, type:'Quiz', title:value(meta,'title') || assessment?.getAttribute('title') || r.id,
            path:full?.name || path, html:value(meta,'description'), questions, banks: banks.length,
            points:value(meta,'points_possible'), due:value(meta,'due_at'), published:value(meta,'workflow_state') !== 'unpublished'});
        } else if (r.type.includes('imswl_')) {
          const d = xml(await this.text(path), path).documentElement;
          const url = all(d,'url')[0]?.getAttribute('href') || all(d,'url')[0]?.textContent || '';
          this.add({id:r.id,type:'Link',title:value(d,'title') || url || r.id,path,url,
            html:`<p><a href="${esc(safeUrl(url))}">${esc(url)}</a></p><p>This resource is an external website. Its content is not included in the course export.</p>`,published:true});
        }
      }
      if (this.zip.file('course_settings/syllabus.html')) {
        const source = await this.text('course_settings/syllabus.html');
        if (plain(source)) this.add({id:'$syllabus',type:'Syllabus',title:'Course Syllabus',path:'course_settings/syllabus.html',html:html(source).body.innerHTML,published:true});
      }
      // Prefer Canvas module metadata, which preserves item type, ordering, and publication state.
      if (this.zip.file('course_settings/module_meta.xml')) {
        const d = xml(await this.text('course_settings/module_meta.xml'), 'course_settings/module_meta.xml');
        for (const m of all(d,'module')) {
          const mod = {id:m.getAttribute('identifier'),title:value(m,'title'),position:Number(value(m,'position')) || this.modules.length+1,items:[],sections:[]};
          for (const mi of children(child(m,'items'),'item')) {
            const ref = value(mi,'identifierref'), item = this.byId.get(ref);
            if (item) {
              mod.items.push(item.id);
              item.memberships.push({id:mod.id,title:mod.title,position:mod.position,itemPosition:Number(value(mi,'position')) || mod.items.length});
              // The displayed module title can differ from the saved page/quiz title.
              if (item.memberships.length === 1 && value(mi,'title')) item.title = value(mi,'title');
            } else if (value(mi,'content_type') === 'ContextModuleSubHeader') {
              mod.sections.push({title:value(mi,'title'),position:Number(value(mi,'position'))});
            } else if (value(mi,'content_type') === 'ExternalTool') {
              this.add({id:ref || mi.getAttribute('identifier'),type:'External tool',title:value(mi,'title'),path:'',
                html:'<p>This item opens an external tool. Its activity is not included in this course export.</p>',published:true});
              const added=this.items[this.items.length-1]; mod.items.push(added.id);
              added.memberships.push({id:mod.id,title:mod.title,position:mod.position,itemPosition:Number(value(mi,'position'))});
            }
          }
          this.modules.push(mod);
        }
        this.modules.sort((a,b)=>a.position-b.position);
      } else {
        const org=all(manifest,'organization')[0], container=children(org,'item')[0];
        for(const m of children(container,'item')) {
          const mod={id:m.getAttribute('identifier'),title:value(m,'title'),position:this.modules.length+1,items:[]};
          for(const mi of all(m,'item')) {
            const item=this.byId.get(mi.getAttribute('identifierref'));
            if(item){mod.items.push(item.id);item.memberships.push({id:mod.id,title:mod.title,position:mod.position,itemPosition:mod.items.length});}
          }
          this.modules.push(mod);
        }
      }
      for (const item of this.items) {
        const origin = (item.html || '').match(/https:\/\/[^/"\s]+\/api\/v1\/courses\//)?.[0];
        if(origin){this.sourceOrigin=new URL(origin).origin;break;}
      }
      if(!this.items.length) throw new Error('This export contains no supported pages, assignments, discussions, or quizzes.');
      return this;
    }
    add(item) {
      if(this.byId.has(item.id)) return;
      item.memberships=[];item.issues=[];this.items.push(item);this.byId.set(item.id,item);if(item.path)this.byPath.set(item.path,item);
    }
    async text(path) {return this.zip.file(path)?.async('string') || '';}
    parseRubric(d) {
      return all(d,'criterion').map(c=>({title:value(c,'description'),description:value(c,'long_description'),points:value(c,'points'),
        ratings:all(c,'rating').map(r=>({title:value(r,'description'),description:value(r,'long_description'),points:value(r,'points')}))}));
    }
    parseQuestion(q) {
      const meta={};
      for(const f of all(q,'qtimetadatafield')) meta[value(f,'fieldlabel')]=value(f,'fieldentry');
      const presentation=child(q,'presentation');
      const prompt=children(presentation,'material').map(m=>all(m,'mattext').map(t=>t.textContent).join('')).join('');
      const choices=all(presentation,'response_label').map(r=>({id:r.getAttribute('ident'),html:all(r,'mattext').map(x=>x.textContent).join('')}));
      const correct=[];
      for(const rc of all(q,'respcondition')) {
        const score=all(rc,'setvar').find(s=>/score/i.test(s.getAttribute('varname')||'') && Number(s.textContent)>0);
        if(!score)continue;
        for(const v of all(child(rc,'conditionvar'),'varequal')){
          let negated=false;for(let p=v.parentElement;p&&p!==rc;p=p.parentElement)if(local(p)==='not'){negated=true;break;}
          if(!negated&&!correct.includes(v.textContent))correct.push(v.textContent);
        }
      }
      return {id:q.getAttribute('ident'),title:q.getAttribute('title')||'',type:meta.question_type || (choices.length?'multiple_choice_question':'unknown'),
        points:meta.points_possible,html:prompt,choices,correct};
    }
    resolve(src, sourcePath='') {
      const raw=(src || '').trim();
      const noQuery=raw.split(/[?#]/)[0];
      let candidates=[];
      if(raw.startsWith('$IMS-CC-FILEBASE$/')) {
        const relative=cleanPath(noQuery.slice('$IMS-CC-FILEBASE$/'.length));
        candidates=['web_resources/'+relative,relative];
      } else if (/^\$(?:CANVAS_OBJECT_REFERENCE|WIKI_REFERENCE)\$\//.test(raw)) {
        const id=raw.split('/').pop().split(/[?#]/)[0], item=this.byId.get(id), mod=this.modules.find(x=>x.id===id);
        return item ? {kind:'item',item} : mod ? {kind:'module',module:mod} : {kind:'internal',src:raw};
      } else if(raw.startsWith('$CANVAS_COURSE_REFERENCE$')) return {kind:'internal',src:raw};
      else if(/^(https?:|mailto:)/i.test(raw)) return {kind:'external',src:raw};
      else if(raw.startsWith('data:image/'))return {kind:'data',src:raw};
      else if(raw.startsWith('#'))return {kind:'anchor',src:raw};
      else if(/^(javascript:|vbscript:|file:|data:)/i.test(raw))return {kind:'unsafe',src:''};
      else candidates=[cleanPath(dirname(sourcePath)+noQuery),cleanPath(noQuery),cleanPath('web_resources/'+noQuery)];
      const path=candidates.find(p=>this.zip.file(p));
      if(path) return this.byPath.has(path) ? {kind:'item',item:this.byPath.get(path)} : {kind:'file',path};
      return {kind:'missing',src:raw};
    }
    async image(ref) {
      const key=ref.path || ref.src;
      if(this.imageCache.has(key))return this.imageCache.get(key);
      const promise=(async()=>{
        let blob;
        if(ref.kind==='file')blob=await this.zip.file(ref.path).async('blob');
        else if(ref.kind==='data') { const data=ref.src.split(','); const isB64=/;base64/i.test(data[0]);
          const s=isB64?atob(data[1]):decodeURIComponent(data.slice(1).join(','));
          blob=new Blob([Uint8Array.from(s,c=>c.charCodeAt(0))]);
        } else throw new Error('Image not included');
        const buffer=new Uint8Array(await blob.arrayBuffer());
        const sig=[...buffer.slice(0,12)];
        let mime=sig[0]===137&&sig[1]===80?'image/png':sig[0]===255&&sig[1]===216?'image/jpeg':String.fromCharCode(...sig.slice(0,3))==='GIF'?'image/gif':String.fromCharCode(...sig.slice(8,12))==='WEBP'?'image/webp':'image/svg+xml';
        // Never place raw SVG into the output or preview; rasterize only after checking it is an image.
        if(mime==='image/svg+xml'&&!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(new TextDecoder().decode(buffer.slice(0,400))))throw new Error('Unsupported image format');
        const inputUrl=URL.createObjectURL(new Blob([buffer],{type:mime}));this.objectUrls.push(inputUrl);
        const img=new Image();img.src=inputUrl;await img.decode();
        const max=2200,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        const output=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!output)throw new Error('The browser could not prepare this image');
        const url=URL.createObjectURL(output);this.objectUrls.push(url);
        return {data:new Uint8Array(await output.arrayBuffer()),width:canvas.width,height:canvas.height,url,mime:'png',animated:mime==='image/gif'};
      })();this.imageCache.set(key,promise);return promise;
    }
    close(){for(const url of this.objectUrls)URL.revokeObjectURL(url);this.objectUrls=[];}
  }

  const blockTags=new Set(['P','DIV','SECTION','ARTICLE','HEADER','FOOTER','MAIN','ASIDE','UL','OL','LI','TABLE','BLOCKQUOTE','PRE','H1','H2','H3','H4','H5','H6','DETAILS','SUMMARY','FIGURE','FIGCAPTION','HR']);
  const ignoredTags=new Set(['SCRIPT','STYLE','NOSCRIPT','FORM','INPUT','BUTTON','NAV']);
  class ContentModel {
    constructor(course,item,options={}){this.course=course;this.item=item;this.options=options;this.blocks=[];this.issues=[];this.attachments=new Set();this.imageCount=0;this.headingBase=2;this.qno=0;}
    issue(kind,message){this.issues.push({kind,message});}
    async prepare(){
      await this.appendHtml(this.item.html);
      if(this.item.type==='Quiz') {
        if(!this.item.questions.length)this.issue('review','Quiz questions are not present in this export. The document contains the quiz directions only.');
        if(this.item.banks)this.issue('review','This quiz references a question bank. The export may not include every question used by Canvas.');
        for(const q of this.item.questions)await this.question(q);
      }
      if(this.item.type==='Link')this.issue('online','The linked website is not included in the export.');
      if(this.item.type==='External tool')this.issue('online','The activity opens an external tool and is not included in the export.');
      if(this.item.type==='Assignment'&&/external_tool/.test(this.item.submissionTypes))this.issue('online','This assignment uses an external tool. Only the saved directions can be converted.');
      if(this.item.rubric?.length){this.blocks.push({kind:'heading',level:1,inlines:[{text:'Rubric'}]});
        for(const c of this.item.rubric){this.blocks.push({kind:'heading',level:2,inlines:[{text:c.title}]});this.blocks.push({kind:'paragraph',inlines:[{text:[c.description,c.points?`${c.points} points`:''].filter(Boolean).join(' — ')}]});
          for(const r of c.ratings)this.blocks.push({kind:'paragraph',inlines:[{text:`${r.title} (${r.points} points): ${r.description}`} ]});}}
      this.issues=uniqueIssues(this.issues);return this;
    }
    omit(n){if(n.nodeType!==1)return false;return ignoredTags.has(n.tagName)||n.getAttribute('aria-hidden')==='true'||n.classList.contains('dp-header-pre')||n.classList.contains('dp-icon')||n.classList.contains('dp-icon-content');}
    async appendHtml(source){
      const doc=html(source), headings=[...doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(x=>!x.closest('header.dp-header'));
      this.headingBase=headings.length?Math.min(...headings.map(x=>Number(x.tagName.slice(1)))):2;
      await this.walk(doc.body,this.blocks);
    }
    async inline(n,style={}){
      if(n.nodeType===3)return [{text:n.textContent.replace(/\s+/g,' '),...style}];
      if(n.nodeType!==1||this.omit(n))return [];
      if(n.tagName==='BR')return [{break:true}];
      if(n.tagName==='IMG')return [{image:await this.imageBlock(n)}];
      if(['IFRAME','VIDEO','AUDIO','OBJECT','EMBED'].includes(n.tagName)){
        const url=safeUrl(n.getAttribute('src')||n.getAttribute('data')||n.querySelector('source')?.getAttribute('src')||'');
        const label=n.getAttribute('title')||'Embedded online content';
        this.issue('online',`${label} requires access to the original online content.`);
        return [{text:`[Online content: ${label}]${url?' '+url:''}`,...style}];
      }
      const s={...style};if(['STRONG','B'].includes(n.tagName))s.bold=true;if(['EM','I'].includes(n.tagName))s.italic=true;
      if(n.tagName==='U')s.underline=true;if(['S','DEL'].includes(n.tagName))s.strike=true;
      if(n.tagName==='CODE')s.code=true;if(n.tagName==='SUP')s.sup=true;if(n.tagName==='SUB')s.sub=true;
      if(n.tagName==='A'){
        const ref=this.course.resolve(n.getAttribute('href'),this.item.path), label=n.textContent.trim();
        if(ref.kind==='external'){s.link=ref.src;if(!/^mailto:/i.test(ref.src))this.issue('online',`External link: ${label || ref.src}`);}
        else if(ref.kind==='file'){this.attachments.add(ref.path);s.localFile=ref.path;}
        else if(ref.kind==='item'){s.reference=ref.item.title;s.itemId=ref.item.id;this.issue('reference',`Canvas item link points to “${ref.item.title}”. Export that item as well if it is needed.`);}
        else if(ref.kind==='module'){s.reference=ref.module.title;this.issue('reference',`Canvas module link points to “${ref.module.title}”.`);}
        else if(['internal','missing'].includes(ref.kind))this.issue('review',`A Canvas or missing link could not be resolved: ${label || ref.src}`);
      }
      let out=[];for(const c of n.childNodes)out.push(...await this.inline(c,s));return out;
    }
    async imageBlock(n){
      const src=n.getAttribute('src')||'',alt=n.getAttribute('alt')||'',decorative=n.getAttribute('role')==='presentation'&&n.hasAttribute('alt')&&!alt;
      const ref=this.course.resolve(src,this.item.path);const label=alt || (ref.path?ref.path.split('/').pop():'Image');
      if(!alt)this.issue('accessibility',decorative?`Image “${label}” is marked decorative in Canvas. Confirm that it does not carry instructional information.`:`Image “${label}” has no alt text.`);
      try {
        const image=await this.course.image(ref);this.imageCount++;
        if(image.animated)this.issue('review',`Animated image “${label}” is represented by a still image in Word.`);
        const rawWidth=(n.style.width || n.getAttribute('width') || '').trim();
        const widthHint=/^\d+(?:\.\d+)?(?:px)?$/i.test(rawWidth)?parseFloat(rawWidth):0;
        const widthPercent=/^\d+(?:\.\d+)?%$/.test(rawWidth)?Math.min(100,Math.max(1,parseFloat(rawWidth))):0;
        return {kind:'image',...image,alt,decorative,label,widthHint,widthPercent};
      } catch {
        const url=safeUrl(src);this.issue(ref.kind==='external'?'online':'review',`Image “${label}” could not be embedded${ref.kind==='external'?' because it is hosted outside this export':''}.`);
        return {kind:'placeholder',text:`Image not included: ${label}`,url};
      }
    }
    async paragraph(n,target,extra={}){
      const inlines=[];for(const c of n.childNodes)inlines.push(...await this.inline(c));
      this.emitInlines(inlines,target,extra);
    }
    emitInlines(inlines,target,extra={}){
      let buffer=[];
      const flush=()=>{if(buffer.some(x=>x.text?.trim()||x.break))target.push({kind:'paragraph',inlines:buffer,...extra});buffer=[];};
      for(const run of inlines){if(run.image){flush();target.push(run.image);}else buffer.push(run);}flush();
    }
    async walk(n,target,list=null){
      if(this.omit(n))return;
      if(n.nodeType===3){if(n.textContent.trim())target.push({kind:'paragraph',inlines:await this.inline(n)});return;}
      if(n.nodeType!==1)return;
      const tag=n.tagName;
      if(tag==='HEADER'&&n.classList.contains('dp-header'))return;
      if(['IFRAME','VIDEO','AUDIO','OBJECT','EMBED'].includes(tag)){
        const src=n.getAttribute('src')||n.getAttribute('data')||n.querySelector('source')?.src||'',url=safeUrl(src);
        const label=n.getAttribute('title')|| (tag==='IFRAME'?'Embedded activity':tag.toLowerCase());
        this.issue('online',`${label} requires access to the original online content.`);
        target.push({kind:'placeholder',text:`Online content: ${label}`,url});return;
      }
      if(tag==='IMG'){target.push(await this.imageBlock(n));return;}
      if(/^H[1-6]$/.test(tag)||tag==='SUMMARY'){
        const inlines=[];for(const c of n.childNodes)inlines.push(...await this.inline(c));
        if(inlines.some(x=>x.text?.trim()))target.push({kind:'heading',level:tag==='SUMMARY'?2:Math.max(1,Math.min(6,Number(tag.slice(1))-this.headingBase+1)),inlines});return;
      }
      if(tag==='TABLE'){
        const rows=[...n.rows],grid=[],pending=[];let maxCols=0;
        for(const row of rows){let c=0;const g=[];
          for(const cell of row.cells){while(pending[c]>0){g[c]={merged:true};pending[c]--;c++;}
            const span=Math.max(1,cell.colSpan),rs=Math.max(1,cell.rowSpan),blocks=[];await this.walk(cell,blocks);
            g[c]={blocks,colspan:span,rowspan:rs,header:cell.tagName==='TH'};
            for(let j=1;j<span;j++)g[c+j]={merged:true};if(rs>1)for(let j=0;j<span;j++)pending[c+j]=rs-1;c+=span;
          }
          while(pending[c]>0){g[c]={merged:true};pending[c]--;c++;}maxCols=Math.max(maxCols,g.length);grid.push(g);
        }
        const first=[...(rows[0]?.cells||[])];const widths=first.map(c=>parseFloat(c.style.width||c.getAttribute('width')||''));
        const caption=n.querySelector(':scope > caption')?.textContent.trim();
        if(!rows.some(r=>[...r.cells].some(c=>c.tagName==='TH')))this.issue('accessibility','A table has no marked header cells. Check its headings in Word.');
        target.push({kind:'table',rows:grid,colCount:maxCols,widths,caption});return;
      }
      if(tag==='UL'||tag==='OL'){
        const depth=(list?.depth ?? -1)+1,kind=tag==='OL'?'ordered':'bullet',ref=`list-${ContentModel.sequence++}`,start=Number(n.getAttribute('start'))||1;
        let number=start;
        for(const li of [...n.children].filter(x=>x.tagName==='LI')){
          const temp=[];await this.walkContainer(li,temp,{depth,kind,ref,start,number});
          const first=temp.find(x=>x.kind==='paragraph');if(first)first.list={depth,kind,ref,start,number};
          target.push(...temp);number++;
        }return;
      }
      if(tag==='PRE'){target.push({kind:'code',text:n.textContent});return;}
      if(tag==='HR')return;
      if(tag==='P'||tag==='FIGCAPTION') {await this.paragraph(n,target,{caption:tag==='FIGCAPTION'});return;}
      if(tag==='BLOCKQUOTE'){const temp=[];await this.walkContainer(n,temp,list);for(const b of temp)b.quote=true;target.push(...temp);return;}
      await this.walkContainer(n,target,list);
    }
    async walkContainer(n,target,list){
      let pending=[];
      const flush=async()=>{let runs=[];for(const x of pending)runs.push(...await this.inline(x));this.emitInlines(runs,target);pending=[];};
      for(const c of n.childNodes){
        if(c.nodeType===1&&(blockTags.has(c.tagName)||['IFRAME','VIDEO','AUDIO','OBJECT','EMBED','IMG'].includes(c.tagName))){await flush();await this.walk(c,target,list);}
        else pending.push(c);
      }await flush();
    }
    async question(q){
      if(q.type==='text_only_question'){await this.appendHtml(q.html);return;}
      const start=this.blocks.length;
      this.qno++;this.blocks.push({kind:'heading',level:1,inlines:[{text:`Question ${this.qno}${q.points?` (${Number(q.points)} points)`:''}`}]});
      await this.appendHtml(q.html);
      for(let i=0;i<q.choices.length;i++){
        const letters=`${String.fromCharCode(65+i)}. `, source=html(q.choices[i].html).body, inlines=[];
        for(const c of source.childNodes)inlines.push(...await this.inline(c));
        this.emitInlines([{text:letters},...inlines],this.blocks);
      }
      const supported=['multiple_choice_question','multiple_answers_question','true_false_question','essay_question','short_answer_question','fill_in_multiple_blanks_question','numerical_question','matching_question','multiple_dropdowns_question','calculated_question'];
      if(!supported.includes(q.type))this.issue('review',`Question ${this.qno} uses an unrecognized question type (${q.type}). Review the result.`);
      if(['matching_question','multiple_dropdowns_question','fill_in_multiple_blanks_question','calculated_question','numerical_question'].includes(q.type))this.issue('review',`Question ${this.qno} (${q.type.replaceAll('_',' ')}) needs instructor review; interactive scoring is not reproduced.`);
      if(q.type==='multiple_answers_question')this.blocks.push({kind:'paragraph',inlines:[{text:'Select all that apply.',italic:true}]});
      if(!q.choices.length||q.type==='essay_question'){
        this.blocks.push({kind:'paragraph',inlines:[{text:'Response:',bold:true}]});
        if(!this.options.answerKey)for(let i=0;i<(q.type==='essay_question'?3:1);i++)this.blocks.push({kind:'space'});
      }
      if(this.options.answerKey){
        if(q.type==='essay_question')this.blocks.push({kind:'paragraph',inlines:[{text:'Answer key: Instructor evaluation required.',bold:true}]});
        else if(q.correct.length){
          const answers=q.correct.map(id=>{const i=q.choices.findIndex(c=>c.id===id);return i>=0?`${String.fromCharCode(65+i)}. ${plain(q.choices[i].html)}`:id;});
          this.blocks.push({kind:'paragraph',inlines:[{text:`Correct response: ${answers.join('; ')}`,bold:true}]});
        } else {this.blocks.push({kind:'paragraph',inlines:[{text:'Answer key: No verified answer could be extracted.',italic:true}]});this.issue('review',`No answer key could be extracted for question ${this.qno}.`);}
      }
      for(let i=start;i<this.blocks.length;i++){this.blocks[i].question=true;this.blocks[i].keepNext=i<this.blocks.length-1;}
    }
  }
  ContentModel.sequence=1;

  const doclib=()=>{if(!window.docx)throw new Error('The Word generator did not load. Reload the tool and try again.');return window.docx;};
  function metaLine(course,item){const parts=[item.type,course.title];if(item.points!==undefined&&item.points!=='')parts.push(`${Number(item.points)} points`);
    if(item.dueDate)parts.push(`Original due date: ${item.dueDate}`);else if(item.due){
      const zone=course.timeZone||'UTC',date=new Date(item.due);
      try{parts.push(`Original due date: ${new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:zone}).format(date)} (${zone})`);}
      catch{parts.push(`Original due date: ${item.due}`);}
    }return parts.join(' · ');}
  async function toDocx(model){
    const d=doclib();const numbering=new Map();const notes=model.issues;
    const makeRuns=(inlines)=>{
      const runs=[];
      for(const i of inlines || []){
        if(i.break){runs.push(new d.TextRun({break:1}));continue;}
        const opts={text:i.text || '',bold:i.bold,italics:i.italic,strike:i.strike,subScript:i.sub,superScript:i.sup,underline:i.underline?{}:undefined,font:i.code?'Consolas':undefined};
        if(i.link)runs.push(new d.ExternalHyperlink({link:i.link,children:[new d.TextRun({...opts,style:'Hyperlink'})]}));
        else if(i.localFile){runs.push(new d.TextRun(opts));runs.push(new d.TextRun({text:` [file reference: ${i.localFile.replace(/^web_resources\//,'')}]`,italics:true}));}
        else if(i.reference){runs.push(new d.TextRun(opts));if(i.text?.trim()!==i.reference)runs.push(new d.TextRun({text:` [${i.reference}]`,italics:true}));}
        else runs.push(new d.TextRun(opts));
      }return runs;
    };
    const makeBlock=(b,width=624)=>{
      if(b.kind==='heading')return [new d.Paragraph({heading:d.HeadingLevel[`HEADING_${Math.min(6,b.level)}`],children:makeRuns(b.inlines),keepNext:true})];
      if(b.kind==='paragraph'){
        let num;
        if(b.list){const l=b.list;if(!numbering.has(l.ref))numbering.set(l.ref,l);num={reference:l.ref,level:Math.min(l.depth,8)};}
        return [new d.Paragraph({children:makeRuns(b.inlines),numbering:num,
          style:b.caption?'Caption':undefined,indent:b.quote?{left:360}:undefined,keepNext:!!b.keepNext,keepLines:!!b.question,spacing:{after:120,line:288}})];
      }
      if(b.kind==='code')return [new d.Paragraph({children:b.text.split('\n').flatMap((x,i)=>[...(i?[new d.TextRun({break:1})]:[]),new d.TextRun({text:x,font:'Consolas',size:21})]),spacing:{after:140}})];
      if(b.kind==='space')return [new d.Paragraph({children:[new d.TextRun(' ')],keepNext:!!b.keepNext,spacing:{after:220}})];
      if(b.kind==='image'){
        const target=Math.min(width,b.widthPercent?width*b.widthPercent/100:b.widthHint||b.width,b.width),scale=Math.min(1,target/b.width,650/b.height);
        return [new d.Paragraph({children:[new d.ImageRun({type:'png',data:b.data,transformation:{width:Math.max(1,Math.round(b.width*scale)),height:Math.max(1,Math.round(b.height*scale))},altText:{title:'',description:b.alt || '',name:b.decorative?'Decorative image':b.label}})],spacing:{before:120,after:180},keepNext:!!b.keepNext})];
      }
      if(b.kind==='placeholder')return [new d.Paragraph({children:[new d.TextRun({text:`[${b.text}]`,italics:true}),...(b.url?[new d.TextRun(' '),new d.ExternalHyperlink({link:b.url,children:[new d.TextRun({text:b.url,style:'Hyperlink'})]})]:[])],keepNext:!!b.keepNext,keepLines:!!b.question,spacing:{after:140}})];
      if(b.kind==='table'){
        const total=Math.round(width*15);let colWidths;
        if(b.widths.length===b.colCount&&b.widths.every(x=>Number.isFinite(x)&&x>0)){const sum=b.widths.reduce((a,x)=>a+x,0);colWidths=b.widths.map(x=>Math.round(total*x/sum));}
        else colWidths=Array.from({length:b.colCount},()=>Math.floor(total/b.colCount));
        const border={style:d.BorderStyle.SINGLE,size:4,color:'D9D9D9'};
        const rows=b.rows.map((r,ri)=>new d.TableRow({tableHeader:ri===0&&r.some(x=>x?.header),cantSplit:true,children:r.flatMap((c,ci)=>{
          if(c?.merged)return [];
          const contents=(c?.blocks || []).flatMap(x=>makeBlock(x,Math.max(70,((colWidths[ci]||total/b.colCount)*(c?.colspan||1))/15-18)));
          if(!contents.length||!(contents[contents.length-1] instanceof d.Paragraph))contents.push(new d.Paragraph(''));
          return [new d.TableCell({children:contents,width:{size:colWidths.slice(ci,ci+(c?.colspan||1)).reduce((a,x)=>a+x,0),type:d.WidthType.DXA},columnSpan:c?.colspan||1,rowSpan:c?.rowspan||1,
            shading:{fill:c?.header?'E8EDF2':ri%2?'F6F8FA':'FFFFFF'},verticalAlign:d.VerticalAlign.CENTER,
            margins:{top:90,bottom:90,left:100,right:100},borders:{top:border,bottom:border,left:border,right:border}})];
        })}));
        return [...(b.caption?[new d.Paragraph({style:'Caption',children:[new d.TextRun(b.caption)],keepNext:true})]:[]),new d.Table({rows,columnWidths:colWidths,width:{size:total,type:d.WidthType.DXA},layout:d.TableLayoutType.FIXED,borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border}}),new d.Paragraph({text:'',spacing:{after:80}})];
      }return [];
    };
    const content=[new d.Paragraph({heading:d.HeadingLevel.TITLE,children:[new d.TextRun(model.item.title)],spacing:{after:120}}),
      new d.Paragraph({style:'Metadata',children:[new d.TextRun(metaLine(model.course,model.item))],spacing:{after:260}}),...model.blocks.flatMap(b=>makeBlock(b))];
    if(model.options.answerKey&&model.item.type==='Quiz')content.splice(1,0,new d.Paragraph({children:[new d.TextRun({text:'INSTRUCTOR ANSWER KEY',bold:true})]}));
    const levels=l=>Array.from({length:9},(_,level)=>({level,format:l.kind==='ordered'?d.LevelFormat.DECIMAL:d.LevelFormat.BULLET,
      text:l.kind==='ordered'?`%${level+1}.`:'•',start:l.start||1,alignment:d.AlignmentType.START,style:{paragraph:{indent:{left:360*(level+1),hanging:240}}}}));
    const styleHead=(size,level)=>({run:{font:'Arial',size,bold:true,color:'000000'},paragraph:{spacing:{before:240,after:120},keepNext:true,outlineLevel:level}});
    const doc=new d.Document({creator:'Canvas to Word',title:model.item.title,description:'Course material converted from a Canvas course export',
      // Customize the built-in styles once; duplicate IDs can be renamed by Word.
      styles:{default:{document:{run:{font:'Arial',size:24,color:'000000',language:{value:'en-US'}},paragraph:{spacing:{after:120,line:288}}},
          title:{run:{font:'Arial',size:44,bold:true,color:'000000'},paragraph:{spacing:{after:180},keepNext:true}},
          heading1:styleHead(34,0),heading2:styleHead(30,1),heading3:styleHead(26,2),heading4:styleHead(24,3),heading5:styleHead(24,4),heading6:styleHead(24,5),
          hyperlink:{run:{color:'0563C1',underline:{type:d.UnderlineType.SINGLE}}}},
        paragraphStyles:[{id:'Metadata',name:'Metadata',basedOn:'Normal',run:{size:21,color:'333333'}},{id:'Caption',name:'Caption',basedOn:'Normal',run:{size:22,italics:true,color:'333333'}}]},
      numbering:{config:[...numbering].map(([reference,l])=>({reference,levels:levels(l)}))},
      sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:1080,bottom:1080,left:1440,right:1440}}},children:content}]});
    let blob=await d.Packer.toBlob(doc);
    // Word's decorative flag is separate from the image description; preserve the Canvas role.
    if(model.blocks.some(b=>b.kind==='image'&&b.decorative)){
      const archive=await JSZip.loadAsync(blob);let body=await archive.file('word/document.xml').async('string');
      body=body.replace(/<wp:docPr\b[^>]*name="Decorative image"[^>]*(?:\/>|>[^]*?<\/wp:docPr>)/g,match=>{
        const head=match.replace(/\/>$/,'>').replace(/<\/wp:docPr>$/,'');
        return head+'<a:extLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst></wp:docPr>';
      });archive.file('word/document.xml',body);blob=await archive.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    }
    return blob;
  }
  function previewHtml(model){
    const runs=xs=>(xs||[]).map(x=>{
      if(x.break)return '<br>';let text=esc(x.text);if(x.bold)text=`<strong>${text}</strong>`;if(x.italic)text=`<em>${text}</em>`;if(x.code)text=`<code>${text}</code>`;
      if(x.link)text=`<span class="link">${text}</span>`;return text;
    }).join('');
    const block=b=>b.kind==='heading'?`<h${Math.min(6,b.level+1)}>${runs(b.inlines)}</h${Math.min(6,b.level+1)}>`:
      b.kind==='paragraph'?`<p${b.list?' class="list-item"':''}>${b.list?esc(b.list.kind==='ordered'?`${b.list.number}. `:'• '):''}${runs(b.inlines)}</p>`:
      b.kind==='image'?`<img src="${esc(b.url)}" alt="${esc(b.alt)}" style="max-width:100%;width:${b.widthPercent?b.widthPercent+'%':Math.min(624,b.widthHint||b.width)+'px'}">`:
      b.kind==='placeholder'?`<p class="placeholder">${esc(b.text)}${b.url?`<br><small>${esc(b.url)}</small>`:''}</p>`:
      b.kind==='code'?`<pre>${esc(b.text)}</pre>`:b.kind==='space'?'<p class="response-space">&nbsp;</p>':
      b.kind==='table'?`${b.caption?`<p><em>${esc(b.caption)}</em></p>`:''}<table>${b.rows.map(row=>`<tr>${row.filter(c=>!c?.merged).map(c=>`<${c?.header?'th':'td'} colspan="${c?.colspan||1}" rowspan="${c?.rowspan||1}">${(c?.blocks||[]).map(block).join('')}</${c?.header?'th':'td'}>`).join('')}</tr>`).join('')}</table>`:'';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; style-src 'unsafe-inline';"><style>body{font:16px/1.5 Arial,sans-serif;color:#172638;background:#fff;margin:0;padding:28px;overflow-wrap:anywhere}h1{font-size:25px;line-height:1.25;margin:0 0 12px}h2{font-size:21px;margin:25px 0 9px}h3{font-size:18px;margin:20px 0 8px}h4,h5,h6{font-size:16px;margin:18px 0 8px}p{margin:0 0 12px}.meta{font-size:13px;color:#536171;border-bottom:1px solid #ddd;padding-bottom:16px;margin-bottom:20px}.link{color:#0563c1;text-decoration:underline}table{border-collapse:collapse;width:100%;margin:18px 0}td,th{border:1px solid #d9d9d9;padding:8px;text-align:left;vertical-align:top}th{background:#e8edf2}img{display:block;height:auto;margin:15px 0}pre{white-space:pre-wrap}.list-item{padding-left:12px}.placeholder{border-left:3px solid #9b6414;padding:8px 12px;background:#fff8e9}.placeholder small{font-size:12px}.response-space{height:25px}</style></head><body><h1>${esc(model.item.title)}</h1><p class="meta">${esc(metaLine(model.course,model.item))}</p>${model.options.answerKey&&model.item.type==='Quiz'?'<p><strong>INSTRUCTOR ANSWER KEY</strong></p>':''}${model.blocks.map(block).join('')}</body></html>`;
  }
  function exportPath(item){const m=item.memberships[0];let folder=m?`${String(m.position).padStart(2,'0')} ${safeName(m.title)}`:item.type==='Announcement'?'Announcements':item.type==='Syllabus'?'Course information':'Other course content';
    const prefix=m?`${String(m.itemPosition).padStart(2,'0')} `:'';return `${folder}/${prefix}${safeName(item.title)}.docx`;}
  function reportText(course,results){let text=`Canvas to Word conversion report\n\nCourse: ${course.title}\nOriginal export date: ${course.exportDate||'Not recorded'}\nConverted: ${new Date().toISOString()}\nItems: ${results.length}\n\nThis package contains course materials, not grades or student submissions. External tools, videos, and linked websites remain online resources. Review the documents before distributing them.\n\n`;
    for(const r of results){text+=`${r.path}\n`;text+=r.error?`  FAILED: ${r.error}\n`:r.issues.length?r.issues.map(x=>`  ${x.kind.toUpperCase()}: ${x.message}`).join('\n')+'\n':'  No conversion issues detected.\n';text+='\n';}return text;}
  window.CanvasWord={Cartridge,ContentModel,toDocx,previewHtml,exportPath,reportText,safeName,esc,plain,uniqueIssues,normalizeCanvasXml};
})();
