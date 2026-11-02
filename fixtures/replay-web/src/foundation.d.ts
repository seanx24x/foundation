/// <reference types="vite/client" />
declare module 'virtual:foundation/scenarios' {
  export interface ReplayConditions { theme:'light'|'dark'; motion:'system'|'reduce'; viewportWidthCss:390|768|960; viewportHeightCss:680 }
  export interface ReplayContext { signal:AbortSignal; conditions:Readonly<ReplayConditions> }
  export interface ReplayRecipe { id:string; title:string; route:string; fixture:{id:string;label:string}; prepare:(context:ReplayContext)=>void|Promise<void>; steps:{id:string;title:string;run:(context:ReplayContext)=>void|Promise<void>}[] }
  export function registerFoundationScenarios(input:{version:1;recipes:ReplayRecipe[]}):()=>void;
}
