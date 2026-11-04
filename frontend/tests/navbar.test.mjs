import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function fixture(options={}){
 const calls=[];
 const properties=[{id:'a',name:'First Property'},{id:'b',name:'Second Property'}];
 const stubs={
  '../context/AuthContext':{useAuth:()=>({user:{name:'Test Manager',role:'PROPERTY_MANAGER'},logout:()=>calls.push('logout'),signingOut:options.signingOut??false})},
  '../context/PropertyContext':{useProperty:()=>({activeProperty:properties[0],properties,canSwitchProperty:options.canSwitch??true,setActiveProperty:p=>calls.push(p.id)})},
  '../context/ThemeContext':{useTheme:()=>({theme:'dark',toggleTheme:()=>calls.push('theme')})},
  '../context/NavigationContext':{useNavigation:()=>({requestNavigation:action=>{calls.push('guard');action();}})},
  './SubNav':{navLabels:{'new-bill':'New bill'}},
 };
 const source=readFileSync(new URL('../src/components/Navbar.tsx',import.meta.url),'utf8').replaceAll('import.meta.env.VITE_DEPLOYMENT_MODE',JSON.stringify(options.mode??'live'));
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',js)(name=>name in stubs?stubs[name]:require(name),module,module.exports);
 const tree=module.exports.Navbar({currentTab:'new-bill',onMenu:()=>calls.push('menu'),onSecurity:()=>calls.push('security'),onShortcuts:()=>calls.push('shortcuts')});
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
