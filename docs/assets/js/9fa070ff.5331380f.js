"use strict";(self.webpackChunkdocs=self.webpackChunkdocs||[]).push([[394],{7522:(e,t,n)=>{n.d(t,{Zo:()=>p,kt:()=>y});var a=n(9901);function r(e,t,n){return t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function c(e,t){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);t&&(a=a.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),n.push.apply(n,a)}return n}function o(e){for(var t=1;t<arguments.length;t++){var n=null!=arguments[t]?arguments[t]:{};t%2?c(Object(n),!0).forEach((function(t){r(e,t,n[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):c(Object(n)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))}))}return e}function d(e,t){if(null==e)return{};var n,a,r=function(e,t){if(null==e)return{};var n,a,r={},c=Object.keys(e);for(a=0;a<c.length;a++)n=c[a],t.indexOf(n)>=0||(r[n]=e[n]);return r}(e,t);if(Object.getOwnPropertySymbols){var c=Object.getOwnPropertySymbols(e);for(a=0;a<c.length;a++)n=c[a],t.indexOf(n)>=0||Object.prototype.propertyIsEnumerable.call(e,n)&&(r[n]=e[n])}return r}var i=a.createContext({}),s=function(e){var t=a.useContext(i),n=t;return e&&(n="function"==typeof e?e(t):o(o({},t),e)),n},p=function(e){var t=s(e.components);return a.createElement(i.Provider,{value:t},e.children)},u="mdxType",l={inlineCode:"code",wrapper:function(e){var t=e.children;return a.createElement(a.Fragment,{},t)}},m=a.forwardRef((function(e,t){var n=e.components,r=e.mdxType,c=e.originalType,i=e.parentName,p=d(e,["components","mdxType","originalType","parentName"]),u=s(n),m=r,y=u["".concat(i,".").concat(m)]||u[m]||l[m]||c;return n?a.createElement(y,o(o({ref:t},p),{},{components:n})):a.createElement(y,o({ref:t},p))}));function y(e,t){var n=arguments,r=t&&t.mdxType;if("string"==typeof e||r){var c=n.length,o=new Array(c);o[0]=m;var d={};for(var i in t)hasOwnProperty.call(t,i)&&(d[i]=t[i]);d.originalType=e,d[u]="string"==typeof e?e:r,o[1]=d;for(var s=2;s<c;s++)o[s]=n[s];return a.createElement.apply(null,o)}return a.createElement.apply(null,n)}m.displayName="MDXCreateElement"},4948:(e,t,n)=>{n.r(t),n.d(t,{assets:()=>i,contentTitle:()=>o,default:()=>l,frontMatter:()=>c,metadata:()=>d,toc:()=>s});var a=n(7364),r=(n(9901),n(7522));const c={sidebar_position:4},o="Codec",d={unversionedId:"core-concepts/codec",id:"core-concepts/codec",title:"Codec",description:"It is common in TypeScript applications to use JSON.stringify and JSON.parse indiscriminately. In the context of",source:"@site/docs/core-concepts/codec.md",sourceDirName:"core-concepts",slug:"/core-concepts/codec",permalink:"/equinox-js/docs/core-concepts/codec",draft:!1,editUrl:"https://github.com/nordfjord/equinox-js/tree/main/apps/docs/docs/core-concepts/codec.md",tags:[],version:"current",sidebarPosition:4,frontMatter:{sidebar_position:4},sidebar:"tutorialSidebar",previous:{title:"Decider",permalink:"/equinox-js/docs/core-concepts/decider"},next:{title:"Caching",permalink:"/equinox-js/docs/core-concepts/caching"}},i={},s=[],p={toc:s},u="wrapper";function l(e){let{components:t,...n}=e;return(0,r.kt)(u,(0,a.Z)({},p,n,{components:t,mdxType:"MDXLayout"}),(0,r.kt)("h1",{id:"codec"},"Codec"),(0,r.kt)("p",null,"It is common in TypeScript applications to use ",(0,r.kt)("inlineCode",{parentName:"p"},"JSON.stringify")," and ",(0,r.kt)("inlineCode",{parentName:"p"},"JSON.parse")," indiscriminately. In the context of\nevent sourced applications this practise has a couple of problems. Firstly, these APIs are untyped, there's no guarantee\nthat what you get from the store is what you expected. Secondly, it is common to evolve event schemas through upcasting.\n",(0,r.kt)("inlineCode",{parentName:"p"},"JSON.parse")," doesn't offer any way to define the schema you want out or provide default values for missing properties.\nThese deficiencies can lead to unexpected type errors and behaviours."),(0,r.kt)("p",null,"In EquinoxJS codecs as a first class citizen. A naive implementation might look like this: "),(0,r.kt)("pre",null,(0,r.kt)("code",{parentName:"pre",className:"language-ts"},'const codec: Codec<Event, Record<string, any>> = {\n  tryDecode(ev): Event | undefined {\n    switch (ev.type) {\n      case "CheckedIn":\n        return { type: ev.type, data: { at: new Date(ev.data.at) } }\n      case "CheckedOut":\n        return { type: ev.type, data: { at: new Date(ev.data.at) } }\n      case "Charged":\n        return { type: ev.type, data: { chargeId: ev.data.chargeId, amount: ev.data.amount, at: new Date(ev.data.at) } }\n      case "Paid":\n        return { type: ev.type, data: { paymentId: ev.data.paymentId, amount: ev.data.amount, at: new Date(ev.data.at) } }\n    }\n  },\n  encode(ev) {\n    return ev\n  },\n}\n')),(0,r.kt)("p",null,"You might decide that this is too naive and that a library like ",(0,r.kt)("inlineCode",{parentName:"p"},"zod")," is called for instead"),(0,r.kt)("pre",null,(0,r.kt)("code",{parentName:"pre",className:"language-ts"},'const CheckedInSchema = z.object({ at: z.date() })\nconst CheckedOutSchema = z.object({ at: z.date() })\nconst ChargedSchema = z.object({ chargeId: z.string().uuid(), amount: z.number(), at: z.date() })\nconst PaidSchema = z.object({ paymentId: z.string().uuid(), amount: z.number(), at: z.date() })\n\nconst codec: Codec<Event, Record<string, any>> = {\n  tryDecode(ev): Event | undefined {\n    try {\n      switch (ev.type) {\n        case "CheckedIn":\n          return { type: ev.type, data: CheckedInSchema.parse(ev.data) }\n        case "CheckedOut":\n          return { type: ev.type, data: CheckedOutSchema.parse(ev.data) }\n        case "Charged":\n          return { type: ev.type, data: ChargedSchema.parse(ev.data) }\n        case "Paid":\n          return { type: ev.type, data: PaidSchema.parse(ev.data) }\n      }\n    } catch (err) {\n      if (err instanceof ZodError) return undefined\n      throw err\n    }\n  },\n  encode(ev) {\n    return ev\n  }\n}\n')),(0,r.kt)("p",null,"Codecs are also where we control the metadata we add onto events"),(0,r.kt)("pre",null,(0,r.kt)("code",{parentName:"pre",className:"language-ts"},'const CheckedInSchema = z.object({ at: z.date() })\nconst CheckedOutSchema = z.object({ at: z.date() })\nconst ChargedSchema = z.object({ chargeId: z.string().uuid(), amount: z.number(), at: z.date() })\nconst PaidSchema = z.object({ paymentId: z.string().uuid(), amount: z.number(), at: z.date() })\n\ntype Context = { correlationId: string, causationId: string, tenantId: string, userId: string }\n\nconst codec: Codec<Event, Record<string, any>, Context> = {\n  tryDecode(ev): Event | undefined {\n    try {\n      switch (ev.type) {\n        case "CheckedIn":\n          return { type: ev.type, data: CheckedInSchema.parse(ev.data) }\n        case "CheckedOut":\n          return { type: ev.type, data: CheckedOutSchema.parse(ev.data) }\n        case "Charged":\n          return { type: ev.type, data: ChargedSchema.parse(ev.data) }\n        case "Paid":\n          return { type: ev.type, data: PaidSchema.parse(ev.data) }\n      }\n    } catch (err) {\n      if (err instanceof ZodError) return undefined\n      throw err\n    }\n  },\n  encode(ev, ctx) {\n    return {\n      type: ev.type,\n      data: ev.data,\n      meta: {\n        // matches ESDB\'s convention\n        $correlationId: ctx.correlationId,\n        $causationId: ctx.causationId,\n        userId: ctx.userId,\n        tenantId: ctx.tenantId\n      }\n    }\n  }\n}\n')))}l.isMDXComponent=!0}}]);