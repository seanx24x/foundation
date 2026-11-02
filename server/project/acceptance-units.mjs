import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import ts from 'typescript';
import {validateChangeSet,changeGroupDigest} from './proposals.mjs';
const copy=value=>structuredClone(value),hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const reasons={unsupported:'This proposal includes source outside the supported closed scalar ES-module analysis. Keep the whole proposal together.',unresolved:'A local source dependency is missing, ambiguous, or outside the disclosed context. Keep the whole proposal together.',effects:'Globals, side effects, mutation, or unsupported expressions prevent establishing separate source units. Keep the whole proposal together.',parse:'Source could not be parsed completely. Keep the whole proposal together.'};
export class AcceptanceUnitError extends Error{constructor(message='The acceptance scope no longer matches this proposal. Prepare its current source again.'){super(message);this.name='AcceptanceUnitError';this.code='invalid-acceptance';}}
const requireValue=(value,message)=>{if(!value)throw new AcceptanceUnitError(message);};
const scalarType=node=>!node||[ts.SyntaxKind.StringKeyword,ts.SyntaxKind.NumberKeyword,ts.SyntaxKind.BooleanKeyword,ts.SyntaxKind.VoidKeyword,ts.SyntaxKind.UndefinedKeyword,ts.SyntaxKind.NeverKeyword].includes(node.kind)||ts.isLiteralTypeNode(node)&&[ts.SyntaxKind.NullKeyword,ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.StringLiteral,ts.SyntaxKind.NumericLiteral].includes(node.literal.kind)||ts.isUnionTypeNode(node)&&node.types.every(scalarType);
/** Conservative syntax analysis. Absence of an import never certifies behavioral independence. */
function analyze(sources){
 const files=new Map(),edges=[],boundaries=new Set(),byName=new Map(sources.map(file=>[file.path,file]));
 const unknown=kind=>boundaries.add(reasons[kind]);
 for(const file of sources){
  if(!/\.(?:ts|js|mjs)$/.test(file.path)||/\.d\.ts$/.test(file.path)){unknown('unsupported');continue;}
  const parsed=ts.createSourceFile(file.path,file.source,ts.ScriptTarget.Latest,true,file.path.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
  let count=0,tooDeep=false;const walk=(node,depth)=>{if(++count>12000||depth>160){tooDeep=true;return;}ts.forEachChild(node,child=>walk(child,depth+1));};walk(parsed,0);
  if(parsed.parseDiagnostics.length||tooDeep){unknown('parse');continue;}
  if(!ts.isExternalModule(parsed)){unknown('effects');continue;}files.set(file.path,parsed);
 }
 const resolve=(from,specifier)=>{
  if(!specifier.startsWith('./')&&!specifier.startsWith('../')){unknown('unresolved');return null;}
  const target=posix.normalize(posix.join(posix.dirname(from),specifier));if(target.startsWith('../')||target.startsWith('/')){unknown('unresolved');return null;}
  const names=/\.[a-z]+$/i.test(target)?[target,...(/\.js$/.test(target)?[target.slice(0,-3)+'.ts']:[])]:[target,...['.ts','.js','.mjs','/index.ts','/index.js','/index.mjs'].map(ext=>target+ext)];
  const found=names.filter(name=>byName.has(name));if(found.length!==1){unknown('unresolved');return null;}return found[0];
 };
 const host={getSourceFile:name=>files.get(name),getDefaultLibFileName:()=>'',writeFile:()=>{},getCurrentDirectory:()=>'',getDirectories:()=>[],fileExists:name=>files.has(name),readFile:name=>byName.get(name)?.source,getCanonicalFileName:name=>name,useCaseSensitiveFileNames:()=>true,getNewLine:()=> '\n',resolveModuleNames:(names,containing)=>names.map(name=>{const resolved=resolve(containing,name);return resolved?{resolvedFileName:resolved,extension:resolved.endsWith('.ts')?ts.Extension.Ts:ts.Extension.Js}:undefined;})};
 const program=ts.createProgram([...files.keys()],{noLib:true,noResolve:false,allowJs:true,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext},host),checker=program.getTypeChecker();
 const symbol=node=>{let value=checker.getSymbolAtLocation(node);if(value?.flags&ts.SymbolFlags.Alias)value=checker.getAliasedSymbol(value);return value;};
 const local=node=>{const value=symbol(node);return !!value?.declarations?.length&&value.declarations.every(item=>files.has(item.getSourceFile().fileName));};
 const callable=node=>{const value=symbol(node);return !!value?.declarations?.length&&value.declarations.every(item=>files.has(item.getSourceFile().fileName)&&(ts.isFunctionDeclaration(item)||ts.isVariableDeclaration(item)&&item.initializer&&(ts.isArrowFunction(item.initializer)||ts.isFunctionExpression(item.initializer))));};
 const scalarExpression=node=>{
  if(!node)return true;
  if(ts.isStringLiteral(node)||ts.isNumericLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||[ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NullKeyword].includes(node.kind))return true;
  if(ts.isIdentifier(node))return ['undefined','NaN','Infinity'].includes(node.text)||local(node);
  if(ts.isParenthesizedExpression(node))return scalarExpression(node.expression);
  if(ts.isAsExpression(node)||ts.isTypeAssertionExpression(node))return scalarType(node.type)&&scalarExpression(node.expression);
  if(ts.isPrefixUnaryExpression(node))return [ts.SyntaxKind.PlusToken,ts.SyntaxKind.MinusToken,ts.SyntaxKind.ExclamationToken,ts.SyntaxKind.TildeToken].includes(node.operator)&&scalarExpression(node.operand);
  if(ts.isBinaryExpression(node))return [ts.SyntaxKind.PlusToken,ts.SyntaxKind.MinusToken,ts.SyntaxKind.AsteriskToken,ts.SyntaxKind.SlashToken,ts.SyntaxKind.PercentToken,ts.SyntaxKind.AsteriskAsteriskToken,ts.SyntaxKind.LessThanToken,ts.SyntaxKind.LessThanEqualsToken,ts.SyntaxKind.GreaterThanToken,ts.SyntaxKind.GreaterThanEqualsToken,ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken,ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken,ts.SyntaxKind.AmpersandToken,ts.SyntaxKind.BarToken,ts.SyntaxKind.CaretToken,ts.SyntaxKind.LessThanLessThanToken,ts.SyntaxKind.GreaterThanGreaterThanToken,ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken].includes(node.operatorToken.kind)&&scalarExpression(node.left)&&scalarExpression(node.right);
  if(ts.isConditionalExpression(node))return scalarExpression(node.condition)&&scalarExpression(node.whenTrue)&&scalarExpression(node.whenFalse);
  if(ts.isTemplateExpression(node))return node.templateSpans.every(span=>scalarExpression(span.expression));
  if(ts.isCallExpression(node))return ts.isIdentifier(node.expression)&&callable(node.expression)&&!node.typeArguments?.length&&node.arguments.every(scalarExpression);
  return false;
 };
 const functionValue=node=>!node.asteriskToken&&!node.typeParameters?.length&&!node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.AsyncKeyword||modifier.kind===ts.SyntaxKind.DeclareKeyword)&&scalarType(node.type)&&node.parameters.every(param=>ts.isIdentifier(param.name)&&!!param.type&&scalarType(param.type)&&!param.dotDotDotToken&&!param.modifiers?.length&&scalarExpression(param.initializer))&&!!node.body&&(ts.isBlock(node.body)?node.body.statements.every(statement):scalarExpression(node.body));
 const declaration=node=>ts.isIdentifier(node.name)&&scalarType(node.type)&&!!node.initializer&&(ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer)?functionValue(node.initializer):scalarExpression(node.initializer));
 const statement=node=>ts.isReturnStatement(node)?scalarExpression(node.expression):ts.isBlock(node)?node.statements.every(statement):ts.isIfStatement(node)?scalarExpression(node.expression)&&statement(node.thenStatement)&&(!node.elseStatement||statement(node.elseStatement)):ts.isVariableStatement(node)?Boolean(node.declarationList.flags&ts.NodeFlags.Const)&&node.declarationList.declarations.every(declaration):false;
 for(const [path,file] of files){
  if(program.getSemanticDiagnostics(file).length)unknown('unresolved');
  for(const node of file.statements){
   if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){
    if(node.attributes||node.assertClause)unknown('unsupported');
    if(node.moduleSpecifier){if(!ts.isStringLiteral(node.moduleSpecifier)){unknown('unresolved');continue;}const target=resolve(path,node.moduleSpecifier.text);if(target)edges.push([path,target]);}
    if(ts.isImportDeclaration(node)&&!node.importClause)unknown('effects');
    if(ts.isExportDeclaration(node)&&!node.moduleSpecifier&&node.exportClause&&ts.isNamedExports(node.exportClause)&&node.exportClause.elements.some(item=>!local(item.propertyName||item.name)))unknown('effects');
    continue;
   }
   if(ts.isFunctionDeclaration(node)){if(!node.name||!functionValue(node))unknown('effects');continue;}
   if(ts.isVariableStatement(node)){if(!(node.declarationList.flags&ts.NodeFlags.Const)||node.modifiers?.some(item=>item.kind===ts.SyntaxKind.DeclareKeyword)||!node.declarationList.declarations.every(declaration)||node.declarationList.declarations.some(item=>item.initializer&&!(ts.isArrowFunction(item.initializer)||ts.isFunctionExpression(item.initializer))&&containsCall(item.initializer)))unknown('effects');continue;}
   if(ts.isTypeAliasDeclaration(node)&&!node.typeParameters?.length&&scalarType(node.type))continue;
   if(ts.isEmptyStatement(node))continue;
   unknown('effects');
  }
 }
 return {edges,boundaries:[...boundaries].sort()};
}
function containsCall(node){if(ts.isCallExpression(node))return true;let found=false;ts.forEachChild(node,child=>{if(containsCall(child))found=true;});return found;}
export function createAcceptancePlan({group:input,files}={}){
 const group=validateChangeSet(input,input?.projectId);requireValue(group.origin==='ai');requireValue(Array.isArray(files)&&files.length===group.context.length);
 let bytes=0;
 const original=files.map((file,index)=>{const ref=group.context[index],member=group.files.find(item=>item.path===ref.path);requireValue(file?.path===ref.path&&file.revision===ref.revision&&typeof file.source==='string'&&hash(file.source).slice(0,16)===ref.revision&&(!member||member.before===file.source));bytes+=Buffer.byteLength(file.source);requireValue(bytes<=65536);return {path:file.path,source:file.source};});
 const staged=original.map(file=>({path:file.path,source:group.files.find(item=>item.path===file.path)?.after??file.source}));requireValue(staged.reduce((size,file)=>size+Buffer.byteLength(file.source),0)<=65536);
 const before=analyze(original),after=analyze(staged),boundaries=[...new Set([...before.boundaries,...after.boundaries])].sort(),parents=new Map(original.map(file=>[file.path,file.path]));
 const find=path=>parents.get(path)===path?path:find(parents.get(path));
 for(const [from,to] of [...before.edges,...after.edges]){if(!parents.has(from)||!parents.has(to)){boundaries.push(reasons.unresolved);continue;}parents.set(find(to),find(from));}
 const components=new Map();for(const file of group.files){const key=boundaries.length?'atomic':find(file.path);if(!components.has(key))components.set(key,[]);components.get(key).push(file.path);}
 const units=[...components.values()].map(paths=>({id:`unit-${hash({groupId:group.id,paths}).slice(0,16)}`,label:paths.length===1?paths[0]:`${paths.length} connected files`,paths}));
 const value={version:1,groupId:group.id,groupDigest:changeGroupDigest(group),mode:units.length>1?'partitioned':'atomic',units,boundaries:[...new Set(boundaries)].sort()};return {...value,digest:hash(value)};
}
export function validateAcceptancePlan(value,input){
 const group=validateChangeSet(input,input?.projectId);requireValue(group.origin==='ai');requireValue(exact(value,['version','groupId','groupDigest','mode','units','boundaries','digest'])&&value.version===1&&value.groupId===group.id&&value.groupDigest===changeGroupDigest(group)&&['partitioned','atomic'].includes(value.mode)&&Array.isArray(value.units)&&value.units.length>=1&&value.units.length<=group.files.length&&Array.isArray(value.boundaries)&&value.boundaries.length<=4&&value.boundaries.every(reason=>Object.values(reasons).includes(reason))&&new Set(value.boundaries).size===value.boundaries.length);
 const paths=[];for(const unit of value.units){requireValue(exact(unit,['id','label','paths'])&&Array.isArray(unit.paths)&&unit.paths.length>0&&unit.paths.every(path=>group.files.some(file=>file.path===path))&&unit.id===`unit-${hash({groupId:group.id,paths:unit.paths}).slice(0,16)}`&&unit.label===(unit.paths.length===1?unit.paths[0]:`${unit.paths.length} connected files`));paths.push(...unit.paths);}
 requireValue(paths.length===group.files.length&&new Set(paths).size===paths.length&&value.mode===(value.units.length>1?'partitioned':'atomic')&&(!value.boundaries.length||value.units.length===1));
 const {digest,...content}=value;requireValue(digest===hash(content)&&Buffer.byteLength(JSON.stringify(value))<=16384);return copy(value);
}
