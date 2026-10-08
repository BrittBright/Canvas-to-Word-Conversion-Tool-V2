(function(){
  'use strict';
  const $=id=>document.getElementById(id), CW=window.CanvasWord;
  const plural=type=>({Quiz:'Quizzes',Syllabus:'Syllabi'}[type]||type+'s');
  const state={course:null,selected:new Set(),active:null,models:new Map(),open:new Map(),busy:false,previewRequest:0,lastReport:''};
  const options=()=>({answerKey:$('quiz-mode').value==='key'});
  const announce=s=>{$('live').textContent=s;};
  function showError(e){$('error').textContent=e.message||String(e);$('error').hidden=false;}
  function filteredItems(){const query=$('search').value.toLocaleLowerCase().trim(),type=$('type').value;return state.course.items.filter(i=>(!type||i.type===type)&&(!query||i.title.toLocaleLowerCase().includes(query)));}
  function updateSelection(){
    const n=state.selected.size; $('selected-count').textContent=`${n} item${n===1?'':'s'} selected`;
    $('download-hint').textContent=n===1?'One editable Word document.':n>1?'Separate Word files, organized in a ZIP.':'Select materials to download.';
    $('export').disabled=!n||state.busy;$('export').textContent=state.busy?'Converting…':n===1?'Download Word file':'Download ZIP';
    $('include-files').disabled=n<2||state.busy;
  }
  function renderOutline(){
    if(!state.course)return;
    const focused=document.activeElement,focusRow=focused?.closest('.item-row'),focusModule=focused?.closest('.module');
    const restore=focused&&$('outline').contains(focused)?{item:focusRow?.dataset.itemId,module:focusModule?.dataset.moduleId,checkbox:focused.tagName==='INPUT'}:null;
    const visible=filteredItems(),ids=new Set(visible.map(i=>i.id)),seen=new Set();
    const groups=state.course.modules.map(m=>({...m,items:m.items.filter(id=>ids.has(id)&&!seen.has(id)&&seen.add(id))})).filter(m=>m.items.length);
    const remaining=visible.filter(i=>!seen.has(i.id));
    for(const type of ['Syllabus','Page','Assignment','Discussion','Quiz','Announcement','Link','External tool']){
      const items=remaining.filter(i=>i.type===type);if(items.length)groups.push({id:'outside-'+type,title:type==='Announcement'?'Announcements':'Other '+(type==='Syllabus'?'course information':type.toLowerCase()+'s'),items:items.map(i=>i.id)});
    }
    $('visible-count').textContent=`${visible.length} item${visible.length===1?'':'s'}`;
    const frag=document.createDocumentFragment();
    for(const m of groups){
      const container=document.createElement('section');container.className='module';container.dataset.moduleId=m.id;
      const head=document.createElement('div');head.className='module-heading';
      const check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label',`Select all items in ${m.title}`);
      const num=m.items.filter(id=>state.selected.has(id)).length;check.checked=num===m.items.length;check.indeterminate=num>0&&num<m.items.length;
      check.addEventListener('change',()=>{for(const id of m.items)check.checked?state.selected.add(id):state.selected.delete(id);renderOutline();updateSelection();});
      const expand=document.createElement('button');expand.type='button';expand.className='module-button';
      const expanded=state.open.has(m.id)?state.open.get(m.id):true;expand.setAttribute('aria-expanded',String(expanded));
      const panelId='module-'+groups.indexOf(m);expand.setAttribute('aria-controls',panelId);
      const arrow=document.createElement('span');arrow.className='chevron';arrow.textContent=expanded?'▾':'▸';arrow.setAttribute('aria-hidden','true');
      const title=document.createElement('span');title.textContent=m.title;expand.append(arrow,title);
      const count=document.createElement('span');count.className='module-count';count.textContent=m.items.length;
      const list=document.createElement('div');list.id=panelId;list.hidden=!expanded;
      expand.addEventListener('click',()=>{state.open.set(m.id,!expanded);list.hidden=expanded;expand.setAttribute('aria-expanded',String(!expanded));arrow.textContent=expanded?'▸':'▾';});
      head.append(check,expand,count);container.append(head,list);
      for(const id of m.items){const item=state.course.byId.get(id),row=document.createElement('div');row.className='item-row'+(state.active===id?' active':'');row.dataset.itemId=id;
        const choice=document.createElement('input');choice.type='checkbox';choice.checked=state.selected.has(id);choice.setAttribute('aria-label',`Export ${item.title}`);
        choice.addEventListener('change',()=>{choice.checked?state.selected.add(id):state.selected.delete(id);updateSelection();const checks=m.items.filter(x=>state.selected.has(x)).length;check.checked=checks===m.items.length;check.indeterminate=checks>0&&checks<m.items.length;});
        const button=document.createElement('button');button.className='item-button';button.type='button';button.setAttribute('aria-label',`Preview ${item.title}`);
        const name=document.createElement('span');name.className='item-name';name.textContent=item.title;
        const tags=document.createElement('span');tags.className='item-tags';const kind=document.createElement('span');kind.className='item-kind';kind.textContent=item.type;tags.append(kind);
        if(!item.published){const draft=document.createElement('span');draft.className='draft';draft.textContent='Unpublished';tags.append(draft);}
        if(item.type==='Quiz'){const qty=document.createElement('span');qty.className='item-kind';qty.textContent=`${item.questions.filter(q=>q.type!=='text_only_question').length} questions`;tags.append(qty);}
        if(['Link','External tool'].includes(item.type)){const note=document.createElement('span');note.className='item-note';note.textContent='Online resource';tags.append(note);}
        button.append(name,tags);button.addEventListener('click',()=>previewItem(item));row.append(choice,button);list.append(row);
      }frag.append(container);
    }
    const oldTop=$('outline').scrollTop;$('outline').replaceChildren(frag);$('outline').scrollTop=oldTop;
    if(!groups.length){const p=document.createElement('p');p.className='empty-filter';p.textContent='No items match these filters.';$('outline').append(p);}
    if(restore){const selector=restore.item?'.item-row':'.module',key=restore.item?'itemId':'moduleId',id=restore.item||restore.module;
      const row=[...$('outline').querySelectorAll(selector)].find(x=>x.dataset[key]===id);
      const target=row?.querySelector(restore.checkbox?'input':'button');target?.focus({preventScroll:true});}
  }
  async function load(file){
    if(!file||state.busy)return;state.busy=true;$('error').hidden=true;$('result').hidden=true;$('loading').hidden=false;$('start').hidden=true;$('workspace').hidden=true;
    try{
      const course=await new CW.Cartridge().open(file);state.course?.close();state.course=course;state.selected.clear();state.active=null;state.models.clear();state.open.clear();state.previewRequest++;
      $('course-title').textContent=course.title;
      const counts={};for(const i of course.items)counts[i.type]=(counts[i.type]||0)+1;
      $('course-meta').textContent=[Object.entries(counts).map(([t,n])=>`${n} ${(n===1?t:plural(t)).toLowerCase()}`).join(' · '),course.exportDate?`Exported ${course.exportDate}`:''].filter(Boolean).join(' | ');
      $('type').replaceChildren(new Option('All types',''));for(const type of Object.keys(counts).sort())$('type').add(new Option(`${plural(type)} (${counts[type]})`,type));
      $('search').value='';$('preview').hidden=true;$('preview-empty').hidden=false;$('preview-loading').hidden=true;$('review').hidden=true;$('preview-type').hidden=true;
      $('workspace').hidden=false;renderOutline();announce(`Loaded ${course.items.length} items from ${course.title}.`);
    }catch(e){showError(e);$('start').hidden=false;}
    finally{state.busy=false;$('loading').hidden=true;updateSelection();}
  }
  async function getModel(item){const key=item.id+'|'+$('quiz-mode').value;if(!state.models.has(key))state.models.set(key,new CW.ContentModel(state.course,item,options()).prepare());return state.models.get(key);}
  async function previewItem(item){
    state.active=item.id;const request=++state.previewRequest;renderOutline();$('preview-empty').hidden=true;$('preview').hidden=true;$('review').hidden=true;$('preview-loading').hidden=false;
    $('preview-type').textContent=item.type;$('preview-type').hidden=false;
    try{const model=await getModel(item);if(request!==state.previewRequest)return;
      $('preview').srcdoc=CW.previewHtml(model);$('preview').hidden=false;$('preview-loading').hidden=true;
      const issues=model.issues;$('review').hidden=!issues.length;$('review-summary').textContent=`${issues.length} item${issues.length===1?'':'s'} to check`;
      $('review-list').replaceChildren(...issues.map(x=>{const li=document.createElement('li');li.textContent=x.message;return li;}));
      announce(`Preview ready for ${item.title}${issues.length?`. ${issues.length} items to check.`:'.'}`);
    }catch(e){if(request===state.previewRequest){$('preview-loading').hidden=true;showError(e);}}
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function setBusy(b){state.busy=b;for(const id of ['replace','quiz-mode','search','type','select-visible','clear'])$(id).disabled=b;
    for(const n of $('outline').querySelectorAll('input,button'))n.disabled=b;updateSelection();}
  async function exportSelected(){
    if(!state.selected.size||state.busy)return;setBusy(true);$('error').hidden=true;$('result').hidden=true;$('export-progress').hidden=false;
    const items=state.course.items.filter(i=>state.selected.has(i.id)).sort((a,b)=>{
      const ma=a.memberships[0],mb=b.memberships[0];return (ma?.position||999)-(mb?.position||999)||(ma?.itemPosition||0)-(mb?.itemPosition||0)||a.title.localeCompare(b.title);
    });
    const results=[],zip=new JSZip(),files=new Set(),usedNames=new Set();let successes=0;
    try{
      for(let index=0;index<items.length;index++){
        const item=items[index];$('progress-text').textContent=`Converting ${index+1} of ${items.length}: ${item.title}`;$('progress').value=Math.round(100*index/items.length);
        await new Promise(r=>requestAnimationFrame(r));
        let path=CW.exportPath(item),suffix=2;while(usedNames.has(path))path=CW.exportPath(item).replace(/\.docx$/,` (${suffix++}).docx`);usedNames.add(path);
        try{const model=await getModel(item),blob=await CW.toDocx(model);for(const f of model.attachments)files.add(f);
          results.push({path,issues:model.issues,imageCount:model.imageCount});successes++;
          if(items.length===1)download(blob,CW.safeName(item.title)+($('quiz-mode').value==='key'&&item.type==='Quiz'?' - Answer key':'')+'.docx');else zip.file(path,blob);
        }catch(e){results.push({path,issues:[],error:e.message||String(e)});}
      }
      if(!successes)throw new Error('No Word files could be generated. See the conversion report for the failed items.');
      const report=CW.reportText(state.course,results);state.lastReport=report;
      if(items.length>1){
        if($('include-files').checked)for(const path of files){const original=state.course.zip.file(path);if(original)zip.file('Files/'+path.replace(/^web_resources\//,''),await original.async('uint8array'));}
        zip.file('Conversion report.txt',report);
        $('progress-text').textContent='Packaging the Word files…';download(await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}}),CW.safeName(state.course.title)+' - Word files.zip');
      }
      $('progress').value=100;const issueCount=results.reduce((n,r)=>n+r.issues.length+(r.error?1:0),0);
      $('result').replaceChildren(document.createTextNode(`${successes} Word file${successes===1?'':'s'} downloaded.${issueCount?` ${issueCount} conversion notes to review.`:' No conversion issues detected.'}`));
      const reportButton=document.createElement('button');reportButton.type='button';reportButton.textContent='Download conversion report';reportButton.addEventListener('click',()=>download(new Blob([state.lastReport],{type:'text/plain;charset=utf-8'}),'Conversion report.txt'));$('result').append(reportButton);$('result').hidden=false;
      announce(`${successes} Word files downloaded.`);
    }catch(e){showError(e);state.lastReport=CW.reportText(state.course,results);}
    finally{setBusy(false);$('export-progress').hidden=true;}
  }
  $('file').addEventListener('change',e=>load(e.target.files[0]));$('replace').addEventListener('click',()=>{$('file').value='';$('file').click();});
  $('search').addEventListener('input',renderOutline);$('type').addEventListener('change',renderOutline);
  $('select-visible').addEventListener('click',()=>{for(const i of filteredItems())state.selected.add(i.id);renderOutline();updateSelection();announce(`${state.selected.size} items selected.`);});
  $('clear').addEventListener('click',()=>{state.selected.clear();renderOutline();updateSelection();announce('Selection cleared.');});
  $('quiz-mode').addEventListener('change',()=>{if(state.active)previewItem(state.course.byId.get(state.active));});$('export').addEventListener('click',exportSelected);
  $('dropzone').addEventListener('dragover',e=>{e.preventDefault();$('dropzone').classList.add('dragover');});$('dropzone').addEventListener('dragleave',()=>$('dropzone').classList.remove('dragover'));
  $('dropzone').addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('dragover');load(e.dataTransfer.files[0]);});
  window.CanvasWordApp={state,load,getModel,exportSelected,previewItem};
})();
