import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function loadSource(file,stubs={},options={}){
 const source=readFileSync(new URL(file,import.meta.url),'utf8')
  .replaceAll('import.meta.env.VITE_DEPLOYMENT_MODE',JSON.stringify(options.mode??'live'))
  .replaceAll('import.meta.env.BASE_URL',JSON.stringify('/'));
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',js)(name=>name in stubs?stubs[name]:require(name),module,module.exports);
 return module.exports;
}
const presentation=loadSource('../src/utils/propertyPresentation.ts');
function fixture(options={}){
 const calls=[];
 const properties=[{id:'a',name:options.propertyName??'First Property'},{id:'b',name:'Second Property'}];
 const stubs={
  '../context/AuthContext':{useAuth:()=>({user:{name:'Test Manager',role:options.role??'PROPERTY_MANAGER'},logout:()=>calls.push('logout'),signingOut:options.signingOut??false})},
  '../context/PropertyContext':{useProperty:()=>({activeProperty:properties[0],properties,canSwitchProperty:options.canSwitch??true,setActiveProperty:p=>calls.push(p.id)})},
  '../context/ThemeContext':{useTheme:()=>({theme:'dark',toggleTheme:()=>calls.push('theme')})},
  '../context/NavigationContext':{useNavigation:()=>({requestNavigation:action=>{calls.push('guard');action();}})},
  './SubNav':{navLabels:{'new-bill':'New bill'}},
  '../utils/propertyPresentation':presentation,
  '../features':{waterSportsEnabled:true},
  react:{...React,useEffect:()=>{},useRef:()=>({current:null})},
 };
 const component=options.sidebar?'SubNav':'Navbar';
 const exports=loadSource(`../src/components/${component}.tsx`,stubs,options);
 const tree=exports[component]({currentTab:options.currentTab??'new-bill',open:false,onClose:()=>calls.push('close'),onTabChange:tab=>calls.push(tab),onMenu:()=>calls.push('menu'),onSecurity:()=>calls.push('security'),onShortcuts:()=>calls.push('shortcuts'),catalogue:options.catalogue?{width:280,onResize:width=>calls.push(['resize',width])}:undefined});
 return{tree,calls};
}
const nodes=node=>Array.isArray(node)?node.flatMap(nodes):!React.isValidElement(node)?[]:[node,...nodes(node.props.children)];
const byLabel=(tree,label)=>nodes(tree).find(node=>node.props['aria-label']===label);
test('navbar workspace actions invoke their existing callbacks in live and testing',()=>{
 for(const mode of ['live','testing']){
  const f=fixture({mode});
  byLabel(f.tree,'Open navigation').props.onClick();
  byLabel(f.tree,'Keyboard shortcuts').props.onClick();
  byLabel(f.tree,mode==='testing'?'Manage authenticator in live version':'Personal authenticator').props.onClick();
  byLabel(f.tree,'Switch to light theme').props.onClick();
  assert.deepEqual(f.calls,['menu','shortcuts','security','theme']);
 }
});
test('catalogue sidebar replaces navigation and supports bounded pointer and keyboard resizing',()=>{
 const f=fixture({sidebar:true,propertyName:'Siyam World',catalogue:true});
 assert.ok(nodes(f.tree).some(node=>node.props.id==='bill-catalogue-sidebar'));
 assert.equal(nodes(f.tree).some(node=>node.props.className==='sidebar-links'),false);
 const handle=byLabel(f.tree,'Resize catalogue');
 assert.equal(handle.props.role,'separator');
 let captured=false;
 const target={setPointerCapture(){captured=true;},hasPointerCapture(){return captured;},releasePointerCapture(){captured=false;}};
 handle.props.onPointerDown({button:0,clientX:280,pointerId:1,currentTarget:target,preventDefault(){}});
 handle.props.onPointerMove({clientX:380,pointerId:1,currentTarget:target});
 assert.deepEqual(f.calls.at(-1),['resize',380]);
 handle.props.onPointerMove({clientX:900,pointerId:1,currentTarget:target});
 assert.deepEqual(f.calls.at(-1),['resize',480]);
 handle.props.onPointerMove({clientX:0,pointerId:1,currentTarget:target});
 assert.deepEqual(f.calls.at(-1),['resize',220]);
 handle.props.onPointerUp({pointerId:1,currentTarget:target});
 const count=f.calls.length;
 handle.props.onPointerMove({clientX:400,pointerId:1,currentTarget:target});
 assert.equal(f.calls.length,count);
 for(const [key,width] of [['ArrowRight',300],['ArrowLeft',260],['Home',220],['End',480]]){
  handle.props.onKeyDown({key,preventDefault(){}});assert.deepEqual(f.calls.at(-1),['resize',width]);
 }
 handle.props.onDoubleClick();assert.deepEqual(f.calls.at(-1),['resize',280]);
});
test('property switching and logout retain the unsaved-work guard',()=>{
 const f=fixture();const select=byLabel(f.tree,'Active property');
 select.props.onChange({target:{value:'a'}});assert.deepEqual(f.calls,[]);
 select.props.onChange({target:{value:'b'}});assert.deepEqual(f.calls,['guard','b']);
 byLabel(f.tree,'Sign out').props.onClick();assert.deepEqual(f.calls,['guard','b','guard','logout']);
});
test('property selection and sign-out retain their disabled states',()=>{
 assert.equal(byLabel(fixture({canSwitch:false}).tree,'Active property').props.disabled,true);
 assert.equal(byLabel(fixture({signingOut:true}).tree,'Sign out').props.disabled,true);
});
test('Siyam Bills has a navbar slot for the result count and date range',()=>{
 const siyam=fixture({propertyName:'Siyam World',currentTab:'bills'});
 assert.ok(nodes(siyam.tree).some(node=>node.props.id==='bills-header-summary'));
 const other=fixture({propertyName:'Iru Fushi',currentTab:'bills'});
 assert.equal(nodes(other.tree).some(node=>node.props.id==='bills-header-summary'),false);
});
test('Siyam World header keeps theme and guarded sign-out without profile or extra actions',()=>{
 for(const propertyName of ['Siyam World','Sun Siyam World']){
  const f=fixture({propertyName});
  assert.equal(byLabel(f.tree,'Keyboard shortcuts'),undefined);
  assert.equal(byLabel(f.tree,'Personal authenticator'),undefined);
  assert.equal(nodes(f.tree).some(node=>/profile-copy|avatar/.test(node.props.className??'')),false);
  const actions=nodes(f.tree).find(node=>node.props.className?.includes('topbar-actions'));
  assert.deepEqual(nodes(actions).filter(node=>node.type==='button').map(node=>node.props['aria-label']),['Switch to light theme','Sign out']);
  byLabel(f.tree,'Switch to light theme').props.onClick();
  byLabel(f.tree,'Sign out').props.onClick();
  assert.deepEqual(f.calls,['theme','guard','logout']);
 }
});
test('Siyam World moves Administration to sidebar footer while preserving role access',()=>{
 for(const role of ['GLOBAL_ADMIN','PROPERTY_MANAGER','CENTRE_STAFF']){
  const f=fixture({sidebar:true,propertyName:'Siyam World',role,currentTab:'admin'});
  assert.equal(nodes(f.tree).some(node=>node.props.href?.startsWith('mailto:')),false);
  assert.equal(nodes(f.tree).some(node=>/sidebar-shortcuts|sidebar-signature/.test(node.props.className??'')),false);
  const admin=nodes(f.tree).filter(node=>node.type==='nav'&&node.props['aria-label']==='Administration');
  assert.equal(admin.length,role==='CENTRE_STAFF'?0:1);
  if(admin.length){
   const bottom=nodes(f.tree).find(node=>node.props.className==='sidebar-bottom');
   assert.ok(nodes(bottom).includes(admin[0]));
   const button=nodes(admin[0]).find(node=>node.type==='button');
   assert.equal(button.props['aria-current'],'page');
   button.props.onClick();
   assert.deepEqual(f.calls,['admin','close']);
  }
 }
 const other=fixture({sidebar:true,propertyName:'Sun Siyam Iru Fushi'});
 const bottom=nodes(other.tree).find(node=>node.props.className==='sidebar-bottom');
 assert.ok(nodes(bottom).some(node=>node.props.className==='sidebar-signature'));
 assert.equal(nodes(bottom).some(node=>node.type==='nav'),false);
 assert.equal(nodes(other.tree).filter(node=>node.type==='nav'&&node.props['aria-label']==='Administration').length,1);
});
